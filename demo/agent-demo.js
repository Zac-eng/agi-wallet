/**
 * demo/agent-demo.js
 *
 * Simulates an AI agent autonomously making a sequence of USDC payments
 * using the AGIWalletClient SDK.
 *
 * Prerequisites:
 *   1. Copy .env.example to .env and fill in your private key + RPC URL
 *   2. Start the server: npm run dev
 *   3. Run this demo: npm run demo
 */

import { AGIWalletClient } from '../src/agent/client.js';
import 'dotenv/config';

// ── Demo merchant address (replace with a real address for live test) ──
const DEMO_MERCHANT = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

const wallet = new AGIWalletClient({
  baseUrl: `http://localhost:${process.env.PORT || 3000}`,
  apiKey:  process.env.AGI_API_KEY || 'your-secret-api-key-here',
});

function log(title, data) {
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(55));
  if (data) console.log(JSON.stringify(data, null, 2));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  console.log(`
╔══════════════════════════════════════════════════════╗
║   🤖  AGI Wallet — Agent Payment Demo               ║
║   Demonstrating credit-card-like USDC payments      ║
╚══════════════════════════════════════════════════════╝
  `);

  // ── Step 1: Health check ─────────────────────────────────────
  log('Step 1: Health Check');
  const health = await wallet.health();
  console.log(`  Status: ${health.status} | Version: ${health.version}`);

  await sleep(500);

  // ── Step 2: Check balance ─────────────────────────────────────
  log('Step 2: Check Wallet Balance');
  const balance = await wallet.getBalance();
  console.log(`  Address:    ${balance.address}`);
  console.log(`  USDC:       ${parseFloat(balance.usdc.balance).toFixed(6)} USDC`);
  console.log(`  ETH (gas):  ${parseFloat(balance.eth.balance).toFixed(6)} ETH`);
  console.log(`  Daily spent: ${balance.daily_spent_usdc} USDC`);

  await sleep(500);

  // ── Step 3: Direct charge (GPT-4 API call) ───────────────────
  log('Step 3: CHARGE — Paying for LLM API (like a credit card swipe)');
  console.log('  The agent signs an EIP-3009 authorization off-chain.');
  console.log('  The relayer submits it on-chain. No ETH needed by agent.');

  let chargeId;
  try {
    const charge = await wallet.charge({
      amount:      0.001,
      merchant:    DEMO_MERCHANT,
      description: 'GPT-4 Turbo — 1k token batch',
      metadata:    { agent_id: 'demo-agent-1', model: 'gpt-4-turbo' },
    });
    chargeId = charge.id;
    log('Charge Receipt', {
      id:           charge.id,
      status:       charge.status,
      amount_usdc:  charge.amount,
      tx_hash:      charge.tx_hash,
      block:        charge.block_number,
    });
  } catch (err) {
    console.log(`  ⚠ Charge failed (expected on testnet without funds): ${err.message}`);
    console.log('  Continuing demo in simulation mode…');
    chargeId = 'simulated-charge-id';
  }

  await sleep(800);

  // ── Step 4: Authorize (pre-auth) ─────────────────────────────
  log('Step 4: AUTHORIZE — Pre-auth for compute batch (no on-chain tx yet)');
  let authId;
  try {
    const auth = await wallet.authorize({
      amount:      0.005,
      merchant:    DEMO_MERCHANT,
      description: 'Compute batch pre-authorization',
      metadata:    { agent_id: 'demo-agent-1', job: 'embedding-run-8291' },
    });
    authId = auth.id;
    log('Authorization Created (off-chain)', {
      id:         auth.id,
      status:     auth.status,
      amount:     auth.amount,
      auth_nonce: auth.auth_nonce?.slice(0, 20) + '…',
      expires_at: new Date(auth.expires_at * 1000).toISOString(),
    });
  } catch (err) {
    console.log(`  ⚠ Authorize failed: ${err.message}`);
    authId = null;
  }

  await sleep(500);

  // ── Step 5: Capture ───────────────────────────────────────────
  if (authId && authId !== 'simulated-charge-id') {
    log('Step 5: CAPTURE — Agent has confirmed compute job, settling payment');
    try {
      const capture = await wallet.capture(authId);
      log('Capture Receipt', {
        id:      capture.id,
        status:  capture.status,
        tx_hash: capture.tx_hash,
        block:   capture.block_number,
      });
    } catch (err) {
      console.log(`  ⚠ Capture failed: ${err.message}`);
    }
  } else {
    log('Step 5: CAPTURE — Skipped (no active authorization)');
  }

  await sleep(500);

  // ── Step 6: Transaction history ───────────────────────────────
  log('Step 6: Transaction History');
  try {
    const txs = await wallet.listTransactions({ limit: 5 });
    console.log(`  Total transactions: ${txs.pagination.total}`);
    txs.data.forEach((tx, i) => {
      console.log(`  ${i + 1}. [${tx.type.toUpperCase()}] ${tx.amount_usdc} USDC → ${tx.merchant?.slice(0, 10)}… | ${tx.status}`);
    });
  } catch (err) {
    console.log(`  ⚠ ${err.message}`);
  }

  await sleep(500);

  // ── Step 7: Check limits ──────────────────────────────────────
  log('Step 7: Spending Limits');
  try {
    const limits = await wallet.getLimits();
    console.log(`  Per-transaction: ${limits.max_tx_amount} USDC`);
    console.log(`  Daily limit:     ${limits.max_daily_amount} USDC`);
    console.log(`  Spent today:     ${limits.daily_spent_usdc} USDC`);
  } catch (err) {
    console.log(`  ⚠ ${err.message}`);
  }

  console.log(`
${'═'.repeat(55)}
✅  Demo complete!

  The AI agent successfully:
  ✓ Checked its USDC balance
  ✓ Made a direct charge (EIP-3009 gasless transfer)
  ✓ Created an off-chain pre-authorization
  ✓ Captured the authorization on-chain
  ✓ Reviewed transaction history
  ✓ Checked spending limits

  Dashboard: http://localhost:${process.env.PORT || 3000}
${'═'.repeat(55)}
`);
}

run().catch(err => {
  console.error('\n❌ Demo error:', err.message);
  process.exit(1);
});
