import { onStatusChange, ping, sendMessage, fetchMyBots } from './bridge-client.js';
import { getServerUrl, getAuthHeaders } from './admin-common.js';
import { renderNav, renderAuthHeader, startStatusLoop } from './client-nav.js';

function esc(str) { if (str == null) return ''; return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

let files = [];
let currentFileIndex = -1;
let channelName = '';
let intervalMin = 3;
let intervalMax = 8;
let chatroomId = '';
let autoMode = false;
let autoTimeoutId = null;
let isSendingBlock = false;
let statsTimerId = null;

function parseToBlocks(text) {
  const raw = text.split(/\n\s*\n/);
  const blocks = [];
  for (const chunk of raw) {
    const lines = chunk.split('\n').filter(l => l.trim());
    if (lines.length > 0) blocks.push({ messages: lines, sent: false });
  }
  return blocks;
}

function getBlockCount(file) {
  return file.blocks ? file.blocks.length : 0;
}

function getTotalSentBlocks(file) {
  if (!file.blocks) return 0;
  return file.blocks.filter(b => b.sent).length;
}

function allBlocksSent(file) {
  return file.blocks && file.blocks.length > 0 && file.blocks.every(b => b.sent);
}

function renderFileList() {
  const grid = document.getElementById('file-grid');
  if (!grid) return;
  if (files.length === 0) {
    grid.innerHTML = '<div class="empty-state full">Sin archivos cargados. Agregá tus .txt.</div>';
    document.getElementById('active-file-name').textContent = 'Ningún archivo seleccionado';
    document.getElementById('msg-count').textContent = '';
    return;
  }
  grid.innerHTML = files.map((f, i) => {
    const total = getBlockCount(f);
    const done = getTotalSentBlocks(f);
    const allDone = total > 0 && done === total;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return `<div class="file-card${i === currentFileIndex ? ' file-active' : ''}${allDone ? ' done' : ''}" data-index="${i}">
      <span class="fc-check">${allDone ? '✓' : ''}</span>
      <span class="fc-name">${esc(f.name)}</span>
      <div class="fc-prog"><div class="fc-bar" style="width:${pct}%"></div></div>
      <span class="fc-meta">${done}/${total} bloques</span>
    </div>`;
  }).join('');
  grid.querySelectorAll('.file-card').forEach(el => {
    el.addEventListener('click', () => {
      currentFileIndex = parseInt(el.dataset.index, 10);
      renderFileList();
      renderMessageList();
      updateButtonStates();
    });
  });
}

function renderMessageList() {
  const list = document.getElementById('msg-list');
  const nameEl = document.getElementById('active-file-name');
  const countEl = document.getElementById('msg-count');
  if (!list) return;
  if (currentFileIndex < 0 || currentFileIndex >= files.length) {
    list.innerHTML = '<li class="empty-state">Seleccioná un archivo de la grilla.</li>';
    if (nameEl) nameEl.textContent = 'Ningún archivo seleccionado';
    if (countEl) countEl.textContent = '';
    return;
  }
  const file = files[currentFileIndex];
  if (nameEl) nameEl.textContent = file.name;
  const blocks = file.blocks || [];
  if (blocks.length === 0) {
    list.innerHTML = '<li class="empty-state">Archivo vacío.</li>';
    if (countEl) countEl.textContent = '0/0 bloques';
    return;
  }
  const total = blocks.length;
  const done = getTotalSentBlocks(file);
  if (countEl) countEl.textContent = `${done}/${total} bloques`;
  let html = '';
  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    const isCurrent = bi === file.currentBlock && !block.sent && !allBlocksSent(file);
    const isDone = block.sent;
    html += `<li class="block-divider ${isDone ? 'block-done' : ''} ${isCurrent ? 'block-current' : ''}" data-block="${bi}">
      <span class="block-label">Bloque ${bi + 1}${isDone ? ' ✓' : ''}${isCurrent ? ' ◄ enviando' : ''}</span>
    </li>`;
    for (let mi = 0; mi < block.messages.length; mi++) {
      const msg = block.messages[mi];
      const isCurrentMsg = isCurrent && mi === 0;
      html += `<li class="msg-item${isCurrentMsg ? ' msg-current' : ''} ${isDone ? 'msg-done' : ''}">
        <span class="msg-num">${mi + 1}</span>
        <span class="msg-text">${esc(msg)}</span>
      </li>`;
    }
  }
  list.innerHTML = html;
  updateProgress();
}

function saveFiles() {
  try { localStorage.setItem('scb_files', JSON.stringify(files)); } catch {}
}

function loadSavedFiles() {
  try {
    const saved = localStorage.getItem('scb_files');
    if (saved) {
      const parsed = JSON.parse(saved);
      for (const f of parsed) {
        if (!f.blocks) {
          f.blocks = [{ messages: [f.name || ''], sent: false }];
        }
      }
      files = parsed;
    }
  } catch {}
}

function handleLoadFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.txt';
  input.multiple = true;
  input.addEventListener('change', async () => {
    const fileList = input.files;
    if (!fileList || fileList.length === 0) return;
    for (const f of fileList) {
      const text = await f.text();
      const blocks = parseToBlocks(text);
      files.push({ name: f.name, blocks, currentBlock: 0 });
    }
    if (currentFileIndex < 0) currentFileIndex = 0;
    saveFiles();
    renderFileList();
    renderMessageList();
    updateButtonStates();
  });
  input.click();
}

function getRandomInterval() {
  const min = Math.min(intervalMin, intervalMax);
  const max = Math.max(intervalMin, intervalMax);
  return (Math.random() * (max - min) + min) * 1000;
}

function getIntraBlockDelay() {
  return 2000 + Math.random() * 2000;
}

async function sendCurrentMessage() {
  if (currentFileIndex < 0 || currentFileIndex >= files.length) return;
  const file = files[currentFileIndex];
  if (!file.blocks || file.blocks.length === 0) return;
  if (allBlocksSent(file)) return;
  if (isSendingBlock) return;

  isSendingBlock = true;
  const statusEl = document.getElementById('send-status');

  const unsentIndices = file.blocks.map((b, i) => b.sent ? -1 : i).filter(i => i >= 0);
  if (unsentIndices.length === 0) {
    isSendingBlock = false;
    return;
  }
  file.currentBlock = unsentIndices[Math.floor(Math.random() * unsentIndices.length)];
  const block = file.blocks[file.currentBlock];

  for (let i = 0; i < block.messages.length; i++) {
    const msg = block.messages[i];
    if (statusEl) statusEl.textContent = `Enviando bloque ${file.currentBlock + 1}/${file.blocks.length} (msg ${i + 1}/${block.messages.length})…`;
    renderMessageList();

    const res = await sendMessage({ channel: channelName, message: msg, chatroom_id: chatroomId || undefined });

    if (res.ok) {
      if (statusEl) statusEl.textContent = `✓ Bloque ${file.currentBlock + 1}: "${msg.substring(0, 30)}…"`;
      renderMessageList();
      refreshStats();
    } else {
      if (res.status === 401) {
        if (statusEl) statusEl.textContent = `Error de sesión: ${res.message || res.error}`;
        isSendingBlock = false;
        stopAutoSend();
        return;
      }
      if (statusEl) statusEl.textContent = `Error, sigo: ${res.message || res.error}`;
      renderMessageList();
    }

    if (i < block.messages.length - 1) {
      await new Promise(r => setTimeout(r, getIntraBlockDelay()));
    }
  }

  block.sent = true;
  file.currentBlock++;
  saveFiles();
  renderFileList();
  renderMessageList();
  refreshStats();

  if (allBlocksSent(file)) {
    if (statusEl) statusEl.textContent = '✓ Todos los bloques enviados. — ↻ Reiniciar para reenviar';
    isSendingBlock = false;
    stopAutoSend();
    return;
  }

  isSendingBlock = false;
}

function scheduleNextBlock() {
  if (!autoMode) return;
  const file = files[currentFileIndex];
  if (!file || allBlocksSent(file)) { autoMode = false; updateButtonStates(); return; }
  autoTimeoutId = setTimeout(async () => {
    await sendCurrentMessage();
    if (autoMode) scheduleNextBlock();
  }, getRandomInterval());
}

function startAutoSend() {
  if (autoMode) return;
  if (currentFileIndex < 0 || files.length === 0) { alert('Cargá archivos .txt primero.'); return; }
  const file = files[currentFileIndex];
  if (!file || !file.blocks || file.blocks.length === 0) { alert('El archivo no tiene bloques.'); return; }
  if (allBlocksSent(file)) { alert('Todos los bloques ya fueron enviados.'); return; }
  if (!channelName && !chatroomId) { alert('Configurá el canal en Ajustes (nombre del canal o Chatroom ID).'); return; }
  autoMode = true;
  updateButtonStates();
  sendCurrentMessage().then(() => {
    if (autoMode && !allBlocksSent(files[currentFileIndex])) {
      scheduleNextBlock();
    }
  });
}

function stopAutoSend() {
  autoMode = false;
  if (autoTimeoutId !== null) { clearTimeout(autoTimeoutId); autoTimeoutId = null; }
  updateButtonStates();
  const statusEl = document.getElementById('send-status');
  if (statusEl) statusEl.removeAttribute('data-running');
}

function updateProgress() {
  if (currentFileIndex < 0 || currentFileIndex >= files.length) return;
  const file = files[currentFileIndex];
  const bar = document.getElementById('progress-bar');
  if (!bar || !file.blocks || file.blocks.length === 0) return;
  const done = getTotalSentBlocks(file);
  const total = file.blocks.length;
  const pct = Math.round((done / total) * 100);
  bar.style.width = `${pct}%`;
}

function updateButtonStates() {
  const start = document.getElementById('start-btn');
  const stop = document.getElementById('stop-btn');
  const sendOnce = document.getElementById('send-once-btn');
  const resetBtn = document.getElementById('reset-btn');
  const file = currentFileIndex >= 0 && currentFileIndex < files.length ? files[currentFileIndex] : null;
  const hasPendingBlocks = file && file.blocks && !allBlocksSent(file);
  const allDone = file && file.blocks && allBlocksSent(file);
  const running = autoMode;
  if (start) start.disabled = running || !hasPendingBlocks;
  if (stop) stop.disabled = !running;
  if (sendOnce) sendOnce.disabled = running || !hasPendingBlocks;
  if (resetBtn) resetBtn.style.display = allDone && !running ? '' : 'none';
}

function resetFile() {
  if (!confirm('¿Reiniciar todos los bloques para volver a enviarlos?')) return;
  const file = currentFileIndex >= 0 && currentFileIndex < files.length ? files[currentFileIndex] : null;
  if (!file || !file.blocks) return;
  for (const b of file.blocks) b.sent = false;
  file.currentBlock = 0;
  saveFiles();
  renderFileList();
  renderMessageList();
  updateButtonStates();
  const statusEl = document.getElementById('send-status');
  if (statusEl) statusEl.textContent = 'Bloques reiniciados.';
}

function normalizeChannel(input) {
  if (!input) return '';
  let s = String(input).trim();
  try {
    const u = new URL(s);
    s = u.pathname;
  } catch {}
  s = s.replace(/^https?:\/\/(www\.)?kick\.com\//i, '');
  s = s.split('?')[0].split('#')[0].replace(/^\/+|\/+$/g, '');
  return s;
}

function loadSettings() {
  const saved = JSON.parse(localStorage.getItem('scb_settings') || '{}');
  if (saved.channelName) {
    const slug = normalizeChannel(saved.channelName);
    channelName = slug;
  }
  if (saved.intervalMin) intervalMin = saved.intervalMin;
  if (saved.intervalMax) intervalMax = saved.intervalMax;
  if (saved.chatroomId) chatroomId = saved.chatroomId;
  localStorage.setItem('scb_settings', JSON.stringify({
    channelName, intervalMin, intervalMax, chatroomId,
  }));
}

// ─── Stats de bots ───
async function refreshStats() {
  const container = document.getElementById('bots-stats');
  if (!container) return;
  try {
    const url = getServerUrl();
    const res = await fetch(url + '/api/chat/send-stats', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.success) { container.innerHTML = '<div class="empty-state full">Sin datos.</div>'; return; }
    if (!data.bots || data.bots.length === 0) {
      container.innerHTML = '<div class="empty-state full">Aún no se enviaron mensajes.</div>';
      return;
    }
    container.innerHTML = data.bots.map(b => `
      <div class="bot-stat ${b.count > 0 ? 'top' : ''}">
        <span class="bs-count">${b.count || 0}</span>
        <span class="bs-name" title="${esc(b.botId)}">${esc(b.botId)}</span>
      </div>`).join('');
  } catch {}
}

function resetStats() {
  try {
    fetch(getServerUrl() + '/api/chat/send-stats/reset', { method: 'POST', headers: getAuthHeaders() }).then(refreshStats);
  } catch {}
}

export async function initChatUI() {

  const token = sessionStorage.getItem('scb_jwt') || localStorage.getItem('scb_jwt');
  const headers = token ? { 'Authorization': 'Bearer ' + token } : {};

  try {
    const res = await fetch('/auth/me', { headers });
    if (!res.ok) {
      window.location.href = '/';
      return;
    }
    const data = await res.json();
    if (data.user.role === 'admin') {
      window.location.href = '/admin/dashboard';
      return;
    }
    if (token) {
      fetch('/auth/sync-cookie', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } }).catch(() => {});
    }
  } catch {
    window.location.href = '/';
    return;
  }

  renderAuthHeader('chat');
  renderNav('chat');
  startStatusLoop();
  document.getElementById('load-file-btn')?.addEventListener('click', handleLoadFile);
  document.getElementById('start-btn')?.addEventListener('click', startAutoSend);
  document.getElementById('stop-btn')?.addEventListener('click', stopAutoSend);
  document.getElementById('send-once-btn')?.addEventListener('click', sendCurrentMessage);
  document.getElementById('reset-btn')?.addEventListener('click', resetFile);
  document.getElementById('reset-stats-btn')?.addEventListener('click', resetStats);

  loadSettings();
  loadSavedFiles();
  if (files.length > 0 && currentFileIndex < 0) currentFileIndex = 0;
  renderFileList();
  renderMessageList();
  updateButtonStates();
  refreshStats();
  statsTimerId = setInterval(refreshStats, 2500);
}

window.addEventListener('beforeunload', () => {
  if (statsTimerId) clearInterval(statsTimerId);
});

window.addGeneratedMessages = function (msgs, name) {
  const msgLines = msgs.map(m => `${m.user}: ${m.message}`);
  files.push({ name: name || `IA - ${new Date().toLocaleTimeString()}`, blocks: [{ messages: msgLines, sent: false }], currentBlock: 0 });
  if (currentFileIndex < 0) currentFileIndex = files.length - 1;
  saveFiles();
  renderFileList();
  renderMessageList();
  updateButtonStates();
};

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => { initChatUI(); });
}