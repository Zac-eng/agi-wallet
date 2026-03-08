/**
 * server.js – AGI Wallet Express + WebSocket server
 *
 * Provides:
 *  - REST API  (credit-card-style payment endpoints)
 *  - WebSocket (live transaction feed for the dashboard)
 *  - Static    (serves the dashboard from /public)
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

import paymentsRouter from './routes/payments.js';
import walletRouter from './routes/wallet.js';
import { errorHandler } from './middleware/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);

// ── Express App ─────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Serve dashboard
app.use(express.static(join(__dirname, '../../public')));

// API routes
app.use('/v1', paymentsRouter);
app.use('/v1/wallet', walletRouter);

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'agi-wallet',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Global error handler (must be last)
app.use(errorHandler);

// ── HTTP + WebSocket Server ──────────────────────────────────────
const httpServer = createServer(app);

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.send(JSON.stringify({ type: 'connected', message: 'AGI Wallet live feed active' }));

  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));
});

/**
 * Broadcast a transaction update to all connected WebSocket clients.
 * Called from payment routes when a tx is created or updated.
 * @param {object} tx - Transaction record
 */
export function broadcastTx(tx) {
  const payload = JSON.stringify({ type: 'transaction', data: tx });
  for (const client of wsClients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}

// ── Start ────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║        🤖  AGI Wallet — Payment Server               ║
╠══════════════════════════════════════════════════════╣
║  Dashboard   →  http://localhost:${PORT}               ║
║  API Base    →  http://localhost:${PORT}/v1             ║
║  WebSocket   →  ws://localhost:${PORT}/ws               ║
║  Health      →  http://localhost:${PORT}/health         ║
╚══════════════════════════════════════════════════════╝

  Network:  ${process.env.BASE_RPC_URL || '(not configured)'}
  USDC:     ${process.env.USDC_CONTRACT_ADDRESS || '(not configured)'}
  `);
});

export default app;
