import { onStatusChange, ping, sendMessage, fetchMyBots } from './bridge-client.js';
import { getServerUrl, getAuthHeaders } from './admin-common.js';

function esc(str) { if (str == null) return ''; return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

let files = [];
let currentFileIndex = -1;
let intervalId = null;
let channelName = '';
let intervalMin = 3;
let intervalMax = 8;
let chatroomId = '';


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

function renderFileList() {
  const list = document.getElementById('file-list');
  if (!list) return;
  if (files.length === 0) {
    list.innerHTML = '<li class="empty-state">Sin archivos cargados.</li>';
    document.getElementById('active-file-name').textContent = 'Ningún archivo seleccionado';
    document.getElementById('msg-count').textContent = '';
    return;
  }
  list.innerHTML = files.map((f, i) => `
    <li class="file-item${i === currentFileIndex ? ' file-active' : ''}" data-index="${i}">
      <span class="file-name">${esc(f.name)}</span>
      <span class="file-count">${f.messages.length} msgs</span>
    </li>
  `).join('');
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
  if (countEl) countEl.textContent = `${file.currentIndex + 1 || 0}/${file.messages.length}`;
  if (file.messages.length === 0) {
    list.innerHTML = '<li class="empty-state">Archivo vacío.</li>';
    return;
  }
  list.innerHTML = file.messages.map((msg, i) => `
    <li class="msg-item${i === (file.currentIndex || 0) ? ' msg-current' : ''}">
      <span class="msg-num">${i + 1}</span>
      <span class="msg-text">${esc(msg)}</span>
    </li>
  `).join('');
  updateProgress();
}

function saveFiles() {
  try { localStorage.setItem('scb_files', JSON.stringify(files)); } catch {}
}

function loadSavedFiles() {
  try {
    const saved = localStorage.getItem('scb_files');
    if (saved) files = JSON.parse(saved);
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
    for (const file of fileList) {
      const text = await file.text();
      const messages = text.split('\n').filter(l => l.trim());
      files.push({ name: file.name, messages, currentIndex: 0 });
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

async function sendCurrentMessage() {
  if (currentFileIndex < 0 || currentFileIndex >= files.length) return;
  const file = files[currentFileIndex];
  if (!file.messages || file.messages.length === 0) return;
  if ((file.currentIndex || 0) >= file.messages.length) return;
  const idx = file.currentIndex || 0;
  const message = file.messages[idx];
  const statusEl = document.getElementById('send-status');
  if (statusEl) statusEl.textContent = `Enviando (${idx + 1}/${file.messages.length})…`;
  const res = await sendMessage({ channel: channelName, message, chatroom_id: chatroomId || undefined });
  if (res.ok) {
    if (statusEl) statusEl.textContent = `Enviado: "${message.substring(0, 40)}…"`;
    file.currentIndex = idx + 1;
    saveFiles();
    renderMessageList();
    if ((file.currentIndex) >= file.messages.length) {
      stopAutoSend();
      if (statusEl) statusEl.textContent = 'Todos los mensajes enviados.';
    }
  } else {
    if (statusEl) statusEl.textContent = `Error: ${res.message || res.error}`;
    if (res.status !== 401) stopAutoSend();
  }
}

function startAutoSend() {
  if (intervalId !== null) return;
  if (currentFileIndex < 0 || files.length === 0) { alert('Cargá archivos .txt primero.'); return; }
  if (!channelName) { alert('Configurá el canal en Ajustes.'); switchTab('settings'); return; }
  const send = async () => {
    await sendCurrentMessage();
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = setInterval(send, getRandomInterval());
      updateButtonStates();
    }
  };
  send();
  intervalId = setInterval(send, getRandomInterval());
  updateButtonStates();
}

function stopAutoSend() {
  if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
  updateButtonStates();
  document.getElementById('send-status')?.removeAttribute('data-running');
}

function updateProgress() {
  if (currentFileIndex < 0 || currentFileIndex >= files.length) return;
  const file = files[currentFileIndex];
  const bar = document.getElementById('progress-bar');
  if (!bar || !file.messages || file.messages.length === 0) return;
  const pct = Math.round(((file.currentIndex || 0) / file.messages.length) * 100);
  bar.style.width = `${pct}%`;
}

function updateButtonStates() {
  const start = document.getElementById('start-btn');
  const stop = document.getElementById('stop-btn');
  const sendOnce = document.getElementById('send-once-btn');
  const hasQueue = currentFileIndex >= 0 && files[currentFileIndex]?.messages?.length > 0 &&
    (files[currentFileIndex].currentIndex || 0) < files[currentFileIndex].messages.length;
  const running = intervalId !== null;
  if (start) start.disabled = running || !hasQueue;
  if (stop) stop.disabled = !running;
  if (sendOnce) sendOnce.disabled = running || !hasQueue;
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
    // Sincronizar token existente a cookie httpOnly
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

// ─── Simulator integration ─────────────────────────────────────
window.addGeneratedMessages = function (msgs, name) {
  const msgLines = msgs.map(m => `${m.user}: ${m.message}`);
  files.push({ name: name || `IA - ${new Date().toLocaleTimeString()}`, messages: msgLines, currentIndex: 0 });
  if (currentFileIndex < 0) currentFileIndex = files.length - 1;
  saveFiles();
  renderFileList();
  renderMessageList();
  updateButtonStates();
};

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => { initChatUI(); });
}
