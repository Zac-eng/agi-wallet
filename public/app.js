/**
 * public/app.js – Dashboard frontend application
 * Connects to the AGI Wallet API server and drives all 4 tabs.
 */

const API_KEY = 'your-secret-api-key-here'; // Replace with real key in production
const API_BASE = window.location.origin;
const WS_URL   = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

let wsConn = null;
let liveFeedCount = 0;
let txOffset = 0;
const TX_LIMIT = 10;

// ── API helper ────────────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ── Tab switching ─────────────────────────────────────────────
function showTab(tab) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');

  const titles = { dashboard: 'Dashboard', transactions: 'Transactions', pay: 'Pay', limits: 'Limits' };
  document.getElementById('tabTitle').textContent = titles[tab] || tab;

  if (tab === 'transactions') loadTransactions();
  if (tab === 'limits') loadLimits();
}

// ── Format helpers ────────────────────────────────────────────
function shortAddr(addr) {
  if (!addr) return '—';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function shortHash(hash) {
  if (!hash) return '—';
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
}

function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function statusBadge(status) {
  const map = {
    confirmed:  'badge-green',
    pending:    'badge-yellow',
    processing: 'badge-blue',
    failed:     'badge-red',
    cancelled:  'badge-dim',
  };
  return `<span class="badge ${map[status] || 'badge-dim'}">${status}</span>`;
}

function typeBadge(type) {
  return `<span class="type-${type}">${type.toUpperCase()}</span>`;
}

function txHashLink(hash) {
  if (!hash) return '—';
  const baseExplorer = 'https://sepolia.basescan.org/tx/';
  return `<a class="tx-hash-link" href="${baseExplorer}${hash}" target="_blank" rel="noopener">${shortHash(hash)}</a>`;
}

// ── Dashboard: load balance ───────────────────────────────────
async function loadBalance() {
  try {
    const data = await api('GET', '/v1/wallet/balance');
    if (data.error) return;

    document.getElementById('usdcBalance').textContent = `${parseFloat(data.usdc.balance).toFixed(2)} USDC`;
    document.getElementById('balanceAddress').textContent = data.address;
    document.getElementById('walletAddress').innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="1"/></svg>${shortAddr(data.address)}`;
    document.getElementById('ethBalance').textContent = `${parseFloat(data.eth.balance).toFixed(6)} ETH`;

    const ethF = parseFloat(data.eth.balance);
    const gasNotice = document.getElementById('gasNotice');
    if (ethF < 0.001) {
      gasNotice.textContent = '⚠ Low ETH — top up for gas';
    } else {
      gasNotice.textContent = '';
    }

    document.getElementById('dailySpent').textContent = `${(data.daily_spent_usdc || 0).toFixed(2)} USDC`;

    const limits = await api('GET', '/v1/wallet/limits');
    const dailyLimit = limits.max_daily_amount || 1000;
    const pct = Math.min(100, ((data.daily_spent_usdc || 0) / dailyLimit) * 100);
    document.getElementById('dailyLimit').textContent = `${dailyLimit} USDC`;
    document.getElementById('dailyBar').style.width = `${pct}%`;
  } catch { /* silent */ }
}

async function loadNetwork() {
  try {
    const data = await api('GET', '/v1/wallet/network');
    if (data.error) return;
    const chainName = data.name || `Chain ${data.chainId}`;
    document.getElementById('networkName').textContent = chainName;
    document.getElementById('chainId').textContent = `Chain ID ${data.chainId}`;
    document.getElementById('networkBadge').textContent = data.chainId == 84532 ? 'Base Sepolia' : data.chainId == 8453 ? 'Base Mainnet' : chainName;
  } catch { /* silent */ }
}

// ── Dashboard: load recent transactions ──────────────────────
async function loadRecentTx() {
  const tbody = document.getElementById('recentTxBody');
  try {
    const data = await api('GET', '/v1/transactions?limit=5');
    if (!data.data || data.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No transactions yet</td></tr>';
      return;
    }
    tbody.innerHTML = data.data.map(tx => `
      <tr>
        <td><span class="mono">${tx.id.slice(0, 8)}…</span></td>
        <td>${typeBadge(tx.type)}</td>
        <td><strong>${tx.amount_usdc.toFixed(2)} USDC</strong></td>
        <td><span class="mono">${shortAddr(tx.merchant)}</span></td>
        <td>${statusBadge(tx.status)}</td>
        <td>${fmtDate(tx.created_at)}</td>
      </tr>
    `).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Failed to load</td></tr>';
  }
}

// ── Transactions Tab ──────────────────────────────────────────
async function loadTransactions() {
  const tbody = document.getElementById('allTxBody');
  tbody.innerHTML = '<tr><td colspan="8" class="empty-row">Loading…</td></tr>';

  const type   = document.getElementById('filterType').value;
  const status = document.getElementById('filterStatus').value;
  let path = `/v1/transactions?limit=${TX_LIMIT}&offset=${txOffset}`;
  if (type)   path += `&type=${type}`;
  if (status) path += `&status=${status}`;

  try {
    const data = await api('GET', path);
    if (!data.data || data.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No transactions found</td></tr>';
      document.getElementById('pagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = data.data.map(tx => `
      <tr>
        <td><span class="mono" title="${tx.id}">${tx.id.slice(0, 8)}…</span></td>
        <td>${typeBadge(tx.type)}</td>
        <td><strong>${tx.amount_usdc.toFixed(2)} USDC</strong></td>
        <td><span class="mono">${shortAddr(tx.merchant)}</span></td>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${tx.description || '—'}</td>
        <td>${statusBadge(tx.status)}</td>
        <td>${txHashLink(tx.tx_hash)}</td>
        <td>${fmtDate(tx.created_at)}</td>
      </tr>
    `).join('');

    renderPagination(data.pagination);
  } catch {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">Failed to load</td></tr>';
  }
}

function renderPagination({ total, limit, offset }) {
  const pages = Math.ceil(total / limit);
  const current = Math.floor(offset / limit);
  const pag = document.getElementById('pagination');

  if (pages <= 1) { pag.innerHTML = ''; return; }

  let html = '';
  for (let i = 0; i < pages; i++) {
    html += `<button class="page-btn ${i === current ? 'active' : ''}" onclick="gotoPage(${i})">${i + 1}</button>`;
  }
  pag.innerHTML = html;
}

function gotoPage(page) {
  txOffset = page * TX_LIMIT;
  loadTransactions();
}

// ── Pay Tab ───────────────────────────────────────────────────
async function doCharge(e) {
  e.preventDefault();
  const btn = document.getElementById('chargeBtn');
  const result = document.getElementById('chargeResult');
  btn.disabled = true;
  btn.textContent = 'Processing…';

  try {
    const data = await api('POST', '/v1/charge', {
      amount:      parseFloat(document.getElementById('chargeAmount').value),
      merchant:    document.getElementById('chargeMerchant').value.trim(),
      description: document.getElementById('chargeDescription').value.trim() || undefined,
    });

    if (data.error) throw new Error(data.message || data.error);

    result.className = 'result-box success';
    result.textContent = `✅ Charged ${data.amount} USDC\n` +
      `ID: ${data.id}\nTx: ${data.tx_hash || 'pending'}\nBlock: ${data.block_number || '—'}`;

    e.target.reset();
  } catch (err) {
    result.className = 'result-box error';
    result.textContent = `❌ ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Charge USDC';
    refreshDashboard();
  }
}

let lastAuthId = null;

async function doAuthorize(e) {
  e.preventDefault();
  const btn = document.getElementById('authBtn');
  const result = document.getElementById('authResult');
  btn.disabled = true;
  btn.textContent = 'Authorizing…';

  try {
    const data = await api('POST', '/v1/authorize', {
      amount:      parseFloat(document.getElementById('authAmount').value),
      merchant:    document.getElementById('authMerchant').value.trim(),
      description: document.getElementById('authDescription').value.trim() || undefined,
    });

    if (data.error) throw new Error(data.message || data.error);

    lastAuthId = data.id;
    document.getElementById('captureId').value = data.id;

    result.className = 'result-box success';
    result.textContent = `🔐 Authorized ${data.amount} USDC\nID: ${data.id}\nNonce: ${data.auth_nonce?.slice(0, 18)}…\nExpires: ${new Date(data.expires_at * 1000).toLocaleString()}`;

    e.target.reset();
  } catch (err) {
    result.className = 'result-box error';
    result.textContent = `❌ ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Authorize';
  }
}

async function doCapture(e) {
  e.preventDefault();
  const btn = document.getElementById('captureBtn');
  const result = document.getElementById('captureResult');
  const id = document.getElementById('captureId').value.trim();
  btn.disabled = true;
  btn.textContent = 'Capturing…';

  try {
    const data = await api('POST', `/v1/capture/${id}`);
    if (data.error) throw new Error(data.message || data.error);

    result.className = 'result-box success';
    result.textContent = `⚡ Captured ${data.amount} USDC\nTx: ${data.tx_hash || '—'}\nBlock: ${data.block_number || '—'}`;

    e.target.reset();
  } catch (err) {
    result.className = 'result-box error';
    result.textContent = `❌ ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Capture Payment';
    refreshDashboard();
  }
}

// ── Limits Tab ────────────────────────────────────────────────
async function loadLimits() {
  try {
    const data = await api('GET', '/v1/wallet/limits');
    if (data.error) return;

    document.getElementById('limitTxDisplay').textContent = `${data.max_tx_amount} USDC`;
    document.getElementById('limitDailyDisplay').textContent = `${data.max_daily_amount} USDC`;
    document.getElementById('limitSpentDisplay').textContent = `${(data.daily_spent_usdc || 0).toFixed(2)} USDC`;

    const pct = Math.min(100, ((data.daily_spent_usdc || 0) / data.max_daily_amount) * 100);
    document.getElementById('gaugePct').textContent = `${Math.round(pct)}%`;
    drawGauge(pct);
  } catch { /* silent */ }
}

async function doSetLimits(e) {
  e.preventDefault();
  const result = document.getElementById('limitsResult');
  const body = {};
  const tx = parseFloat(document.getElementById('newTxLimit').value);
  const daily = parseFloat(document.getElementById('newDailyLimit').value);
  if (!isNaN(tx))    body.max_tx_amount    = tx;
  if (!isNaN(daily)) body.max_daily_amount = daily;

  try {
    const data = await api('PUT', '/v1/wallet/limits', body);
    if (data.error) throw new Error(data.message);

    result.className = 'result-box success';
    result.textContent = `✅ Limits updated\nPer-tx: ${data.max_tx_amount} USDC | Daily: ${data.max_daily_amount} USDC`;
    e.target.reset();
    loadLimits();
  } catch (err) {
    result.className = 'result-box error';
    result.textContent = `❌ ${err.message}`;
  }
}

// ── Gauge Canvas ──────────────────────────────────────────────
function drawGauge(pct) {
  const canvas = document.getElementById('gaugeCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2 + 15;
  const r = 85;
  const startAngle = Math.PI * 1.15;
  const endAngle   = Math.PI * 1.85;
  const valueAngle = startAngle + (endAngle - startAngle) * (pct / 100);

  ctx.clearRect(0, 0, w, h);

  // Track
  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, endAngle);
  ctx.lineWidth = 16;
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineCap = 'round';
  ctx.stroke();

  // Fill
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#4f8ef7');
  grad.addColorStop(1, pct > 80 ? '#ef4444' : '#8b5cf6');

  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, valueAngle);
  ctx.lineWidth = 16;
  ctx.strokeStyle = grad;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Glow dot
  const dotX = cx + r * Math.cos(valueAngle);
  const dotY = cy + r * Math.sin(valueAngle);
  ctx.beginPath();
  ctx.arc(dotX, dotY, 8, 0, 2 * Math.PI);
  ctx.fillStyle = pct > 80 ? '#ef4444' : '#8b5cf6';
  ctx.shadowColor = pct > 80 ? '#ef4444' : '#8b5cf6';
  ctx.shadowBlur = 12;
  ctx.fill();
  ctx.shadowBlur = 0;
}

// ── Live Feed via WebSocket ───────────────────────────────────
function connectWS() {
  try {
    wsConn = new WebSocket(WS_URL);

    wsConn.onopen = () => {
      const dot  = document.querySelector('.dot');
      const span = document.querySelector('.connection-status span:last-child');
      dot.className  = 'dot connected';
      span.textContent = 'Live';
    };

    wsConn.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'transaction') {
          addFeedItem(msg.data);
          loadRecentTx();
          loadBalance();
        }
      } catch { /* ignore */ }
    };

    wsConn.onclose = () => {
      const dot  = document.querySelector('.dot');
      const span = document.querySelector('.connection-status span:last-child');
      dot.className  = 'dot disconnected';
      span.textContent = 'Disconnected';
      setTimeout(connectWS, 3000); // reconnect
    };

    wsConn.onerror = () => wsConn.close();
  } catch { /* silent */ }
}

function addFeedItem(tx) {
  const feed = document.getElementById('liveFeed');
  const empty = feed.querySelector('.feed-empty');
  if (empty) empty.remove();

  liveFeedCount++;
  document.getElementById('liveFeedCount').textContent = `${liveFeedCount} event${liveFeedCount !== 1 ? 's' : ''}`;

  const item = document.createElement('div');
  item.className = 'feed-item';
  item.innerHTML = `
    <span class="feed-time">${fmtTime(Date.now())}</span>
    ${statusBadge(tx.status)}
    ${typeBadge(tx.type)}
    <strong>${tx.amount_usdc?.toFixed(2)} USDC</strong>
    <span style="color:var(--text-dim);font-size:0.72rem">→ ${shortAddr(tx.merchant)}</span>
    ${tx.description ? `<span style="color:var(--text-dim);font-size:0.72rem">${tx.description}</span>` : ''}
  `;
  feed.prepend(item);

  // Keep feed from growing too large
  const items = feed.querySelectorAll('.feed-item');
  if (items.length > 20) items[items.length - 1].remove();
}

// ── Global refresh ────────────────────────────────────────────
async function refreshDashboard() {
  await Promise.all([loadBalance(), loadRecentTx()]);
}

async function refreshAll() {
  await refreshDashboard();
  await loadNetwork();
}

// ── Init ──────────────────────────────────────────────────────
(async function init() {
  await refreshAll();
  connectWS();
  drawGauge(0);

  // Auto-refresh balance every 30s
  setInterval(refreshDashboard, 30_000);
})();
