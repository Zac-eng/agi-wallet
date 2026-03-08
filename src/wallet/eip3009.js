/**
 * eip3009.js – EIP-3009 "Transfer With Authorization" signer
 *
 * EIP-3009 lets the agent sign an authorization message OFF-CHAIN.
 * A relayer (or the payee) then submits it on-chain and pays the gas.
 * This makes USDC feel like a credit card — the agent just "signs"
 * a payment and the recipient collects the funds.
 *
 * Spec: https://eips.ethereum.org/EIPS/eip-3009
 * USDC v2 implements this interface natively.
 */

import { ethers } from 'ethers';
import { randomBytes } from 'crypto';

/**
 * EIP-712 domain separator for USDC contracts.
 * The domain must match the deployed USDC contract's domain exactly.
 *
 * @param {string} contractAddress - USDC contract address
 * @param {number|bigint} chainId - Network chain ID
 * @param {string} contractName - Usually "USD Coin" or queried on-chain
 * @param {string} contractVersion - Usually "2" for USDC v2
 * @returns {object} EIP-712 domain
 */
export function buildDomain(contractAddress, chainId, contractName = 'USD Coin', contractVersion = '2') {
  return {
    name: contractName,
    version: contractVersion,
    chainId: Number(chainId),
    verifyingContract: contractAddress,
  };
}

/** EIP-712 type definitions for TransferWithAuthorization */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from',        type: 'address' },
    { name: 'to',          type: 'address' },
    { name: 'value',       type: 'uint256' },
    { name: 'validAfter',  type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce',       type: 'bytes32' },
  ],
};

/**
 * Generate a random EIP-3009 nonce (bytes32).
 * Each authorization must use a unique nonce to prevent replay.
 */
export function generateNonce() {
  return '0x' + randomBytes(32).toString('hex');
}

/**
 * Sign a TransferWithAuthorization message using EIP-712.
 *
 * The resulting signature can be submitted on-chain by anyone (the relayer)
 * to move USDC from `from` to `to` without the sender paying gas.
 *
 * @param {ethers.Wallet} signer - The agent's signer (private key)
 * @param {object} params
 * @param {string}         params.contractAddress - USDC contract address
 * @param {number|bigint}  params.chainId         - Network chain ID
 * @param {string}         params.to              - Recipient address
 * @param {bigint}         params.value           - Amount in USDC base units (wei)
 * @param {number}         [params.validAfter]    - Unix timestamp; 0 = immediately valid
 * @param {number}         [params.validBefore]   - Unix timestamp; deadline for submission
 * @param {string}         [params.nonce]         - bytes32 nonce; auto-generated if omitted
 * @param {string}         [params.contractName]  - Token name for domain (default "USD Coin")
 * @param {string}         [params.contractVersion] - Token version (default "2")
 * @returns {Promise<{authorization: object, signature: object, raw: string}>}
 */
export async function signTransferWithAuthorization(signer, params) {
  const {
    contractAddress,
    chainId,
    to,
    value,
    validAfter = 0,
    validBefore = Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    nonce = generateNonce(),
    contractName = 'USD Coin',
    contractVersion = '2',
  } = params;

  const domain = buildDomain(contractAddress, chainId, contractName, contractVersion);

  const message = {
    from: signer.address,
    to,
    value,
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce,
  };

  // Sign via ethers EIP-712
  const rawSignature = await signer.signTypedData(domain, TRANSFER_WITH_AUTHORIZATION_TYPES, message);
  const { v, r, s } = ethers.Signature.from(rawSignature);

  const authorization = {
    from: signer.address,
    to,
    value,
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce,
  };

  return {
    authorization,
    signature: { v, r, s },
    raw: rawSignature,
    // Combined object ready to pass to wallet.submitTransferWithAuthorization()
    combined: { ...authorization, v, r, s },
  };
}

/**
 * Verify a TransferWithAuthorization signature locally (without on-chain call).
 * Useful for the payment server to pre-validate before broadcasting.
 *
 * @param {object} authorization - The authorization message
 * @param {object} signature     - { v, r, s }
 * @param {object} domain        - EIP-712 domain
 * @returns {string} Recovered signer address
 */
export function verifyTransferWithAuthorization(authorization, signature, domain) {
  const { v, r, s } = signature;
  const rawSig = ethers.Signature.from({ v, r, s }).serialized;

  const recoveredAddress = ethers.verifyTypedData(
    domain,
    TRANSFER_WITH_AUTHORIZATION_TYPES,
    authorization,
    rawSig
  );

  return recoveredAddress;
}

export default {
  buildDomain,
  generateNonce,
  signTransferWithAuthorization,
  verifyTransferWithAuthorization,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
};
