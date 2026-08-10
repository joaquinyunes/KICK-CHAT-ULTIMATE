import { onStatusChange, ping, sendMessage, fetchMyBots } from './bridge-client.js';
import { getServerUrl, getAuthHeaders } from './admin-common.js';
import { renderNav, renderAuthHeader, startStatusLoop } from './client-nav.js';

function esc(s) { return s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

let files = [];
let channelName = '';
let chatroomId = '';
let statsTimerId = null;

const colas = {
  a: { fileIndex: -1, intervalMin: 15, intervalMax: 20, running: false, timerId: null, sending: false },
  b: { fileIndex: -1, intervalMin: 1, intervalMax: 3, running: false, timerId: null, sending: false },
};
const spam = { fileIndex: -1, interval: 1, running: false, timerId: null, sending: false, startTime: 0, elapsedId: null };

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
    const isA = colas.a.fileIndex === i, isB = colas.b.fileIndex === i;
    let badge = isA ? '<span class="fc-badge badge-a">A</span>' : isB ? '<span class="fc-badge badge-b">B</span>' : '';
    return '<div class="file-card' + (isA ? ' file-a-active' : '') + (isB ? ' file-b-active' : '') + '" data-index="' + i + '">' + badge + '<span class="fc-name">' + esc(f.name) + '</span><div class="fc-prog"><div class="fc-bar" style="width:' + pct + '%"></div></div><span class="fc-meta">' + d + '/' + t + ' bloques</span></div>';
  }).join('');
}

function renderFileSelects() {
  var opts = '<option value="">Elegí archivo</option>' + files.map(function(f, i) { return '<option value="' + i + '">' + esc(f.name) + '</option>'; }).join('');
  ['file-a-select', 'file-b-select', 'spam-file-select'].forEach(function(id) {
    var sel = document.getElementById(id);
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

async function sendOne(msg) {
  try {
    var res = await sendMessage({ channel: channelName, message: msg, chatroom_id: chatroomId || undefined });
    return res;
  } catch (e) {
    return { ok: false, error: e.message, status: 0 };
  }
}

async function sendColaBlock(key) {
  var c = colas[key];
  if (c.sending || !c.running) return;

  var selEl = document.getElementById('file-' + key + '-select');
  var val = selEl ? selEl.value : '';
  var fileIdx = parseInt(val, 10);

  if (isNaN(fileIdx) || fileIdx < 0 || fileIdx >= files.length) {
    setColaStatus(key, 'Elegí un archivo');
    stopCola(key);
    return;
  }

  c.fileIndex = fileIdx;
  var file = files[fileIdx];
  if (!file || !file.blocks || file.blocks.length === 0) {
    setColaStatus(key, 'Archivo sin bloques');
    c.sending = false;
    return;
  }

  if (allBlocksSent(file)) loopBlocks(file);

  c.sending = true;
  var unsent = [];
  for (var i = 0; i < file.blocks.length; i++) { if (!file.blocks[i].sent) unsent.push(i); }
  if (unsent.length === 0) { loopBlocks(file); c.sending = false; return; }

  var blockIdx;
  if (c.order === 'sequential') {
    blockIdx = unsent[0];
  } else {
    blockIdx = unsent[Math.floor(Math.random() * unsent.length)];
  }
  file.currentBlock = blockIdx;
  var block = file.blocks[blockIdx];

  for (var mi = 0; mi < block.messages.length; mi++) {
    if (!c.running) break;
    var msg = block.messages[mi];
    setColaStatus(key, '[' + key.toUpperCase() + '] B' + (blockIdx + 1) + ' msg ' + (mi + 1) + '/' + block.messages.length + ': "' + msg.substring(0, 40) + '"');
    updateColaUI(key);

    var res = await sendOne(msg);
    if (res.ok) {
      setColaStatus(key, 'OK [' + key.toUpperCase() + '] B' + (blockIdx + 1) + ' msg ' + (mi + 1) + '/' + block.messages.length + ': "' + msg.substring(0, 40) + '"');
    } else {
      setColaStatus(key, 'ERR (' + (res.status || '?') + '): ' + (res.error || res.message || '').substring(0, 50));
    }
    refreshStats();

    if (mi < block.messages.length - 1 && c.running) {
      var waitMs = randInt(c.intervalMin, c.intervalMax);
      setColaStatus(key, 'Esperando ' + Math.round(waitMs / 1000) + 's...');
      await new Promise(function(r) { setTimeout(r, waitMs); });
    }
  }

  block.sent = true;
  file.currentBlock++;
  saveFiles();
  renderFileGrid();
  c.sending = false;
  updateColaUI(key);

  if (allBlocksSent(file)) {
    loopBlocks(file);
    saveFiles();
    renderFileGrid();
    setColaStatus(key, 'Ciclo completo, reiniciando...');
  }
}

function scheduleCola(key) {
  var c = colas[key];
  if (!c.running) return;
  c.timerId = setTimeout(async function() {
    await sendColaBlock(key);
    if (c.running) scheduleCola(key);
  }, randInt(c.intervalMin, c.intervalMax));
}

function startCola(key) {
  var c = colas[key];
  if (c.running) return;
  var sel = document.getElementById('file-' + key + '-select');
  var fileIdx = parseInt(sel ? sel.value : '', 10);
  if (isNaN(fileIdx)) { alert('Elegí un archivo para la cola ' + key.toUpperCase()); return; }
  if (!channelName && !chatroomId) { alert('Configurá el canal en Ajustes (nombre del canal o Chatroom ID).'); return; }
  c.fileIndex = fileIdx;
  c.intervalMin = parseFloat(document.getElementById('interval-' + key + '-min').value) || 3;
  c.intervalMax = parseFloat(document.getElementById('interval-' + key + '-max').value) || 8;
  var orderSel = document.getElementById('order-' + key);
  c.order = orderSel ? orderSel.value : 'random';
  c.running = true;
  updateColaUI(key);
  sendColaBlock(key).then(function() { if (c.running) scheduleCola(key); });
}

function stopCola(key) {
  var c = colas[key];
  c.running = false;
  if (c.timerId) { clearTimeout(c.timerId); c.timerId = null; }
  updateColaUI(key);
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

async function sendSpamBlock() {
  if (spam.sending || !spam.running) return;
  var sel = document.getElementById('spam-file-select');
  var fileIdx = parseInt(sel ? sel.value : '', 10);
  if (isNaN(fileIdx) || fileIdx < 0 || fileIdx >= files.length) {
    document.getElementById('spam-status').textContent = 'Elegí un archivo';
    stopSpam();
    return;
  }
  spam.fileIndex = fileIdx;
  var file = files[fileIdx];
  if (!file || !file.blocks || file.blocks.length === 0) return;
  if (allBlocksSent(file)) loopBlocks(file);

  spam.sending = true;
  var unsent = [];
  for (var i = 0; i < file.blocks.length; i++) { if (!file.blocks[i].sent) unsent.push(i); }
  if (unsent.length === 0) { loopBlocks(file); spam.sending = false; return; }

  var blockIdx = unsent[0];
  var block = file.blocks[blockIdx];

  for (var mi = 0; mi < block.messages.length; mi++) {
    if (!spam.running) break;
    var msg = block.messages[mi];
    document.getElementById('spam-status').textContent = 'SPAM: "' + msg.substring(0, 45) + '"';
    await sendOne(msg);
    refreshStats();
    if (mi < block.messages.length - 1 && spam.running) {
      await new Promise(function(r) { setTimeout(r, spam.interval * 1000); });
    }
  }

  block.sent = true;
  file.currentBlock++;
  saveFiles();
  renderFileGrid();
  spam.sending = false;
}

function scheduleSpam() {
  if (!spam.running) return;
  spam.timerId = setTimeout(async function() {
    await sendSpamBlock();
    if (spam.running) scheduleSpam();
  }, spam.interval * 1000);
}

function startSpam() {
  if (spam.running) return;
  var sel = document.getElementById('spam-file-select');
  var fileIdx = parseInt(sel ? sel.value : '', 10);
  if (isNaN(fileIdx)) { alert('Elegí un archivo para spam'); return; }
  if (!channelName && !chatroomId) { alert('Configurá el canal en Ajustes.'); return; }
  spam.fileIndex = fileIdx;
  spam.interval = parseFloat(document.getElementById('spam-interval').value) || 1;
  spam.running = true;
  spam.startTime = Date.now();
  var c = document.querySelector('.spam-rapido');
  if (c) c.classList.add('active');
  document.getElementById('spam-start').disabled = true;
  document.getElementById('spam-stop').disabled = false;
  spam.elapsedId = setInterval(function() {
    var elapsed = Math.floor((Date.now() - spam.startTime) / 1000);
    var remaining = Math.max(0, 60 - elapsed);
    document.getElementById('spam-timer').textContent = remaining > 0 ? remaining + 's' : 'TIEMPO!';
    if (remaining <= 0) stopSpam();
  }, 200);
  sendSpamBlock().then(function() { if (spam.running) scheduleSpam(); });
}

function stopSpam() {
  spam.running = false;
  if (spam.timerId) { clearTimeout(spam.timerId); spam.timerId = null; }
  if (spam.elapsedId) { clearInterval(spam.elapsedId); spam.elapsedId = null; }
  var c = document.querySelector('.spam-rapido');
  if (c) c.classList.remove('active');
  document.getElementById('spam-start').disabled = false;
  document.getElementById('spam-stop').disabled = true;
  document.getElementById('spam-timer').textContent = '';
  document.getElementById('spam-status').textContent = '';
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
  document.getElementById('start-a').addEventListener('click', function() { startCola('a'); });
  document.getElementById('stop-a').addEventListener('click', function() { stopCola('a'); });
  document.getElementById('reset-a').addEventListener('click', function() { resetCola('a'); });
  document.getElementById('start-b').addEventListener('click', function() { startCola('b'); });
  document.getElementById('stop-b').addEventListener('click', function() { stopCola('b'); });
  document.getElementById('reset-b').addEventListener('click', function() { resetCola('b'); });
  document.getElementById('spam-start').addEventListener('click', startSpam);
  document.getElementById('spam-stop').addEventListener('click', stopSpam);
  document.getElementById('reset-stats-btn').addEventListener('click', resetStats);

  loadSettings();
  loadSavedFiles();
  renderFileGrid();
  renderFileSelects();
  refreshStats();
  statsTimerId = setInterval(refreshStats, 2500);
}

window.addEventListener('beforeunload', function() {
  if (statsTimerId) clearInterval(statsTimerId);
  stopCola('a');
  stopCola('b');
  stopSpam();
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
