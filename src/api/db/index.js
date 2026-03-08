/**
 * db/index.js – SQLite transaction ledger
 * Uses the built-in node:sqlite module (Node ≥ 22.5, no native compilation).
 */

import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../../data/agi-wallet.sqlite');

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

// Pragmas
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id            TEXT PRIMARY KEY,
    type          TEXT NOT NULL,
    status        TEXT NOT NULL,
    amount_usdc   REAL NOT NULL,
    merchant      TEXT NOT NULL,
    description   TEXT,
    metadata      TEXT,
    tx_hash       TEXT,
    block_number  INTEGER,
    gas_used      TEXT,
    auth_nonce    TEXT,
    parent_id     TEXT,
    error         TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    settled_at    INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
  CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);

  CREATE TABLE IF NOT EXISTS daily_totals (
    date_utc    TEXT PRIMARY KEY,
    total_usdc  REAL NOT NULL DEFAULT 0
  );
`);

// ── Prepared statements ────────────────────────────────────────

const stmtInsert = db.prepare(`
  INSERT INTO transactions
    (id, type, status, amount_usdc, merchant, description, metadata,
     tx_hash, block_number, gas_used, auth_nonce, parent_id, error, created_at, updated_at, settled_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtSelectOne = db.prepare('SELECT * FROM transactions WHERE id = ?');

export function insertTransaction(tx) {
  const now = Date.now();
  stmtInsert.run(
    tx.id,
    tx.type,
    tx.status,
    tx.amount_usdc,
    tx.merchant,
    tx.description ?? null,
    tx.metadata ? JSON.stringify(tx.metadata) : null,
    tx.tx_hash ?? null,
    tx.block_number ?? null,
    tx.gas_used ?? null,
    tx.auth_nonce ?? null,
    tx.parent_id ?? null,
    tx.error ?? null,
    now,
    now,
    tx.settled_at ?? null,
  );
}

export function updateTransaction(id, updates) {
  const allowed = ['status', 'tx_hash', 'block_number', 'gas_used', 'auth_nonce', 'error', 'settled_at'];
  const fields = Object.keys(updates).filter(k => allowed.includes(k));
  if (fields.length === 0) return;

  for (const field of fields) {
    const val = updates[field] ?? null;
    db.prepare(`UPDATE transactions SET ${field} = ?, updated_at = ? WHERE id = ?`)
      .run(val, Date.now(), id);
  }
}

export function getTransaction(id) {
  const row = stmtSelectOne.get(id);
  return row ? parseRow(row) : null;
}

export function listTransactions({ limit = 20, offset = 0, status, type } = {}) {
  let query = 'SELECT * FROM transactions WHERE 1=1';
  const params = [];

  if (status) { query += ' AND status = ?'; params.push(status); }
  if (type)   { query += ' AND type = ?';   params.push(type); }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params);
  const { cnt } = db.prepare('SELECT COUNT(*) as cnt FROM transactions').get();
  return { rows: rows.map(parseRow), total: cnt };
}

// ── Daily spending limits ──────────────────────────────────────

export function getDailyTotal(dateUtc) {
  const row = db.prepare('SELECT total_usdc FROM daily_totals WHERE date_utc = ?').get(dateUtc);
  return row ? row.total_usdc : 0;
}

export function addToDailyTotal(dateUtc, amount) {
  db.prepare(`
    INSERT INTO daily_totals (date_utc, total_usdc) VALUES (?, ?)
    ON CONFLICT(date_utc) DO UPDATE SET total_usdc = total_usdc + excluded.total_usdc
  `).run(dateUtc, amount);
}

function parseRow(row) {
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  };
}

export { db };
export default db;
