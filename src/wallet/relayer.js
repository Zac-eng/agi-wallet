/**
 * relayer.js – EIP-3009 Relayer
 *
 * Receives a signed EIP-3009 authorization and submits it on-chain.
 * The relayer pays the gas fee (in ETH), not the agent.
 * In single-wallet mode, the agent wallet IS the relayer — it pays
 * its own gas but the UX is still identical to standard payment flow.
 *
 * In production, you'd separate the relayer into its own funded wallet.
 */

import { ethers } from 'ethers';
import { getWallet } from './wallet.js';

/**
 * Submit a signed EIP-3009 authorization on-chain.
 *
 * @param {object} signedAuth - Output from eip3009.signTransferWithAuthorization().combined
 * @returns {Promise<{txHash: string, blockNumber: number, gasUsed: bigint}>}
 */
export async function relay(signedAuth) {
  const wallet = getWallet();
  const { from, to, value, validAfter, validBefore, nonce, v, r, s } = signedAuth;

  // Validate timing windows
  const now = Math.floor(Date.now() / 1000);
  if (now < Number(validAfter)) {
    throw new Error(`Authorization not yet valid (validAfter: ${validAfter})`);
  }
  if (now > Number(validBefore)) {
    throw new Error(`Authorization has expired (validBefore: ${validBefore})`);
  }

  // Check nonce hasn't been used
  const used = await wallet.isNonceUsed(from, nonce);
  if (used) {
    throw new Error(`Authorization nonce already used: ${nonce}`);
  }

  // Submit on-chain
  const tx = await wallet.submitTransferWithAuthorization({
    from, to, value, validAfter, validBefore, nonce, v, r, s
  });

  const receipt = await wallet.waitForTx(tx);

  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    status: receipt.status === 1 ? 'confirmed' : 'failed',
  };
}

/**
 * Estimate the gas cost of relaying a transferWithAuthorization.
 * @param {object} signedAuth
 * @returns {Promise<{gasUnits: bigint, gasPriceGwei: string, costEth: string}>}
 */
export async function estimateRelayGas(signedAuth) {
  const wallet = getWallet();
  const { from, to, value, validAfter, validBefore, nonce, v, r, s } = signedAuth;

  const gasUnits = await wallet.usdc.transferWithAuthorization.estimateGas(
    from, to, value, validAfter, validBefore, nonce, v, r, s
  );

  const feeData = await wallet.provider.getFeeData();
  const gasPriceWei = feeData.gasPrice ?? feeData.maxFeePerGas;
  const costWei = gasUnits * gasPriceWei;

  return {
    gasUnits,
    gasPriceGwei: ethers.formatUnits(gasPriceWei, 'gwei'),
    costEth: ethers.formatEther(costWei),
  };
}

export default { relay, estimateRelayGas };
