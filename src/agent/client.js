/**
 * src/agent/client.js – AGI Wallet Agent SDK
 *
 * Type-friendly JavaScript client for AI agents to call the payment API.
 * Mirrors the credit-card feel: charge(), authorize(), capture(), refund().
 *
 * Usage:
 *   import { AGIWalletClient } from './src/agent/client.js';
 *   const wallet = new AGIWalletClient({ baseUrl: 'http://localhost:3000', apiKey: '...' });
 *   const receipt = await wallet.charge({ amount: 1.50, merchant: '0x...', description: 'GPT-4 call' });
 */

export class AGIWalletClient {
  /**
   * @param {object} config
   * @param {string} config.baseUrl - AGI Wallet server URL (e.g. "http://localhost:3000")
   * @param {string} config.apiKey  - Bearer API key
   * @param {number} [config.timeout] - Request timeout in ms (default 30000)
   */
  constructor({ baseUrl, apiKey, timeout = 30_000 }) {
    if (!baseUrl) throw new Error('AGIWalletClient: baseUrl is required');
    if (!apiKey)  throw new Error('AGIWalletClient: apiKey is required');

    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey  = apiKey;
    this.timeout = timeout;
  }

  // ── Private helpers ──────────────────────────────────────────

  async _request(method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await response.json();

      if (!response.ok) {
        const err = new Error(data.message || `HTTP ${response.status}`);
        err.status = response.status;
        err.code   = data.error;
        err.data   = data;
        throw err;
      }

      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Public API ───────────────────────────────────────────────

  /**
   * Single-step USDC charge (like a credit card purchase).
   * Transfers USDC on-chain immediately.
   *
   * @param {object} params
   * @param {number} params.amount      - Amount in USDC (e.g. 1.50)
   * @param {string} params.merchant    - Recipient address ("0x...")
   * @param {string} [params.description]
   * @param {object} [params.metadata]
   * @returns {Promise<ChargeReceipt>}
   */
  async charge({ amount, merchant, description, metadata } = {}) {
    return this._request('POST', '/v1/charge', { amount, merchant, description, metadata });
  }

  /**
   * Authorize an amount (off-chain reservation, no on-chain transfer yet).
   * Use capture() later to actually move the funds.
   *
   * @param {object} params
   * @returns {Promise<AuthorizationReceipt>}
   */
  async authorize({ amount, merchant, description, metadata } = {}) {
    return this._request('POST', '/v1/authorize', { amount, merchant, description, metadata });
  }

  /**
   * Capture a previously authorized amount (submit on-chain).
   * @param {string} authorizationId - ID returned by authorize()
   * @returns {Promise<CaptureReceipt>}
   */
  async capture(authorizationId) {
    return this._request('POST', `/v1/capture/${authorizationId}`);
  }

  /**
   * Refund USDC to a merchant.
   * @param {object} params
   * @param {number} params.amount
   * @param {string} params.merchant
   * @param {string} [params.description]
   * @param {string} [params.original_transaction_id]
   * @returns {Promise<RefundReceipt>}
   */
  async refund({ amount, merchant, description, original_transaction_id, metadata } = {}) {
    return this._request('POST', '/v1/refund', {
      amount, merchant, description, original_transaction_id, metadata,
    });
  }

  /**
   * Get USDC + ETH balance and daily spend.
   * @returns {Promise<BalanceInfo>}
   */
  async getBalance() {
    return this._request('GET', '/v1/wallet/balance');
  }

  /**
   * Get wallet public address.
   * @returns {Promise<{address: string}>}
   */
  async getAddress() {
    return this._request('GET', '/v1/wallet/address');
  }

  /**
   * List transactions.
   * @param {object} [opts]
   * @param {number} [opts.limit=20]
   * @param {number} [opts.offset=0]
   * @param {string} [opts.status]  - 'pending'|'confirmed'|'failed'
   * @param {string} [opts.type]    - 'charge'|'authorize'|'capture'|'refund'
   */
  async listTransactions({ limit = 20, offset = 0, status, type } = {}) {
    const params = new URLSearchParams({ limit, offset });
    if (status) params.set('status', status);
    if (type)   params.set('type', type);
    return this._request('GET', `/v1/transactions?${params}`);
  }

  /**
   * Get a single transaction by ID.
   * @param {string} id
   */
  async getTransaction(id) {
    return this._request('GET', `/v1/transactions/${id}`);
  }

  /**
   * Get current spending limits.
   */
  async getLimits() {
    return this._request('GET', '/v1/wallet/limits');
  }

  /**
   * Update spending limits (in USDC).
   * @param {object} params
   * @param {number} [params.max_tx_amount]
   * @param {number} [params.max_daily_amount]
   */
  async setLimits({ max_tx_amount, max_daily_amount } = {}) {
    return this._request('PUT', '/v1/wallet/limits', { max_tx_amount, max_daily_amount });
  }

  /**
   * Check server health.
   */
  async health() {
    return this._request('GET', '/health');
  }

  /**
   * Subscribe to live transaction updates via WebSocket.
   * @param {function} onTransaction - Called with each transaction event
   * @param {function} [onError]
   * @returns {WebSocket} ws instance (call .close() to disconnect)
   */
  subscribe(onTransaction, onError) {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/ws';
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'transaction') onTransaction(msg.data);
      } catch { /* ignore parse errors */ }
    };

    if (onError) ws.onerror = onError;

    return ws;
  }
}

export default AGIWalletClient;
