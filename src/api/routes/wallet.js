/**
 * routes/wallet.js – Wallet info endpoints
 *
 * GET  /v1/wallet/balance  – USDC + ETH balance
 * GET  /v1/wallet/address  – Public address
 * GET  /v1/wallet/limits   – Current spending limits
 * PUT  /v1/wallet/limits   – Update spending limits (runtime override)
 * GET  /v1/wallet/network  – Connected network info
 */

import { Router } from 'express';
import { getWallet } from '../../wallet/wallet.js';
import { requireApiKey } from '../middleware/auth.js';
import { getDailyTotal } from '../db/index.js';

const router = Router();
router.use(requireApiKey);

// Runtime limit overrides (stored in memory; persist to .env for permanence)
const runtimeLimits = {};

function getLimits() {
  return {
    max_tx_amount: parseFloat(runtimeLimits.max_tx_amount ?? process.env.MAX_TX_AMOUNT ?? '100'),
    max_daily_amount: parseFloat(runtimeLimits.max_daily_amount ?? process.env.MAX_DAILY_AMOUNT ?? '1000'),
  };
}

// GET /v1/wallet/balance
router.get('/balance', async (req, res, next) => {
  try {
    const wallet = getWallet();
    const [usdc, eth] = await Promise.all([
      wallet.getUSDCBalance(),
      wallet.getETHBalance(),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const dailySpent = getDailyTotal(today);
    const limits = getLimits();

    res.json({
      address: wallet.getAddress(),
      usdc: {
        balance: usdc.formatted,
        raw: usdc.raw.toString(),
        contract: usdc.usdcAddress,
      },
      eth: {
        balance: eth.formatted,
        raw: eth.raw.toString(),
        note: 'ETH is used to pay gas fees for relaying',
      },
      daily_spent_usdc: dailySpent,
      daily_remaining_usdc: Math.max(0, limits.max_daily_amount - dailySpent),
    });
  } catch (err) {
    next(err);
  }
});

// GET /v1/wallet/address
router.get('/address', (req, res) => {
  const wallet = getWallet();
  res.json({ address: wallet.getAddress() });
});

// GET /v1/wallet/network
router.get('/network', async (req, res, next) => {
  try {
    const wallet = getWallet();
    const network = await wallet.getNetwork();
    res.json({
      name: network.name,
      chainId: network.chainId.toString(),
      rpcUrl: process.env.BASE_RPC_URL,
    });
  } catch (err) {
    next(err);
  }
});

// GET /v1/wallet/limits
router.get('/limits', (req, res) => {
  const limits = getLimits();
  const today = new Date().toISOString().slice(0, 10);
  const dailySpent = getDailyTotal(today);

  res.json({
    ...limits,
    daily_spent_usdc: dailySpent,
    currency: 'USDC',
  });
});

// PUT /v1/wallet/limits
router.put('/limits', (req, res) => {
  const { max_tx_amount, max_daily_amount } = req.body;

  if (max_tx_amount !== undefined) {
    const v = parseFloat(max_tx_amount);
    if (isNaN(v) || v <= 0) {
      return res.status(400).json({ error: 'BadRequest', message: 'max_tx_amount must be positive' });
    }
    runtimeLimits.max_tx_amount = v;
    process.env.MAX_TX_AMOUNT = String(v);
  }
  if (max_daily_amount !== undefined) {
    const v = parseFloat(max_daily_amount);
    if (isNaN(v) || v <= 0) {
      return res.status(400).json({ error: 'BadRequest', message: 'max_daily_amount must be positive' });
    }
    runtimeLimits.max_daily_amount = v;
    process.env.MAX_DAILY_AMOUNT = String(v);
  }

  res.json({ message: 'Limits updated', ...getLimits() });
});

export default router;
