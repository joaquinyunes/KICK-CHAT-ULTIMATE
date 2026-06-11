import { onStatusChange, ping, sendMessage, setServerUrl, fetchMyBots } from './bridge-client.js';

let messageQueue = [];
let currentIndex = 0;
let sendInterval = 5;
let channelName = '';
let intervalId = null;

// ── Tabs ────────────────────────────────────────────
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

// ── Connection status ───────────────────────────────
function updateStatusUI(status) {
  const badge = document.getElementById('status-badge');
  const label = document.getElementById('status-label');
  if (!badge || !label) return;
  badge.className = `status-dot status-${status}`;
  label.textContent = status === 'connected' ? 'Conectado' : status === 'checking' ? 'Verificando…' : 'Desconectado';
}

function startPingLoop() {
  ping();
  setInterval(() => ping(), 15000);
}

// ── File loading ────────────────────────────────────
function renderMessageList() {
  const list = document.getElementById('msg-list');
  if (!list) return;
  list.innerHTML = '';
  if (messageQueue.length === 0) {
    list.innerHTML = '<li class="empty-state">Sin mensajes cargados.</li>';
    return;
  }
  messageQueue.forEach((msg, i) => {
    const li = document.createElement('li');
    li.className = `msg-item${i === currentIndex ? ' msg-current' : ''}`;
    li.innerHTML = `<span class="msg-num">${i + 1}</span><span class="msg-text">${msg}</span>`;
    list.appendChild(li);
  });
  updateProgress();
  updateButtonStates();
}

function handleLoadFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.txt';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    messageQueue = text.split('\n').filter(l => l.trim());
    currentIndex = 0;
    document.getElementById('file-info').textContent = `${file.name} · ${messageQueue.length} mensaje(s)`;
    renderMessageList();
  });
  input.click();
}

// ── Bot selector ────────────────────────────────────
async function loadMyBots() {
  const select = document.getElementById('bot-select');
  if (!select) return;
  select.innerHTML = '<option value="">Cargando...</option>';
  const bots = await fetchMyBots();
  if (bots.length === 0) {
    select.innerHTML = '<option value="">Sin bots asignados</option>';
    return;
  }
  select.innerHTML = bots.map(b => `<option value="${b.bot_name}">${b.bot_name}</option>`).join('');
}

function getSelectedBot() {
  const select = document.getElementById('bot-select');
  return select?.value || '';
}

// ── Sending ─────────────────────────────────────────
async function sendCurrentMessage() {
  if (messageQueue.length === 0 || currentIndex >= messageQueue.length) return;
  const message = messageQueue[currentIndex];
  const statusEl = document.getElementById('send-status');
  if (statusEl) statusEl.textContent = `Enviando (${currentIndex + 1}/${messageQueue.length})…`;

  const botName = getSelectedBot();
  if (!botName) {
    if (statusEl) statusEl.textContent = '✘ Seleccioná un bot primero.';
    stopAutoSend();
    return;
  }
  const res = await sendMessage({ channel: channelName, message, bot_name: botName });

  if (res.ok) {
    if (statusEl) statusEl.textContent = `✔ Enviado: "${message.substring(0, 40)}…"`;
    currentIndex++;
    renderMessageList();
    if (currentIndex >= messageQueue.length) {
      stopAutoSend();
      if (statusEl) statusEl.textContent = '✔ Todos los mensajes enviados.';
    }
  } else {
    if (statusEl) statusEl.textContent = `✘ Error: ${res.error}`;
    if (res.status !== 401) stopAutoSend();
  }
}

function startAutoSend() {
  if (intervalId !== null) return;
  if (messageQueue.length === 0) { alert('Carga un archivo de mensajes primero.'); return; }
  if (!channelName) { alert('Configura el nombre del canal en Ajustes.'); switchTab('settings'); return; }
  intervalId = setInterval(sendCurrentMessage, sendInterval * 1000);
  updateButtonStates();
}

function stopAutoSend() {
  if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
  updateButtonStates();
}

function updateProgress() {
  const bar = document.getElementById('progress-bar');
  if (!bar || messageQueue.length === 0) return;
  const pct = Math.round((currentIndex / messageQueue.length) * 100);
  bar.style.width = `${pct}%`;
}

function updateButtonStates() {
  const start = document.getElementById('start-btn');
  const stop = document.getElementById('stop-btn');
  const sendOnce = document.getElementById('send-once-btn');
  const hasQueue = messageQueue.length > 0 && currentIndex < messageQueue.length;
  const running = intervalId !== null;
  if (start) start.disabled = running || !hasQueue;
  if (stop) stop.disabled = !running;
  if (sendOnce) sendOnce.disabled = running || !hasQueue;
}

// ── Settings ────────────────────────────────────────
function loadSettings() {
  const serverUrl = localStorage.getItem('scb_server_url');
  const saved = JSON.parse(localStorage.getItem('scb_settings') || '{}');
  if (serverUrl) { document.getElementById('cfg-server-url').value = serverUrl; setServerUrl(serverUrl); }
  if (saved.channelName) { document.getElementById('cfg-channel').value = saved.channelName; channelName = saved.channelName; }
  if (saved.sendInterval) { document.getElementById('cfg-interval').value = saved.sendInterval; sendInterval = saved.sendInterval; }
}

function handleSaveSettings() {
  const url = document.getElementById('cfg-server-url')?.value.trim() || '';
  const channel = document.getElementById('cfg-channel')?.value.trim() || '';
  const interval = parseInt(document.getElementById('cfg-interval')?.value || '5', 10);
  if (!url) { showSettingsMsg('Ingresa la URL del servidor.', 'error'); return; }
  if (!channel) { showSettingsMsg('Ingresa el nombre del canal.', 'error'); return; }
  if (interval < 1) { showSettingsMsg('El intervalo mínimo es 1 seg.', 'error'); return; }

  localStorage.setItem('scb_server_url', url.replace(/\/+$/, ''));
  localStorage.setItem('scb_settings', JSON.stringify({ channelName: channel, sendInterval: interval }));
  channelName = channel;
  sendInterval = interval;
  setServerUrl(url);
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

// ── Admin panel ─────────────────────────────────────
function isAdmin() { return sessionStorage.getItem('scb_role') === 'admin'; }

function getAuthHeaders() {
  const token = sessionStorage.getItem('scb_jwt');
  return { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' };
}

function getServerUrl() { return (sessionStorage.getItem('scb_server_url') || '').replace(/\/+$/, ''); }
function getLocalServerUrl() { return (localStorage.getItem('scb_server_url') || '').replace(/\/+$/, ''); }

function showAdminMsg(elId, msg, type) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg; el.dataset.type = type; el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 3000);
}

async function handleAdminAddBot() {
  const botName = document.getElementById('adm-bot-name')?.value?.trim();
  const bearer = document.getElementById('adm-bot-bearer')?.value?.trim();
  if (!botName || !bearer) { showAdminMsg('adm-bot-msg', 'Completa todos los campos.', 'error'); return; }
  try {
    const res = await fetch(`${getServerUrl()}/admin/bots`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ bot_name: botName, bearer }) });
    const data = await res.json();
    if (res.ok) { showAdminMsg('adm-bot-msg', `✅ Bot "${botName}" agregado.`, 'success'); document.getElementById('adm-bot-name').value = ''; document.getElementById('adm-bot-bearer').value = ''; }
    else { showAdminMsg('adm-bot-msg', `❌ ${data.error || 'Error'}`, 'error'); }
  } catch { showAdminMsg('adm-bot-msg', '❌ Error de conexión.', 'error'); }
}

async function handleAdminCreateClient() {
  const username = document.getElementById('adm-client-name')?.value?.trim();
  const password = document.getElementById('adm-client-pass')?.value?.trim();
  if (!username || !password) { showAdminMsg('adm-client-msg', 'Completa todos los campos.', 'error'); return; }
  if (password.length < 6) { showAdminMsg('adm-client-msg', 'La contraseña debe tener al menos 6 caracteres.', 'error'); return; }
  try {
    const res = await fetch(`${getServerUrl()}/admin/users`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (res.ok) { showAdminMsg('adm-client-msg', `✅ Cliente "${username}" creado.`, 'success'); document.getElementById('adm-client-name').value = ''; document.getElementById('adm-client-pass').value = ''; }
    else { showAdminMsg('adm-client-msg', `❌ ${data.error || 'Error'}`, 'error'); }
  } catch { showAdminMsg('adm-client-msg', '❌ Error de conexión.', 'error'); }
}

async function handleAdminAssign() {
  const botName = document.getElementById('adm-assign-bot-name')?.value?.trim();
  const username = document.getElementById('adm-assign-client')?.value?.trim();
  if (!botName || !username) { showAdminMsg('adm-assign-msg', 'Completa todos los campos.', 'error'); return; }
  try {
    const base = getServerUrl();
    const botsRes = await fetch(`${base}/admin/bots`, { headers: getAuthHeaders() });
    const botsData = await botsRes.json();
    if (!botsData.success) { showAdminMsg('adm-assign-msg', '❌ No se pudieron obtener los bots.', 'error'); return; }
    const bot = botsData.bots.find(b => b.bot_name === botName);
    if (!bot) { showAdminMsg('adm-assign-msg', `❌ Bot "${botName}" no encontrado.`, 'error'); return; }
    const res = await fetch(`${base}/admin/assign`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ bot_id: bot.id, username }) });
    const data = await res.json();
    if (res.ok) { showAdminMsg('adm-assign-msg', `✅ Bot "${botName}" asignado a "${username}".`, 'success'); document.getElementById('adm-assign-bot-name').value = ''; document.getElementById('adm-assign-client').value = ''; }
    else { showAdminMsg('adm-assign-msg', `❌ ${data.error || 'Error'}`, 'error'); }
  } catch { showAdminMsg('adm-assign-msg', '❌ Error de conexión.', 'error'); }
}

// ── Init ────────────────────────────────────────────
export function initChatUI() {
  initTabs();

  const adminTabBtn = document.getElementById('admin-tab-btn');
  if (adminTabBtn) adminTabBtn.hidden = !isAdmin();

  onStatusChange(updateStatusUI);
  startPingLoop();

  document.getElementById('load-file-btn')?.addEventListener('click', handleLoadFile);
  document.getElementById('start-btn')?.addEventListener('click', startAutoSend);
  document.getElementById('stop-btn')?.addEventListener('click', stopAutoSend);
  document.getElementById('send-once-btn')?.addEventListener('click', sendCurrentMessage);
  document.getElementById('save-settings-btn')?.addEventListener('click', handleSaveSettings);

  document.getElementById('adm-add-bot-btn')?.addEventListener('click', handleAdminAddBot);
  document.getElementById('adm-create-client-btn')?.addEventListener('click', handleAdminCreateClient);
  document.getElementById('adm-assign-btn')?.addEventListener('click', handleAdminAssign);

  loadSettings();
  loadMyBots();
  renderMessageList();
  updateButtonStates();
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', initChatUI);
}
