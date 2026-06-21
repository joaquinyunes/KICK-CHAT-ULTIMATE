import { onStatusChange, ping, sendMessage, fetchMyBots } from './bridge-client.js';
import { getServerUrl, getAuthHeaders } from './admin-common.js';

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

function parseToBlocks(text) {
  const raw = text.split(/\n\s*\n/);
  const blocks = [];
  for (const chunk of raw) {
    const lines = chunk.split('\n').filter(l => l.trim());
    if (lines.length > 0) blocks.push({ messages: lines, sent: false });
  }
  return blocks;
}

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`panel-${btn.dataset.tab}`)?.classList.add('active');
    });
  });
}

function updateStatusUI(status) {
  const badge = document.getElementById('status-badge');
  const label = document.getElementById('status-label');
  if (!badge || !label) return;
  badge.className = `status-dot status-${status}`;
  label.textContent = status === 'connected' ? 'Conectado' : status === 'checking' ? 'Verificando…' : 'Desconectado';
}

async function renderNavLinks() {
  const container = document.getElementById('nav-links');
  if (!container) return;
  try {
    const res = await fetch(getServerUrl() + '/api/client/permissions', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.success) return;
    const perms = data.permissions || [];
    const links = [];
    if (perms.includes('vods')) links.push('<a href="/vods.html" style="color:var(--text-muted);text-decoration:none;padding:2px 6px;border-radius:3px">🎬 VODs</a>');
    container.innerHTML = links.join('');
  } catch {}
}

function startPingLoop() { ping(); setInterval(() => ping(), 15000); }

async function loadBotsInfo() {
  const el = document.getElementById('bots-info');
  if (!el) return;
  const bots = await fetchMyBots();
  el.textContent = bots.length === 0
    ? 'No tenés bots asignados. Contactá al administrador.'
    : `${bots.length} bot(es) asignado(s) — se usan automáticamente`;
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
  const list = document.getElementById('file-list');
  if (!list) return;
  if (files.length === 0) {
    list.innerHTML = '<li class="empty-state">Sin archivos cargados.</li>';
    document.getElementById('active-file-name').textContent = 'Ningún archivo seleccionado';
    document.getElementById('msg-count').textContent = '';
    return;
  }
  list.innerHTML = files.map((f, i) => {
    const total = getBlockCount(f);
    const done = getTotalSentBlocks(f);
    return `<li class="file-item${i === currentFileIndex ? ' file-active' : ''}" data-index="${i}">
      <span class="file-name">${esc(f.name)}</span>
      <span class="file-count">${done}/${total} bloques</span>
    </li>`;
  }).join('');
  list.querySelectorAll('.file-item').forEach(el => {
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
    list.innerHTML = '<li class="empty-state">Seleccioná un archivo de la lista.</li>';
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
      // migrate old format (flat messages) to blocks
      for (const f of parsed) {
        if (!f.blocks && f.messages) {
          f.blocks = [{ messages: f.messages, sent: false }];
          delete f.messages;
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

  // advance past already-sent blocks
  while (file.currentBlock < file.blocks.length && file.blocks[file.currentBlock].sent) {
    file.currentBlock++;
  }
  if (file.currentBlock >= file.blocks.length) {
    isSendingBlock = false;
    return;
  }

  const block = file.blocks[file.currentBlock];

  for (let i = 0; i < block.messages.length; i++) {
    const msg = block.messages[i];
    if (statusEl) statusEl.textContent = `Enviando bloque ${file.currentBlock + 1}/${file.blocks.length} (msg ${i + 1}/${block.messages.length})…`;
    renderMessageList();

    const res = await sendMessage({ channel: channelName, message: msg, chatroom_id: chatroomId || undefined });

    if (res.ok) {
      if (statusEl) statusEl.textContent = `✓ Bloque ${file.currentBlock + 1}: "${msg.substring(0, 30)}…"`;
      renderMessageList();
    } else {
      if (statusEl) statusEl.textContent = `Error: ${res.message || res.error}`;
      if (res.status !== 401) {
        isSendingBlock = false;
        stopAutoSend();
        return;
      }
    }

    if (i < block.messages.length - 1) {
      await new Promise(r => setTimeout(r, getIntraBlockDelay()));
    }
  }

  block.sent = true;
  file.currentBlock++;
  saveFiles();
  renderMessageList();

  if (allBlocksSent(file)) {
    if (statusEl) statusEl.textContent = '✓ Todos los bloques enviados.';
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
  if (!channelName) { alert('Configurá el canal en Ajustes.'); switchTab('settings'); return; }
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
  const file = currentFileIndex >= 0 && currentFileIndex < files.length ? files[currentFileIndex] : null;
  const hasPendingBlocks = file && file.blocks && !allBlocksSent(file);
  const running = autoMode;
  if (start) start.disabled = running || !hasPendingBlocks;
  if (stop) stop.disabled = !running;
  if (sendOnce) sendOnce.disabled = running || !hasPendingBlocks;
}

function loadSettings() {
  const saved = JSON.parse(localStorage.getItem('scb_settings') || '{}');
  if (saved.channelName) { document.getElementById('cfg-channel').value = saved.channelName; channelName = saved.channelName; }
  if (saved.intervalMin) { document.getElementById('cfg-interval-min').value = saved.intervalMin; intervalMin = saved.intervalMin; }
  if (saved.intervalMax) { document.getElementById('cfg-interval-max').value = saved.intervalMax; intervalMax = saved.intervalMax; }
  if (saved.chatroomId) { document.getElementById('cfg-chatroom-id').value = saved.chatroomId; chatroomId = saved.chatroomId; }
}

function handleSaveSettings() {
  const channel = document.getElementById('cfg-channel')?.value.trim() || '';
  const min = parseInt(document.getElementById('cfg-interval-min')?.value || '3', 10);
  const max = parseInt(document.getElementById('cfg-interval-max')?.value || '8', 10);
  const roomId = document.getElementById('cfg-chatroom-id')?.value.trim() || '';
  if (!channel) { showSettingsMsg('Ingresá el nombre del canal.', 'error'); return; }
  if (min < 1 || max < 1) { showSettingsMsg('Los intervalos mínimos son 1 seg.', 'error'); return; }
  localStorage.setItem('scb_settings', JSON.stringify({ channelName: channel, intervalMin: min, intervalMax: max, chatroomId: roomId }));
  channelName = channel;
  intervalMin = min;
  intervalMax = max;
  chatroomId = roomId;
  showSettingsMsg('Configuración guardada.', 'success');
  ping();
}

function showSettingsMsg(msg, type) {
  const el = document.getElementById('settings-msg');
  if (!el) return;
  el.textContent = msg; el.dataset.type = type; el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 3000);
}

function switchTab(name) {
  document.querySelector(`[data-tab="${name}"]`)?.click();
}

export async function initChatUI() {
  initTabs();

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

  onStatusChange(updateStatusUI);
  startPingLoop();
  loadBotsInfo();
  renderNavLinks();
  loadPools();

  document.getElementById('load-file-btn')?.addEventListener('click', handleLoadFile);
  document.getElementById('start-btn')?.addEventListener('click', startAutoSend);
  document.getElementById('stop-btn')?.addEventListener('click', stopAutoSend);
  document.getElementById('send-once-btn')?.addEventListener('click', sendCurrentMessage);
  document.getElementById('save-settings-btn')?.addEventListener('click', handleSaveSettings);

  loadSettings();
  loadSavedFiles();
  if (files.length > 0 && currentFileIndex < 0) currentFileIndex = 0;
  renderFileList();
  renderMessageList();
  updateButtonStates();
}

async function loadPools() {
  const section = document.getElementById('pools-section');
  const container = document.getElementById('pool-buttons');
  if (!section || !container) return;
  try {
    const res = await fetch(getServerUrl() + '/api/chat/pools', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.success || !data.pools || data.pools.length === 0) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    container.innerHTML = data.pools.map(p =>
      `<button class="pool-btn" data-pool-id="${p.id}" data-pool-name="${esc(p.name)}">${esc(p.name)} (${p.message_count})</button>`
    ).join('');
    container.querySelectorAll('.pool-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const channel = channelName || document.getElementById('cfg-channel')?.value?.trim();
        if (!channel) { alert('Configurá el canal en Ajustes primero.'); return; }
        const poolId = parseInt(btn.dataset.poolId, 10);
        btn.classList.add('send');
        btn.textContent = 'Enviando...';
        try {
          const res = await fetch(getServerUrl() + '/api/chat/send-random', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ channel, pool_id: poolId })
          });
          const data = await res.json();
          btn.textContent = data.success ? '✓ Enviado' : '✗ ' + (data.message || 'Error');
          setTimeout(() => {
            btn.classList.remove('send');
            const p = data.pools?.find(x => x.id === poolId);
            btn.textContent = `${btn.dataset.poolName} (${p?.message_count || '?'})`;
          }, 2000);
        } catch {
          btn.textContent = 'Error';
          setTimeout(() => { btn.classList.remove('send'); btn.textContent = btn.dataset.poolName; }, 2000);
        }
      });
    });
  } catch { section.style.display = 'none'; }
}

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
