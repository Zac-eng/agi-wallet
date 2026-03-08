/**
 * wallet.js – Core wallet engine using ethers.js
 * Loads the agent private key, connects to Base network,
 * and provides USDC balance and transfer operations.
 */

import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

// Minimal ERC-20 ABI (balance + transfer + transferWithAuthorization)
const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function version() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  // EIP-3009
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
  'function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)',
];

class AgentWallet {
  constructor() {
    if (!process.env.AGENT_PRIVATE_KEY) {
      throw new Error('AGENT_PRIVATE_KEY is not set in environment');
    }
    if (!process.env.BASE_RPC_URL) {
      throw new Error('BASE_RPC_URL is not set in environment');
    }
    if (!process.env.USDC_CONTRACT_ADDRESS) {
      throw new Error('USDC_CONTRACT_ADDRESS is not set in environment');
    }

    this.provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
    this.signer = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, this.provider);
    this.usdcAddress = process.env.USDC_CONTRACT_ADDRESS;
    this.usdc = new ethers.Contract(this.usdcAddress, ERC20_ABI, this.signer);
    this._decimals = null; // cached
    this._name = null;     // cached
    this._version = null;  // cached
  }

  /** Get the USDC contract decimals (cached). */
  async getDecimals() {
    if (this._decimals === null) {
      this._decimals = await this.usdc.decimals();
    }
    return this._decimals;
  }

  /** Get the USDC contract name (cached). */
  async getName() {
    if (this._name === null) {
      try {
        this._name = await this.usdc.name();
      } catch (e) {
        this._name = 'USD Coin'; // Fallback
      }
    }
    return this._name;
  }

  /** Get the USDC contract version (cached). */
  async getVersion() {
    if (this._version === null) {
      try {
        this._version = await this.usdc.version();
      } catch (e) {
        this._version = '2'; // Fallback
      }
    }
    return this._version;
  }

  /** Return the agent's wallet address. */
  getAddress() {
    return this.signer.address;
  }

  /**
   * Get USDC balance in human-readable USDC units (e.g. "10.50").
   * @returns {Promise<{raw: bigint, formatted: string, usdcAddress: string}>}
   */
  async getUSDCBalance() {
    const decimals = await this.getDecimals();
    const raw = await this.usdc.balanceOf(this.signer.address);
    return {
      raw,
      formatted: ethers.formatUnits(raw, decimals),
      usdcAddress: this.usdcAddress,
    };
  }

  /**
   * Get native ETH balance (for gas monitoring).
   * @returns {Promise<{raw: bigint, formatted: string}>}
   */
  async getETHBalance() {
    const raw = await this.provider.getBalance(this.signer.address);
    return {
      raw,
      formatted: ethers.formatEther(raw),
    };
  }

  /**
   * Transfer USDC to a recipient address.
   * Uses standard ERC-20 transfer (requires ETH for gas).
   * @param {string} to - Recipient address
   * @param {number|string} amount - Amount in USDC (e.g. 1.50)
   * @returns {Promise<ethers.TransactionResponse>}
   */
  async transfer(to, amount) {
    const decimals = await this.getDecimals();
    const amountWei = ethers.parseUnits(String(amount), decimals);
    const balance = await this.usdc.balanceOf(this.signer.address);

    if (balance < amountWei) {
      throw new Error(
        `Insufficient USDC balance. Have: ${ethers.formatUnits(balance, decimals)} USDC, Need: ${amount} USDC`
      );
    }

    const tx = await this.usdc.transfer(to, amountWei);
    return tx;
  }

  /**
   * Execute an EIP-3009 transferWithAuthorization on-chain.
   * The caller provides the signed authorization (from eip3009.js).
   * @param {object} auth - Authorization params + signature
   * @returns {Promise<ethers.TransactionResponse>}
   */
  async submitTransferWithAuthorization(auth) {
    const { from, to, value, validAfter, validBefore, nonce, v, r, s } = auth;
    const tx = await this.usdc.transferWithAuthorization(
      from,
      to,
      value,
      validAfter,
      validBefore,
      nonce,
      v,
      r,
      s
    );
    return tx;
  }

  /**
   * Check if a nonce has been used (EIP-3009 replay protection).
   * @param {string} authorizer - Authorizer address
   * @param {string} nonce - Nonce bytes32 hex
   * @returns {Promise<boolean>}
   */
  async isNonceUsed(authorizer, nonce) {
    return this.usdc.authorizationState(authorizer, nonce);
  }

  /**
   * Get the connected network info.
   * @returns {Promise<ethers.Network>}
   */
  async getNetwork() {
    return this.provider.getNetwork();
  }

  /**
   * Wait for a transaction to be mined and return the receipt.
   * @param {ethers.TransactionResponse} tx
   * @returns {Promise<ethers.TransactionReceipt>}
   */
  async waitForTx(tx) {
    return tx.wait(1);
  }
}

// Singleton instance
let _walletInstance = null;

export function getWallet() {
  if (!_walletInstance) {
    _walletInstance = new AgentWallet();
  }
  return _walletInstance;
}

export { AgentWallet, ERC20_ABI };
export default AgentWallet;
