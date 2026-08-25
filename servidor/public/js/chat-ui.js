import { onStatusChange, ping, sendMessage, fetchMyBots } from './bridge-client.js';
import { getServerUrl, getAuthHeaders } from './admin-common.js';
import { renderNav, renderAuthHeader, startStatusLoop } from './client-nav.js';

function esc(s) { return s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

let files = [];
let channelName = '';
let chatroomId = '';
let statsTimerId = null;

const COLA_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const colas = {};
COLA_KEYS.forEach(function(k) {
  colas[k] = { fileIndex: -1, intervalMin: 1, intervalMax: 3, running: false, sending: false, order: 'random', spam: false };
});

// Global scheduler: round-robin through active colas
let globalScheduler = { running: false, timerId: null, nextIdx: 0 };

// Unified time mode
function isUnifiedMode() {
  var cb = document.getElementById('unified-mode');
  return cb ? cb.checked : false;
}
function isColaInUnified(key) {
  var cb = document.getElementById('unified-' + key);
  return cb ? cb.checked : false;
}
function getColaInterval(key) {
  var c = colas[key];
  if (isUnifiedMode() && isColaInUnified(key)) {
    var min = parseFloat(document.getElementById('unified-min').value) || 4;
    var max = parseFloat(document.getElementById('unified-max').value) || 10;
    return { min: min, max: max };
  }
  return { min: c.intervalMin, max: c.intervalMax };
}

function parseToBlocks(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length === 0) return [];
  const blocks = [];
  for (let i = 0; i < lines.length; i += 5) {
    blocks.push({ messages: lines.slice(i, i + 5), sent: false });
  }
  return blocks;
}

function getBlockCount(f) { return f.blocks ? f.blocks.length : 0; }
function getTotalSentBlocks(f) { return f.blocks ? f.blocks.filter(b => b.sent).length : 0; }
function allBlocksSent(f) { return f.blocks && f.blocks.length > 0 && f.blocks.every(b => b.sent); }
function loopBlocks(f) { if (!f || !f.blocks) return; for (const b of f.blocks) b.sent = false; f.currentBlock = 0; }
function randInt(min, max) { const a = Math.min(min, max); const b = Math.max(min, max); return (Math.random() * (b - a) + a) * 1000; }

function saveFiles() { try { localStorage.setItem('scb_files', JSON.stringify(files)); } catch {} }
function loadSavedFiles() {
  try {
    const s = localStorage.getItem('scb_files');
    if (s) { const p = JSON.parse(s); for (const f of p) { if (!f.blocks || f.blocks.length === 0) f.blocks = [{ messages: [], sent: false }]; } files = p; }
  } catch {}
}

function renderFileGrid() {
  const g = document.getElementById('file-grid');
  if (!g) return;
  if (files.length === 0) { g.innerHTML = '<div class="empty-state full">Sin archivos. Agregá tus .txt.</div>'; return; }
  g.innerHTML = files.map((f, i) => {
    const t = getBlockCount(f), d = getTotalSentBlocks(f);
    const pct = t > 0 ? Math.round((d / t) * 100) : 0;
    var badges = '';
    COLA_KEYS.forEach(function(k) { if (colas[k].fileIndex === i) badges += '<span class="fc-badge badge-' + k + '">' + k.toUpperCase() + '</span>'; });
    var activeClass = '';
    COLA_KEYS.forEach(function(k) { if (colas[k].fileIndex === i) activeClass += ' file-' + k + '-active'; });
    return '<div class="file-card' + activeClass + '" data-index="' + i + '">' + '<button class="fc-delete" data-index="' + i + '" title="Eliminar">×</button>' + badges + '<span class="fc-name">' + esc(f.name) + '</span><div class="fc-prog"><div class="fc-bar" style="width:' + pct + '%"></div></div><span class="fc-meta">' + d + '/' + t + ' bloques</span></div>';
  }).join('');
  g.querySelectorAll('.fc-delete').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      deleteFile(parseInt(btn.dataset.index));
    });
  });
}

function deleteFile(index) {
  if (index < 0 || index >= files.length) return;
  var f = files[index];
  if (!confirm('Eliminar "' + f.name + '"?')) return;
  COLA_KEYS.forEach(function(k) {
    if (colas[k].fileIndex === index) {
      stopCola(k);
      colas[k].fileIndex = -1;
    } else if (colas[k].fileIndex > index) {
      colas[k].fileIndex--;
    }
  });
  files.splice(index, 1);
  saveFiles();
  renderFileGrid();
  renderFileSelects();
}

function renderFileSelects() {
  var opts = '<option value="">Elegí archivo</option>' + files.map(function(f, i) { return '<option value="' + i + '">' + esc(f.name) + '</option>'; }).join('');
  COLA_KEYS.forEach(function(k) {
    var sel = document.getElementById('file-' + k + '-select');
    if (sel) { var prev = sel.value; sel.innerHTML = opts; if (prev) sel.value = prev; }
  });
}

function setColaStatus(key, text) {
  var el = document.getElementById('status-' + key);
  if (el) el.textContent = text;
}

function updateColaUI(key) {
  var c = colas[key];
  var sb = document.getElementById('start-' + key);
  var tb = document.getElementById('stop-' + key);
  if (sb) sb.disabled = c.running;
  if (tb) tb.disabled = !c.running;
  var ce = document.getElementById('count-' + key);
  var be = document.getElementById('bar-' + key);
  if (!isNaN(c.fileIndex) && c.fileIndex >= 0 && c.fileIndex < files.length) {
    var f = files[c.fileIndex], t = getBlockCount(f), d = getTotalSentBlocks(f);
    if (ce) ce.textContent = d + '/' + t + ' bloques';
    if (be) be.style.width = (t > 0 ? Math.round((d / t) * 100) : 0) + '%';
  }
}

async function sendOne(msg, colaKey) {
  try {
    var res = await sendMessage({ channel: channelName, message: msg, chatroom_id: chatroomId || undefined });
    return res;
  } catch (e) {
    return { ok: false, error: e.message, status: 0 };
  }
}

// Send ONE message from the next active cola (global round-robin)
async function globalSendOne() {
  var activeKeys = COLA_KEYS.filter(function(k) { return colas[k].running && !isNaN(colas[k].fileIndex) && colas[k].fileIndex >= 0; });
  if (activeKeys.length === 0) return;

  // Pick next cola in round-robin
  if (globalScheduler.nextIdx >= activeKeys.length) globalScheduler.nextIdx = 0;
  var key = activeKeys[globalScheduler.nextIdx];
  globalScheduler.nextIdx = (globalScheduler.nextIdx + 1) % activeKeys.length;

  var c = colas[key];
  if (c.sending) return;
  c.sending = true;

  var selEl = document.getElementById('file-' + key + '-select');
  var val = selEl ? selEl.value : '';
  var fileIdx = parseInt(val, 10);

  if (isNaN(fileIdx) || fileIdx < 0 || fileIdx >= files.length) {
    setColaStatus(key, 'Sin archivo');
    c.sending = false;
    return;
  }

  c.fileIndex = fileIdx;
  var file = files[fileIdx];
  if (!file || !file.blocks || file.blocks.length === 0) {
    setColaStatus(key, 'Archivo vacío');
    c.sending = false;
    return;
  }

  if (allBlocksSent(file)) loopBlocks(file);

  var unsent = [];
  for (var i = 0; i < file.blocks.length; i++) { if (!file.blocks[i].sent) unsent.push(i); }
  if (unsent.length === 0) { loopBlocks(file); unsent = file.blocks.map(function(_, i) { return i; }); }

  var blockIdx;
  if (c.order === 'sequential') {
    blockIdx = unsent[0];
  } else {
    blockIdx = unsent[Math.floor(Math.random() * unsent.length)];
  }
  file.currentBlock = blockIdx;
  var block = file.blocks[blockIdx];

  // Pick next message from the block
  var msgIdx = file._nextMsgIdx || 0;
  if (msgIdx >= block.messages.length) msgIdx = 0;
  var msg = block.messages[msgIdx];
  file._nextMsgIdx = msgIdx + 1;

  setColaStatus(key, '[' + key.toUpperCase() + '] ' + msg.substring(0, 45));
  updateColaUI(key);

  var res = await sendOne(msg, key);
  var username = res.username || '?';
  if (res.ok) {
    setColaStatus(key, username + ' ✓ [' + key.toUpperCase() + '] ' + msg.substring(0, 35));
  } else {
    setColaStatus(key, 'ERR (' + (res.status || '?') + '): ' + (res.error || res.message || '').substring(0, 40));
  }
  refreshStats();

  // If all messages in block sent, mark block done
  if (file._nextMsgIdx >= block.messages.length) {
    block.sent = true;
    file._nextMsgIdx = 0;
    saveFiles();
    renderFileGrid();
    if (allBlocksSent(file)) {
      loopBlocks(file);
      saveFiles();
      renderFileGrid();
    }
  }

  c.sending = false;
  updateColaUI(key);
}

function globalSchedulerTick() {
  if (!globalScheduler.running) return;
  globalSendOne().catch(function() {}).then(function() {
    if (!globalScheduler.running) return;
    // Pick interval from the cola that just sent
    var activeKeys = COLA_KEYS.filter(function(k) { return colas[k].running && !isNaN(colas[k].fileIndex) && colas[k].fileIndex >= 0; });
    if (activeKeys.length === 0) { globalScheduler.running = false; return; }
    var idx = (globalScheduler.nextIdx - 1 + activeKeys.length) % activeKeys.length;
    var key = activeKeys[idx];
    var c = colas[key];
    var interval = getColaInterval(key);
    var delay = c.spam ? (500 + Math.random() * 1000) : randInt(interval.min, interval.max);
    globalScheduler.timerId = setTimeout(globalSchedulerTick, delay);
  });
}

function startGlobalScheduler() {
  if (globalScheduler.running) return;
  globalScheduler.running = true;
  globalScheduler.nextIdx = 0;
  console.log('[GLOBAL] Scheduler started');
  globalSchedulerTick();
}

function stopGlobalScheduler() {
  globalScheduler.running = false;
  if (globalScheduler.timerId) { clearTimeout(globalScheduler.timerId); globalScheduler.timerId = null; }
  console.log('[GLOBAL] Scheduler stopped');
}

function getActiveColaCount() {
  var count = 0;
  COLA_KEYS.forEach(function(k) { if (colas[k].running) count++; });
  return count;
}

function startCola(key) {
  var c = colas[key];
  if (c.running) return;
  var sel = document.getElementById('file-' + key + '-select');
  var fileIdx = parseInt(sel ? sel.value : '', 10);
  if (isNaN(fileIdx)) { alert('Elegí un archivo para la cola ' + key.toUpperCase()); return; }
  if (!channelName && !chatroomId) { alert('Configurá el canal en Ajustes.'); return; }
  c.fileIndex = fileIdx;
  c.intervalMin = parseFloat(document.getElementById('interval-' + key + '-min').value) || 3;
  c.intervalMax = parseFloat(document.getElementById('interval-' + key + '-max').value) || 8;
  var orderSel = document.getElementById('order-' + key);
  c.order = orderSel ? orderSel.value : 'random';
  var spamCb = document.getElementById('spam-' + key);
  c.spam = spamCb ? spamCb.checked : false;
  c.running = true;
  var card = document.querySelector('.cola-' + key);
  if (card) { if (c.spam) card.classList.add('spam-active'); else card.classList.remove('spam-active'); }
  updateColaUI(key);
  setColaStatus(key, 'Cola ' + key.toUpperCase() + ' activa');

  // Start global scheduler if not running
  startGlobalScheduler();
}

function stopCola(key) {
  var c = colas[key];
  c.running = false;
  var card = document.querySelector('.cola-' + key);
  if (card) card.classList.remove('spam-active');
  updateColaUI(key);
  setColaStatus(key, 'Parada');

  // Stop global scheduler if no colas active
  if (getActiveColaCount() === 0) stopGlobalScheduler();
}

function resetCola(key) {
  stopCola(key);
  var sel = document.getElementById('file-' + key + '-select');
  var fileIdx = parseInt(sel ? sel.value : '', 10);
  if (!isNaN(fileIdx) && fileIdx >= 0 && fileIdx < files.length) {
    var f = files[fileIdx];
    for (var i = 0; i < f.blocks.length; i++) f.blocks[i].sent = false;
    f.currentBlock = 0;
    saveFiles();
    renderFileGrid();
  }
  setColaStatus(key, 'Reiniciado');
  updateColaUI(key);
}

async function refreshStats() {
  var container = document.getElementById('bots-stats');
  if (!container) return;
  try {
    var url = getServerUrl();
    var res = await fetch(url + '/api/chat/send-stats', { headers: getAuthHeaders() });
    var data = await res.json();
    if (!data.success || !data.bots || data.bots.length === 0) {
      container.innerHTML = '<div class="empty-state">Aún no se enviaron mensajes.</div>';
      return;
    }
    container.innerHTML = data.bots.map(function(b) {
      return '<div class="bot-stat ' + (b.count > 0 ? 'top' : '') + '"><span class="bs-count">' + (b.count || 0) + '</span><span class="bs-name" title="' + esc(b.botId) + '">' + esc(b.botId) + '</span></div>';
    }).join('');
  } catch {}
}

function resetStats() {
  try { fetch(getServerUrl() + '/api/chat/send-stats/reset', { method: 'POST', headers: getAuthHeaders() }).then(refreshStats); } catch {}
}

function normalizeChannel(input) {
  if (!input) return '';
  var s = String(input).trim();
  try { var u = new URL(s); s = u.pathname; } catch {}
  s = s.replace(/^https?:\/\/(www\.)?kick\.com\//i, '');
  s = s.split('?')[0].split('#')[0].replace(/^\/+|\/+$/g, '');
  return s;
}

function loadSettings() {
  var saved = JSON.parse(localStorage.getItem('scb_settings') || '{}');
  if (saved.channelName) channelName = normalizeChannel(saved.channelName);
  if (saved.chatroomId) chatroomId = saved.chatroomId;
}

function handleLoadFile() {
  var input = document.createElement('input');
  input.type = 'file'; input.accept = '.txt'; input.multiple = true;
  input.addEventListener('change', async function() {
    var fileList = input.files;
    if (!fileList || fileList.length === 0) return;
    for (var fi = 0; fi < fileList.length; fi++) {
      var text = await fileList[fi].text();
      var blocks = parseToBlocks(text);
      files.push({ name: fileList[fi].name, blocks: blocks, currentBlock: 0 });
    }
    saveFiles();
    renderFileGrid();
    renderFileSelects();
  });
  input.click();
}

export async function initChatUI() {
  var token = sessionStorage.getItem('scb_jwt') || localStorage.getItem('scb_jwt');
  var headers = token ? { 'Authorization': 'Bearer ' + token } : {};
  try {
    var res = await fetch('/auth/me', { headers: headers });
    if (!res.ok) { window.location.href = '/'; return; }
    var data = await res.json();
    if (data.user.role === 'admin') { window.location.href = '/admin/dashboard'; return; }
    if (token) fetch('/auth/sync-cookie', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } }).catch(function() {});
  } catch { window.location.href = '/'; return; }

  renderAuthHeader('chat');
  renderNav('chat');
  startStatusLoop();

  document.getElementById('load-file-btn').addEventListener('click', handleLoadFile);

  COLA_KEYS.forEach(function(k) {
    document.getElementById('start-' + k).addEventListener('click', function() { startCola(k); });
    document.getElementById('stop-' + k).addEventListener('click', function() { stopCola(k); });
    document.getElementById('reset-' + k).addEventListener('click', function() { resetCola(k); });
    var spamCb = document.getElementById('spam-' + k);
    if (spamCb) {
      spamCb.addEventListener('change', function() {
        colas[k].spam = spamCb.checked;
        var card = document.querySelector('.cola-' + k);
        if (card) { if (spamCb.checked) card.classList.add('spam-active'); else card.classList.remove('spam-active'); }
      });
    }
  });

  document.getElementById('reset-stats-btn').addEventListener('click', resetStats);

  // Unified time mode toggle
  var unifiedCb = document.getElementById('unified-mode');
  if (unifiedCb) {
    unifiedCb.addEventListener('change', function() {
      var ui = document.getElementById('unified-interval');
      if (ui) ui.style.display = unifiedCb.checked ? 'flex' : 'none';
    });
  }

  loadSettings();
  loadSavedFiles();
  renderFileGrid();
  renderFileSelects();
  refreshStats();
  statsTimerId = setInterval(refreshStats, 2500);
}

window.addEventListener('beforeunload', function() {
  if (statsTimerId) clearInterval(statsTimerId);
  COLA_KEYS.forEach(function(k) { stopCola(k); });
});

window.addGeneratedMessages = function(msgs, name) {
  var msgLines = msgs.map(function(m) { return m.user + ': ' + m.message; });
  files.push({ name: name || 'IA - ' + new Date().toLocaleTimeString(), blocks: [{ messages: msgLines, sent: false }], currentBlock: 0 });
  saveFiles();
  renderFileGrid();
  renderFileSelects();
};

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', function() { initChatUI(); });
}
