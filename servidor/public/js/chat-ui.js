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
// Cola "EN VIVO" (cola 9): alimentada por la casilla de texto, no por un .txt
colas.live = { fileIndex: -1, intervalMin: 2, intervalMax: 6, running: false, sending: false, order: 'random', spam: false, idx: 0 };

const COLA_META = {
  a: { min: 15, max: 20 }, b: { min: 1, max: 3 }, c: { min: 1, max: 3 }, d: { min: 1, max: 3 },
  e: { min: 1, max: 3 }, f: { min: 1, max: 3 }, g: { min: 1, max: 3 }, h: { min: 1, max: 3 },
};

let sentTotal = 0;
let failedTotal = 0;
let kickOk = null; // null = sin datos, true/false = último envío
let botCount = 0;

function buildColaCards() {
  const host = document.getElementById('colas');
  if (!host || host.dataset.built) return;
  host.dataset.built = '1';
  host.innerHTML = COLA_KEYS.map(function(k) {
    const m = COLA_META[k];
    const K = k.toUpperCase();
    return '' +
      '<div class="cola-card cola-' + k + '">' +
        '<div class="cc-head">' +
          '<span class="cc-dot dot-' + k + '"></span>' +
          '<span class="cc-name">Cola ' + K + '</span>' +
          '<span id="badge-' + k + '" class="cc-badge">detenida</span>' +
        '</div>' +
        '<div class="cc-field">' +
          '<span class="cc-lbl">Archivo</span>' +
          '<select id="file-' + k + '-select" class="cc-select"><option value="">— elegí archivo —</option></select>' +
        '</div>' +
        '<div class="cc-row">' +
          '<div class="cc-field">' +
            '<span class="cc-lbl">Enviar cada</span>' +
            '<div class="cc-rate">' +
              '<input id="interval-' + k + '-min" type="number" min="1" max="600" value="' + m.min + '" class="cc-num">' +
              '<span>a</span>' +
              '<input id="interval-' + k + '-max" type="number" min="1" max="600" value="' + m.max + '" class="cc-num">' +
              '<span>s</span>' +
            '</div>' +
          '</div>' +
          '<label class="cc-check" title="Ignora el tiempo y manda lo más rápido posible"><input type="checkbox" id="spam-' + k + '">⚡Spam</label>' +
        '</div>' +
        '<div class="cc-field">' +
          '<span class="cc-lbl">Orden</span>' +
          '<select id="order-' + k + '" class="cc-select"><option value="random">Aleatorio</option><option value="sequential">De arriba a abajo</option></select>' +
        '</div>' +
        '<div class="cc-buttons">' +
          '<button id="start-' + k + '" class="btn btn-primary btn-sm">▶ Iniciar</button>' +
          '<button id="stop-' + k + '" class="btn btn-danger btn-sm" disabled>■ Parar</button>' +
          '<button id="reset-' + k + '" class="btn btn-ghost btn-sm" title="Volver al principio del archivo">↻</button>' +
        '</div>' +
        '<div id="status-' + k + '" class="cc-status">Detenida</div>' +
        '<div class="cola-progress"><div id="bar-' + k + '" class="cola-bar"></div></div>' +
        '<div id="count-' + k + '" class="cc-count">sin archivo</div>' +
      '</div>';
  }).join('');
}

function schedulerKeys() {
  var ks = COLA_KEYS.filter(function(k) { return colas[k].running && !isNaN(colas[k].fileIndex) && colas[k].fileIndex >= 0; });
  if (colas.live.running && liveLines.length > 0) ks.push('live');
  return ks;
}

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
function getUnifiedInterval() {
  var min = parseFloat(document.getElementById('unified-min').value) || 4;
  var max = parseFloat(document.getElementById('unified-max').value) || 10;
  return { min: min, max: max };
}
function getColaInterval(key) {
  var c = colas[key];
  if (isUnifiedMode() && isColaInUnified(key)) return getUnifiedInterval();
  return { min: c.intervalMin, max: c.intervalMax };
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

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
    const nLines = (f.blocks || []).reduce(function(a, b) { return a + b.messages.length; }, 0);
    const pct = t > 0 ? Math.round((d / t) * 100) : 0;
    var assigned = COLA_KEYS.filter(function(k) { return colas[k].fileIndex === i; }).map(function(k) { return k.toUpperCase(); });
    var badge = assigned.length ? '<span class="fc-badge">' + assigned.join(' ') + '</span>' : '';
    var activeClass = assigned.length ? ' file-active' : '';
    return '<div class="file-card' + activeClass + '" data-index="' + i + '" draggable="true" title="Arrastrá a una cola">' + '<button class="fc-delete" data-index="' + i + '" title="Eliminar">×</button>' + badge + '<span class="fc-name">' + esc(f.name) + '</span><div class="fc-prog"><div class="fc-bar" style="width:' + pct + '%"></div></div><span class="fc-meta">' + d + ' / ' + t + ' bloques · ' + nLines + ' líneas</span></div>';
  }).join('');
  g.querySelectorAll('.fc-delete').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      deleteFile(parseInt(btn.dataset.index));
    });
  });
  g.querySelectorAll('.file-card').forEach(function(card) {
    card.addEventListener('dragstart', function(e) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/scb-file', card.dataset.index);
      e.dataTransfer.setData('text/plain', card.dataset.index);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', function() { card.classList.remove('dragging'); });
  });
}

function assignFileToCola(key, fileIdx) {
  if (isNaN(fileIdx) || fileIdx < 0 || fileIdx >= files.length) return;
  var sel = document.getElementById('file-' + key + '-select');
  if (sel) sel.value = String(fileIdx);
  colas[key].fileIndex = fileIdx;
  renderFileGrid();
  updateColaUI(key);
  setColaStatus(key, files[fileIdx].name + ' → cola ' + key.toUpperCase());
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

function setColaStatus(key, text, kind) {
  var el = document.getElementById('status-' + key);
  if (!el) return;
  el.textContent = text;
  el.className = 'cc-status' + (kind ? ' ' + kind : '');
}

function colaCard(key) {
  return document.querySelector(key === 'live' ? '.live-panel' : '.cola-' + key);
}

function updateColaUI(key) {
  var c = colas[key];
  var card = colaCard(key);
  if (card) card.classList.toggle('is-running', !!c.running);
  var badge = document.getElementById('badge-' + key);
  if (badge) badge.textContent = c.running ? (c.spam ? 'spam' : 'enviando') : 'detenida';
  var sb = document.getElementById('start-' + key);
  var tb = document.getElementById('stop-' + key);
  if (sb) sb.disabled = c.running;
  if (tb) tb.disabled = !c.running;
  if (key === 'live') { renderLiveCount(); return; }
  var ce = document.getElementById('count-' + key);
  var be = document.getElementById('bar-' + key);
  if (!isNaN(c.fileIndex) && c.fileIndex >= 0 && c.fileIndex < files.length) {
    var f = files[c.fileIndex], t = getBlockCount(f), d = getTotalSentBlocks(f);
    var nLines = (f.blocks || []).reduce(function(a, b) { return a + b.messages.length; }, 0);
    if (ce) ce.textContent = d + ' / ' + t + ' bloques · ' + nLines + ' líneas';
    if (be) be.style.width = (t > 0 ? Math.round((d / t) * 100) : 0) + '%';
  } else if (ce) {
    ce.textContent = 'sin archivo';
  }
}

// ── Registro de envíos + panel superior ────────────────────────────
function logSend(key, botName, msg, ok, status) {
  var box = document.getElementById('send-log');
  if (!box) return;
  var empty = box.querySelector('.empty-state');
  if (empty) box.innerHTML = '';
  var row = document.createElement('div');
  row.className = 'log-row' + (ok ? '' : ' err');
  var t = new Date().toLocaleTimeString('es-AR', { hour12: false });
  row.innerHTML =
    '<span class="log-time">' + t + '</span>' +
    '<span class="log-tag">' + esc((key === 'live' ? 'LIVE' : key.toUpperCase())) + '</span>' +
    '<span class="log-bot">' + esc(ok ? (botName || '?') : ('ERR ' + (status || '?'))) + '</span>' +
    '<span class="log-msg">' + esc(msg) + '</span>';
  box.insertBefore(row, box.firstChild);
  while (box.children.length > 80) box.removeChild(box.lastChild);
}

function recordSend(ok) {
  if (ok) { sentTotal++; kickOk = true; } else { failedTotal++; kickOk = false; }
  updateSendPanel();
}

function activeColaKeys() {
  var ks = COLA_KEYS.filter(function(k) { return colas[k].running; });
  if (colas.live.running) ks.push('live');
  return ks;
}

function estimateRate() {
  var keys = schedulerKeys();
  if (keys.length === 0) return null;
  if (isUnifiedMode()) {
    var pool = keys.filter(isColaInUnified);
    var u = getUnifiedInterval();
    return ((u.min + u.max) / 2) || null; // 1 msg cada N s (todas fusionadas)
  }
  var perSec = 0;
  keys.forEach(function(k) {
    var c = colas[k];
    if (c.spam) { perSec += 1.3; return; }
    var iv = getColaInterval(k);
    var mean = (iv.min + iv.max) / 2;
    if (mean > 0) perSec += 1 / mean;
  });
  return perSec > 0 ? (1 / perSec) : null;
}

function updateSendPanel() {
  var ch = document.getElementById('sp-channel');
  if (ch) {
    if (channelName) { ch.textContent = channelName; ch.classList.remove('unset'); }
    else if (chatroomId) { ch.textContent = 'chatroom ' + chatroomId; ch.classList.remove('unset'); }
    else { ch.textContent = 'sin configurar'; ch.classList.add('unset'); }
  }
  var dot = document.getElementById('sp-kick-dot');
  if (dot) dot.className = 'status-dot ' + (kickOk === true ? 'status-connected' : kickOk === false ? 'status-disconnected' : 'status-checking');
  var b = document.getElementById('sp-bots'); if (b) b.textContent = botCount || '0';
  var ac = document.getElementById('sp-active'); if (ac) ac.textContent = activeColaKeys().length + ' / 9';
  var r = document.getElementById('sp-rate');
  if (r) {
    var s = estimateRate();
    r.textContent = s == null ? '—' : (s < 1 ? '≈' + (1 / s).toFixed(1) + '/s' : '1 cada ' + Math.round(s) + 's');
  }
  var st = document.getElementById('sp-sent'); if (st) st.textContent = sentTotal;
  var fl = document.getElementById('sp-failed'); if (fl) fl.textContent = failedTotal;
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
  var activeKeys = schedulerKeys();
  if (activeKeys.length === 0) return;

  // Tiempo unificado: fusión aleatoria entre las colas incluidas. Si no, round-robin.
  var key;
  if (isUnifiedMode()) {
    var pool = activeKeys.filter(isColaInUnified);
    if (pool.length === 0) pool = activeKeys;
    key = pool[Math.floor(Math.random() * pool.length)];
  } else {
    if (globalScheduler.nextIdx >= activeKeys.length) globalScheduler.nextIdx = 0;
    key = activeKeys[globalScheduler.nextIdx];
    globalScheduler.nextIdx = (globalScheduler.nextIdx + 1) % activeKeys.length;
  }

  var c = colas[key];
  if (c.sending) return;
  c.sending = true;

  // Cola EN VIVO: envía desde el array liveLines, sin bloques ni archivo
  if (key === 'live') {
    if (liveLines.length === 0) { setLiveStatus('EN VIVO vacía'); c.sending = false; return; }
    var li = c.order === 'sequential'
      ? (c.idx % liveLines.length)
      : Math.floor(Math.random() * liveLines.length);
    c.idx = li + 1;
    var lmsg = liveLines[li];
    var lres = await sendOne(lmsg, 'live');
    setLiveStatus(
      (lres.ok ? (lres.username || '?') + ' ✓ ' : 'Error ' + (lres.status || '?') + ' · ') + lmsg.substring(0, 40),
      lres.ok ? 'ok' : 'err'
    );
    logSend('live', lres.username, lmsg, lres.ok, lres.status);
    recordSend(lres.ok);
    renderLiveCount();
    refreshStats();
    c.sending = false;
    return;
  }

  var selEl = document.getElementById('file-' + key + '-select');
  var fileIdx = parseInt(selEl ? selEl.value : '', 10);
  if (isNaN(fileIdx) || fileIdx < 0 || fileIdx >= files.length) {
    setColaStatus(key, 'Elegí un archivo para esta cola', 'err');
    c.sending = false;
    return;
  }
  c.fileIndex = fileIdx;
  var file = files[fileIdx];
  if (!file || !file.blocks || file.blocks.length === 0) {
    setColaStatus(key, 'El archivo está vacío', 'err');
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

  updateColaUI(key);

  var res = await sendOne(msg, key);
  var username = res.username || '?';
  if (res.ok) {
    setColaStatus(key, username + ' ✓  ' + msg.substring(0, 40), 'ok');
  } else {
    setColaStatus(key, 'Error ' + (res.status || '?') + ' · ' + (res.error || res.message || '').substring(0, 40), 'err');
  }
  logSend(key, username, msg, res.ok, res.status);
  recordSend(res.ok);
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
    var activeKeys = schedulerKeys();
    if (activeKeys.length === 0) { globalScheduler.running = false; return; }
    var delay;
    if (isUnifiedMode()) {
      var u = getUnifiedInterval();
      delay = randInt(u.min, u.max);
    } else {
      var idx = (globalScheduler.nextIdx - 1 + activeKeys.length) % activeKeys.length;
      var key = activeKeys[idx];
      var c = colas[key];
      var interval = getColaInterval(key);
      delay = c.spam ? (500 + Math.random() * 1000) : randInt(interval.min, interval.max);
    }
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
  if (colas.live.running) count++;
  return count;
}

async function startCola(key) {
  var c = colas[key];
  if (c.running) return;
  var sel = document.getElementById('file-' + key + '-select');
  var fileIdx = parseInt(sel ? sel.value : '', 10);
  if (isNaN(fileIdx)) { alert('Elegí un archivo para la cola ' + key.toUpperCase()); return; }
  if (!channelName && !chatroomId) { alert('Configurá el canal en Ajustes.'); return; }
  await maybeProbeBeforeStart();
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
  var iv = getColaInterval(key);
  setColaStatus(key, c.spam ? 'Modo spam — sin espera' : 'Enviando cada ' + iv.min + '–' + iv.max + ' s');
  updateSendPanel();

  // Start global scheduler if not running
  startGlobalScheduler();
}

function stopCola(key) {
  var c = colas[key];
  c.running = false;
  var card = document.querySelector('.cola-' + key);
  if (card) card.classList.remove('spam-active');
  updateColaUI(key);
  setColaStatus(key, 'Detenida');
  updateSendPanel();

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

async function addTxtFiles(fileList) {
  if (!fileList || fileList.length === 0) return [];
  var newIdx = [];
  for (var fi = 0; fi < fileList.length; fi++) {
    var f = fileList[fi];
    if (!/\.txt$/i.test(f.name) && f.type && f.type.indexOf('text') === -1) continue;
    var text = await f.text();
    files.push({ name: f.name, blocks: parseToBlocks(text), currentBlock: 0 });
    newIdx.push(files.length - 1);
  }
  if (newIdx.length === 0) return [];
  saveFiles();
  renderFileGrid();
  renderFileSelects();
  return newIdx;
}

function handleLoadFile() {
  var input = document.createElement('input');
  input.type = 'file'; input.accept = '.txt'; input.multiple = true;
  input.addEventListener('change', function() { addTxtFiles(input.files); });
  input.click();
}

function dtHasType(dt, type) {
  return dt && Array.prototype.indexOf.call(dt.types || [], type) !== -1;
}

// Zona que recibe: (a) file-cards internas arrastradas, (b) .txt del sistema
function wireColaDropZone(el, key) {
  if (!el) return;
  ['dragenter', 'dragover'].forEach(function(ev) {
    el.addEventListener(ev, function(e) {
      if (!dtHasType(e.dataTransfer, 'text/scb-file') && !dtHasType(e.dataTransfer, 'Files')) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      el.classList.add('drag-over');
    });
  });
  ['dragleave', 'dragend'].forEach(function(ev) {
    el.addEventListener(ev, function(e) {
      if (ev === 'dragleave' && e.relatedTarget && el.contains(e.relatedTarget)) return;
      el.classList.remove('drag-over');
    });
  });
  el.addEventListener('drop', async function(e) {
    var internal = e.dataTransfer && e.dataTransfer.getData('text/scb-file');
    var hasFiles = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0;
    if (!internal && !hasFiles) return;
    e.preventDefault(); e.stopPropagation();
    el.classList.remove('drag-over');
    if (internal) {
      assignFileToCola(key, parseInt(internal, 10));
      return;
    }
    var idx = await addTxtFiles(e.dataTransfer.files);
    if (idx && idx.length) assignFileToCola(key, idx[idx.length - 1]);
  });
}

// Panel "Archivos": sólo carga .txt del sistema
function wireFilePanelDropZone(el) {
  if (!el) return;
  ['dragenter', 'dragover'].forEach(function(ev) {
    el.addEventListener(ev, function(e) {
      if (!dtHasType(e.dataTransfer, 'Files')) return;
      e.preventDefault(); e.stopPropagation(); el.classList.add('drag-over');
    });
  });
  ['dragleave', 'dragend'].forEach(function(ev) {
    el.addEventListener(ev, function(e) {
      if (ev === 'dragleave' && e.relatedTarget && el.contains(e.relatedTarget)) return;
      el.classList.remove('drag-over');
    });
  });
  el.addEventListener('drop', function(e) {
    if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    e.preventDefault(); e.stopPropagation();
    el.classList.remove('drag-over');
    addTxtFiles(e.dataTransfer.files);
  });
}

function initDropZones() {
  // Evitar que un drop fuera de zona abra el archivo en el navegador
  ['dragover', 'drop'].forEach(function(ev) {
    window.addEventListener(ev, function(e) {
      if (e.target && e.target.closest && e.target.closest('.chat-bottom .panel, .cola-card')) return;
      if (dtHasType(e.dataTransfer, 'Files')) e.preventDefault();
    });
  });
  wireFilePanelDropZone(document.getElementById('file-grid') && document.getElementById('file-grid').closest('.panel'));
  COLA_KEYS.forEach(function(k) {
    wireColaDropZone(document.querySelector('.cola-' + k), k);
  });
}

async function probeTokens() {
  var btn = document.getElementById('probe-tokens-btn');
  var st = document.getElementById('probe-status');
  if (!channelName && !chatroomId) { if (st) st.textContent = 'Configurá el canal en Ajustes.'; return null; }
  if (btn) { btn.disabled = true; }
  if (st) st.textContent = 'Probando tokens…';
  try {
    var res = await fetch(getServerUrl() + '/chat/probe', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
      body: JSON.stringify({ channel: channelName || undefined, chatroom_id: chatroomId || undefined }),
    });
    var data = await res.json().catch(function() { return {}; });
    if (!res.ok || !data.success) { if (st) st.textContent = 'Error: ' + (data.error || res.status); return null; }
    if (st) st.textContent = 'Tokens vivos: ' + data.alive + '/' + data.total + (data.dead ? ' · muertos: ' + data.dead : '');
    return data;
  } catch (e) {
    if (st) st.textContent = 'Error de conexión al probar tokens.';
    return null;
  } finally { if (btn) btn.disabled = false; }
}

var lastProbeAt = 0;
async function maybeProbeBeforeStart() {
  var cb = document.getElementById('probe-before-start');
  if (!cb || !cb.checked) return;
  if (Date.now() - lastProbeAt < 30000) return;
  lastProbeAt = Date.now();
  await probeTokens();
}

// ── Cola EN VIVO (cola 9, alimentada por la casilla de texto) ───────
var liveLines = [];
var liveSending = false;

function saveLiveLines() { try { localStorage.setItem('scb_live', JSON.stringify(liveLines)); } catch {} }
function loadLiveLines() {
  try { var s = localStorage.getItem('scb_live'); if (s) liveLines = JSON.parse(s) || []; } catch {}
}

function setLiveStatus(t, kind) {
  setColaStatus('live', t || '', kind);
}

function renderLiveCount() {
  var ce = document.getElementById('count-live');
  var be = document.getElementById('bar-live');
  var total = liveLines.length;
  var pos = total ? (colas.live.idx % total) : 0;
  if (ce) ce.textContent = total + ' líneas' + (colas.live.running && total ? ' · #' + (pos + 1) : '');
  if (be) be.style.width = (total ? Math.round((pos / total) * 100) : 0) + '%';
}

function parseLiveInput() {
  var raw = (document.getElementById('live-input') || {}).value || '';
  return raw.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
}

function setLiveLines(lines) {
  liveLines = lines.slice();
  colas.live.idx = 0;
  saveLiveLines();
  renderLiveCount();
}

function wireLivePaste() {
  var rep = document.getElementById('live-replace');
  var app = document.getElementById('live-append');
  var clr = document.getElementById('live-clear');
  var snd = document.getElementById('live-send');
  var stp = document.getElementById('live-send-stop');

  if (rep) rep.addEventListener('click', function() {
    setLiveLines(parseLiveInput());
    setLiveStatus('EN VIVO: ' + liveLines.length + ' líneas cargadas');
  });
  if (app) app.addEventListener('click', function() {
    var add = parseLiveInput();
    if (!add.length) return;
    setLiveLines(liveLines.concat(add));
    var ta = document.getElementById('live-input'); if (ta) ta.value = '';
    setLiveStatus('EN VIVO: ' + liveLines.length + ' líneas');
  });
  if (clr) clr.addEventListener('click', function() {
    setLiveLines([]);
    setLiveStatus('EN VIVO vaciada');
  });
  if (stp) stp.addEventListener('click', function() { liveSending = false; });
  if (snd) snd.addEventListener('click', liveSendNow);

  var sb = document.getElementById('start-live');
  var tb = document.getElementById('stop-live');
  var rb = document.getElementById('reset-live');
  if (sb) sb.addEventListener('click', startLiveCola);
  if (tb) tb.addEventListener('click', stopLiveCola);
  if (rb) rb.addEventListener('click', function() { colas.live.idx = 0; renderLiveCount(); setLiveStatus('EN VIVO reiniciada'); });
}

function startLiveCola() {
  if (colas.live.running) return;
  if (!channelName && !chatroomId) { alert('Configurá el canal en Ajustes.'); return; }
  if (liveLines.length === 0) { setLiveStatus('EN VIVO vacía — pegá líneas primero'); return; }
  colas.live.intervalMin = parseFloat((document.getElementById('interval-live-min') || {}).value) || 2;
  colas.live.intervalMax = parseFloat((document.getElementById('interval-live-max') || {}).value) || 6;
  var os = document.getElementById('order-live');
  colas.live.order = os ? os.value : 'random';
  colas.live.running = true;
  updateColaUI('live');
  setLiveStatus('Enviando ' + liveLines.length + ' líneas cada ' + colas.live.intervalMin + '–' + colas.live.intervalMax + ' s');
  updateSendPanel();
  startGlobalScheduler();
}

function stopLiveCola() {
  colas.live.running = false;
  updateColaUI('live');
  setLiveStatus('Detenida');
  updateSendPanel();
  if (getActiveColaCount() === 0) stopGlobalScheduler();
}

async function liveSendNow() {
  if (liveSending) return;
  var lines = parseLiveInput();
  if (!lines.length) lines = liveLines.slice();
  if (!lines.length) { setLiveStatus('Nada para enviar'); return; }
  if (!channelName && !chatroomId) { alert('Configurá el canal en Ajustes.'); return; }

  liveSending = true;
  document.getElementById('live-send').disabled = true;
  document.getElementById('live-send-stop').disabled = false;

  var lo = (parseFloat((document.getElementById('interval-live-min') || {}).value) || 2) * 1000;
  var hi = (parseFloat((document.getElementById('interval-live-max') || {}).value) || 6) * 1000;

  var okCount = 0;
  for (var i = 0; i < lines.length && liveSending; i++) {
    setLiveStatus('Enviando ' + (i + 1) + ' de ' + lines.length + '…');
    var res = await sendOne(lines[i], 'live');
    if (res && res.ok) okCount++;
    logSend('live', res && res.username, lines[i], res && res.ok, res && res.status);
    recordSend(res && res.ok);
    refreshStats();
    if (i < lines.length - 1 && liveSending) await sleep(lo + Math.random() * Math.max(0, hi - lo));
  }

  setLiveStatus((liveSending ? 'Listo' : 'Parado') + ' · ' + okCount + ' de ' + lines.length + ' enviados', okCount ? 'ok' : 'err');
  liveSending = false;
  document.getElementById('live-send').disabled = false;
  document.getElementById('live-send-stop').disabled = true;
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

  buildColaCards();

  document.getElementById('load-file-btn').addEventListener('click', handleLoadFile);
  initDropZones();

  var probeBtn = document.getElementById('probe-tokens-btn');
  if (probeBtn) probeBtn.addEventListener('click', function() { probeTokens(); });

  var clearLog = document.getElementById('clear-log-btn');
  if (clearLog) clearLog.addEventListener('click', function() {
    var box = document.getElementById('send-log');
    if (box) box.innerHTML = '<div class="empty-state">Todavía no se envió nada.</div>';
  });

  document.getElementById('start-all').addEventListener('click', async function() {
    for (var i = 0; i < COLA_KEYS.length; i++) {
      var sel = document.getElementById('file-' + COLA_KEYS[i] + '-select');
      if (sel && sel.value !== '') await startCola(COLA_KEYS[i]);
    }
    if (liveLines.length) startLiveCola();
  });
  document.getElementById('stop-all').addEventListener('click', function() {
    COLA_KEYS.forEach(function(k) { stopCola(k); });
    stopLiveCola();
  });

  wireLivePaste();

  fetchMyBots().then(function(b) { botCount = (b || []).length; updateSendPanel(); }).catch(function() {});

  COLA_KEYS.forEach(function(k) {
    document.getElementById('start-' + k).addEventListener('click', function() { startCola(k); });
    document.getElementById('stop-' + k).addEventListener('click', function() { stopCola(k); });
    document.getElementById('reset-' + k).addEventListener('click', function() { resetCola(k); });
    var spamCb = document.getElementById('spam-' + k);
    if (spamCb) {
      spamCb.addEventListener('change', function() {
        colas[k].spam = spamCb.checked;
        var card = document.querySelector('.cola-' + k);
        if (card) card.classList.toggle('spam-active', spamCb.checked);
        updateColaUI(k);
        updateSendPanel();
      });
    }
  });

  document.getElementById('reset-stats-btn').addEventListener('click', resetStats);

  // Tiempo unificado (todas las colas marcadas comparten ritmo y se fusionan)
  var unifiedCb = document.getElementById('unified-mode');
  if (unifiedCb) {
    unifiedCb.addEventListener('change', function() {
      var ui = document.getElementById('unified-interval');
      if (ui) ui.hidden = !unifiedCb.checked;
      updateSendPanel();
    });
  }
  ['unified-min', 'unified-max'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', updateSendPanel);
  });
  var uniStart = document.getElementById('unified-start');
  if (uniStart) uniStart.addEventListener('click', async function() {
    if (unifiedCb) unifiedCb.checked = true;
    var ui = document.getElementById('unified-interval');
    if (ui) ui.hidden = false;
    for (var i = 0; i < COLA_KEYS.length; i++) {
      var k = COLA_KEYS[i];
      if (!isColaInUnified(k)) continue;
      var sel = document.getElementById('file-' + k + '-select');
      if (sel && sel.value !== '') await startCola(k);
    }
    if (isColaInUnified('live') && liveLines.length) startLiveCola();
  });

  loadSettings();
  loadSavedFiles();
  loadLiveLines();
  renderFileGrid();
  renderFileSelects();
  renderLiveCount();
  COLA_KEYS.forEach(updateColaUI);
  updateColaUI('live');
  updateSendPanel();
  refreshStats();
  statsTimerId = setInterval(refreshStats, 2500);
  setInterval(updateSendPanel, 3000);
}

window.addEventListener('beforeunload', function() {
  if (statsTimerId) clearInterval(statsTimerId);
  COLA_KEYS.forEach(function(k) { stopCola(k); });
  colas.live.running = false;
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
