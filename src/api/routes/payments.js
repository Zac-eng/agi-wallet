/**
 * routes/payments.js – Credit-card-style USDC payment endpoints
 *
 * Endpoints:
 *   POST /v1/charge      – Single-step payment (authorize + capture)
 *   POST /v1/authorize   – Reserve funds with EIP-3009 (no on-chain transfer yet)
 *   POST /v1/capture     – Settle a prior authorization (submit on-chain)
 *   POST /v1/refund      – Return USDC to merchant
 *   GET  /v1/transactions         – List transactions
 *   GET  /v1/transactions/:id     – Get transaction by ID
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';
import { getWallet } from '../../wallet/wallet.js';
import { signTransferWithAuthorization } from '../../wallet/eip3009.js';
import { relay } from '../../wallet/relayer.js';
import {
  insertTransaction,
  updateTransaction,
  getTransaction,
  listTransactions,
  getDailyTotal,
  addToDailyTotal,
} from '../db/index.js';
import { requireApiKey, requireFields } from '../middleware/auth.js';
import { broadcastTx } from '../server.js';

const router = Router();

// Apply API key auth to all payment routes
router.use(requireApiKey);

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function checkSpendingLimits(amount) {
  const maxTx    = parseFloat(process.env.MAX_TX_AMOUNT   || '100');
  const maxDaily = parseFloat(process.env.MAX_DAILY_AMOUNT || '1000');

  if (amount > maxTx) {
    const err = new Error(`Amount ${amount} USDC exceeds per-transaction limit of ${maxTx} USDC`);
    err.status = 422;
    err.name = 'SpendingLimitExceeded';
    throw err;
  }

  const dailySpent = getDailyTotal(todayUtc());
  if (dailySpent + amount > maxDaily) {
    const err = new Error(`Daily limit: spent ${dailySpent} USDC + ${amount} USDC would exceed ${maxDaily} USDC / day`);
    err.status = 422;
    err.name = 'DailyLimitExceeded';
    throw err;
  }
}

async function buildSignedAuth(wallet, to, amountUsdc) {
  const network = await wallet.getNetwork();
  const decimals = await wallet.getDecimals();
  const name = await wallet.getName();
  const version = await wallet.getVersion();
  const value = ethers.parseUnits(String(amountUsdc), decimals);

  const result = await signTransferWithAuthorization(wallet.signer, {
    contractAddress: wallet.usdcAddress,
    chainId: network.chainId,
    to,
    value,
    contractName: name,
    contractVersion: version,
  });

  return result;
}

// ----------------------------------------------------------------
// POST /v1/charge  (authorize + capture in one step)
// ----------------------------------------------------------------
router.post('/charge', requireFields(['amount', 'merchant']), async (req, res, next) => {
  try {
    const { amount, merchant, description, metadata } = req.body;
    const amountUsdc = parseFloat(amount);

    if (isNaN(amountUsdc) || amountUsdc <= 0) {
      return res.status(400).json({ error: 'BadRequest', message: 'amount must be a positive number' });
    }

    checkSpendingLimits(amountUsdc);

    const txId = uuidv4();
    insertTransaction({
      id: txId,
      type: 'charge',
      status: 'processing',
      amount_usdc: amountUsdc,
      merchant,
      description: description || null,
      metadata: metadata || null,
    });

    const wallet = getWallet();

    // Sign EIP-3009 authorization
    const signed = await buildSignedAuth(wallet, merchant, amountUsdc);

    // Submit on-chain (relay)
    let relayResult;
    try {
      relayResult = await relay(signed.combined);
    } catch (chainErr) {
      updateTransaction(txId, { status: 'failed', error: chainErr.message });
      throw chainErr;
    }

    const settlementTime = Date.now();
    addToDailyTotal(todayUtc(), amountUsdc);

    updateTransaction(txId, {
      status: 'confirmed',
      tx_hash: relayResult.txHash,
      block_number: relayResult.blockNumber,
      gas_used: String(relayResult.gasUsed),
      auth_nonce: signed.authorization.nonce,
      settled_at: settlementTime,
    });

    const record = getTransaction(txId);
    broadcastTx(record);

    return res.status(201).json({
      id: txId,
      status: 'confirmed',
      amount: amountUsdc,
      currency: 'USDC',
      merchant,
      tx_hash: relayResult.txHash,
      block_number: relayResult.blockNumber,
      created_at: record.created_at,
      settled_at: settlementTime,
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------
// POST /v1/authorize (off-chain reservation, no on-chain transfer yet)
// ----------------------------------------------------------------
router.post('/authorize', requireFields(['amount', 'merchant']), async (req, res, next) => {
  try {
    const { amount, merchant, description, metadata } = req.body;
    const amountUsdc = parseFloat(amount);

    if (isNaN(amountUsdc) || amountUsdc <= 0) {
      return res.status(400).json({ error: 'BadRequest', message: 'amount must be a positive number' });
    }

    checkSpendingLimits(amountUsdc);

    const txId = uuidv4();
    const wallet = getWallet();

    // Sign the EIP-3009 authorization (off-chain only at this point)
    const signed = await buildSignedAuth(wallet, merchant, amountUsdc);

    insertTransaction({
      id: txId,
      type: 'authorize',
      status: 'pending',
      amount_usdc: amountUsdc,
      merchant,
      description: description || null,
      metadata: {
        ...(metadata || {}),
        // Store the signed authorization so it can be captured later
        _signed_auth: {
          authorization: {
            ...signed.authorization,
            value: signed.authorization.value.toString(),
            validAfter: signed.authorization.validAfter.toString(),
            validBefore: signed.authorization.validBefore.toString(),
          },
          signature: signed.signature,
        },
      },
      auth_nonce: signed.authorization.nonce,
    });

    const record = getTransaction(txId);
    broadcastTx(record);

    return res.status(201).json({
      id: txId,
      status: 'pending',
      amount: amountUsdc,
      currency: 'USDC',
      merchant,
      auth_nonce: signed.authorization.nonce,
      expires_at: Number(signed.authorization.validBefore),
      message: 'Authorization created. Call POST /v1/capture/:id to settle.',
      created_at: record.created_at,
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------
// POST /v1/capture/:id  (settle a pending authorization)
// ----------------------------------------------------------------
router.post('/capture/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const auth = getTransaction(id);

    if (!auth) {
      return res.status(404).json({ error: 'NotFound', message: `Transaction ${id} not found` });
    }
    if (auth.type !== 'authorize') {
      return res.status(422).json({ error: 'InvalidOperation', message: 'Can only capture an authorization' });
    }
    if (auth.status !== 'pending') {
      return res.status(422).json({ error: 'InvalidOperation', message: `Authorization is already ${auth.status}` });
    }

    updateTransaction(id, { status: 'processing' });

    // Reconstruct the signed auth from DB metadata
    const { authorization, signature } = auth.metadata._signed_auth;
    const { v, r, s } = signature;
    const wallet = getWallet();
    const decimals = await wallet.getDecimals();

    const combined = {
      from: authorization.from,
      to: authorization.to,
      value: ethers.parseUnits(
        ethers.formatUnits(BigInt(authorization.value), decimals),
        decimals
      ),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
      v, r, s,
    };

    let relayResult;
    try {
      relayResult = await relay(combined);
    } catch (chainErr) {
      updateTransaction(id, { status: 'failed', error: chainErr.message });
      throw chainErr;
    }

    const settlementTime = Date.now();
    addToDailyTotal(todayUtc(), auth.amount_usdc);

    updateTransaction(id, {
      status: 'confirmed',
      tx_hash: relayResult.txHash,
      block_number: relayResult.blockNumber,
      gas_used: String(relayResult.gasUsed),
      settled_at: settlementTime,
    });

    const record = getTransaction(id);
    broadcastTx(record);

    return res.json({
      id,
      status: 'confirmed',
      amount: auth.amount_usdc,
      currency: 'USDC',
      merchant: auth.merchant,
      tx_hash: relayResult.txHash,
      block_number: relayResult.blockNumber,
      settled_at: settlementTime,
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------
// POST /v1/refund  (return USDC from merchant → agent wallet)
// ----------------------------------------------------------------
router.post('/refund', requireFields(['amount', 'merchant']), async (req, res, next) => {
  try {
    const { amount, merchant, description, metadata, original_transaction_id } = req.body;
    const amountUsdc = parseFloat(amount);

    if (isNaN(amountUsdc) || amountUsdc <= 0) {
      return res.status(400).json({ error: 'BadRequest', message: 'amount must be a positive number' });
    }

    const txId = uuidv4();
    const wallet = getWallet();

    // For a refund, merchant sends USDC back to the agent.
    // In practice the merchant would sign the EIP-3009; here we simulate
    // it as a standard transfer FROM the agent (net-zero demo).
    // In production: merchant signs & agent calls receiveWithAuthorization.
    insertTransaction({
      id: txId,
      type: 'refund',
      status: 'processing',
      amount_usdc: amountUsdc,
      merchant,
      description: description || 'Refund',
      metadata: metadata || null,
      parent_id: original_transaction_id || null,
    });

    let txHash, blockNumber;
    try {
      const tx = await wallet.transfer(merchant, amountUsdc);
      const receipt = await wallet.waitForTx(tx);
      txHash = receipt.hash;
      blockNumber = receipt.blockNumber;
    } catch (chainErr) {
      updateTransaction(txId, { status: 'failed', error: chainErr.message });
      throw chainErr;
    }

    const settlementTime = Date.now();
    updateTransaction(txId, {
      status: 'confirmed',
      tx_hash: txHash,
      block_number: blockNumber,
      settled_at: settlementTime,
    });

    const record = getTransaction(txId);
    broadcastTx(record);

    return res.status(201).json({
      id: txId,
      status: 'confirmed',
      type: 'refund',
      amount: amountUsdc,
      currency: 'USDC',
      merchant,
      tx_hash: txHash,
      block_number: blockNumber,
      settled_at: settlementTime,
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------
// GET /v1/transactions
// ----------------------------------------------------------------
router.get('/transactions', (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  || '20', 10), 100);
  const offset = parseInt(req.query.offset || '0', 10);
  const { status, type } = req.query;

  const { rows, total } = listTransactions({ limit, offset, status, type });

  res.json({
    data: rows,
    pagination: { total, limit, offset, has_more: offset + limit < total },
  });
});

// ----------------------------------------------------------------
// GET /v1/transactions/:id
// ----------------------------------------------------------------
router.get('/transactions/:id', (req, res) => {
  const record = getTransaction(req.params.id);
  if (!record) {
    return res.status(404).json({ error: 'NotFound', message: `Transaction ${req.params.id} not found` });
  }
  res.json(record);
});

export default router;
