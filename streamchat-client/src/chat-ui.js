/**
 * chat-ui.js  –  StreamChat Bridge FASE 2
 *
 * Interfaz de chat con pestañas:
 *  - Pestaña "Chat": lista de mensajes cargados desde .txt, botones de envío.
 *  - Pestaña "Settings": formulario de configuración (serverUrl, channel, interval).
 *
 * Maneja:
 *  - Carga de archivos .txt con validación de errores.
 *  - Estado de conexión (badge en el header).
 *  - Envío de mensajes al servidor vía bridge-client.
 *
 * NUNCA importa crypto ni bearers.
 */

// Los módulos TS se importan ya compilados; en dev puedes usar ts-node o esbuild.
// Aquí se asume que bridge-client.ts fue compilado a bridge-client.js
import {
  onStatusChange,
  ping,
  sendMessage,
  getStatus,
  setServerUrl,
} from '../modules/bridge-client.js';

// ──────────────────────────────────────────────────────────────
// Estado interno
// ──────────────────────────────────────────────────────────────

/** @type {string[]} */
let messageQueue = [];
let currentIndex = 0;
let sendInterval = 5;     // segundos
let channelName  = '';
let intervalId   = null;  // setInterval handle

// ──────────────────────────────────────────────────────────────
// Referencias DOM
// ──────────────────────────────────────────────────────────────

const dom = {
  // Tabs
  tabBtns:      () => document.querySelectorAll('.tab-btn'),
  tabPanels:    () => document.querySelectorAll('.tab-panel'),

  // Status
  statusBadge:  () => document.getElementById('status-badge'),
  statusLabel:  () => document.getElementById('status-label'),

  // Chat panel
  msgList:      () => document.getElementById('msg-list'),
  msgCount:     () => document.getElementById('msg-count'),
  loadFileBtn:  () => document.getElementById('load-file-btn'),
  fileInfo:     () => document.getElementById('file-info'),
  fileError:    () => document.getElementById('file-error'),
  startBtn:     () => document.getElementById('start-btn'),
  stopBtn:      () => document.getElementById('stop-btn'),
  sendOnceBtn:  () => document.getElementById('send-once-btn'),
  progressBar:  () => document.getElementById('progress-bar'),
  sendStatus:   () => document.getElementById('send-status'),

  // Settings panel
  serverUrlInp: () => document.getElementById('cfg-server-url'),
  channelInp:   () => document.getElementById('cfg-channel'),
  intervalInp:  () => document.getElementById('cfg-interval'),
  saveSettBtn:  () => document.getElementById('save-settings-btn'),
  settMsg:      () => document.getElementById('settings-msg'),
};

// ──────────────────────────────────────────────────────────────
// Tab switcher
// ──────────────────────────────────────────────────────────────

function initTabs() {
  dom.tabBtns().forEach(btn => {
    btn.addEventListener('click', () => {
      dom.tabBtns().forEach(b => b.classList.remove('active'));
      dom.tabPanels().forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.tab;
      document.getElementById(`panel-${target}`)?.classList.add('active');
    });
  });
}

// ──────────────────────────────────────────────────────────────
// Estado de conexión
// ──────────────────────────────────────────────────────────────

function updateStatusUI(status) {
  const badge = dom.statusBadge();
  const label = dom.statusLabel();
  if (!badge || !label) return;

  badge.className = `status-dot status-${status}`;
  label.textContent =
    status === 'connected'    ? 'Conectado'     :
    status === 'checking'     ? 'Verificando…'  :
    'Desconectado';
}

function startPingLoop() {
  // Primer ping inmediato
  ping();
  // Luego cada 15 s
  setInterval(() => ping(), 15_000);
}

// ──────────────────────────────────────────────────────────────
// Carga de archivos .txt
// ──────────────────────────────────────────────────────────────

function renderMessageList() {
  const list = dom.msgList();
  if (!list) return;

  list.innerHTML = '';

  if (messageQueue.length === 0) {
    list.innerHTML = '<li class="empty-state">Sin mensajes cargados.</li>';
    dom.msgCount()?.setAttribute('data-count', '0');
    return;
  }

  messageQueue.forEach((msg, i) => {
    const li = document.createElement('li');
    li.className = `msg-item${i === currentIndex ? ' msg-current' : ''}`;
    li.dataset.index = String(i);
    li.title = msg;

    const num  = document.createElement('span');
    num.className   = 'msg-num';
    num.textContent = `${i + 1}`;

    const text = document.createElement('span');
    text.className   = 'msg-text';
    text.textContent = msg;

    li.appendChild(num);
    li.appendChild(text);
    list.appendChild(li);
  });

  dom.msgCount()?.setAttribute('data-count', String(messageQueue.length));
  updateProgress();
}

async function handleLoadFile() {
  const fileError = dom.fileError();
  const fileInfo  = dom.fileInfo();

  if (fileError) { fileError.textContent = ''; fileError.hidden = true; }
  if (fileInfo)  { fileInfo.textContent  = ''; }

  const result = await window.bridge?.openTxtFile();

  if (!result) {
    showFileError('El módulo de archivos no está disponible.');
    return;
  }

  if (!result.ok) {
    showFileError(result.error ?? 'Error desconocido al leer el archivo.');
    return;
  }

  messageQueue = result.lines;
  currentIndex = 0;

  if (fileInfo) {
    fileInfo.textContent = `${result.fileName}  ·  ${result.total} mensaje(s)`;
  }

  renderMessageList();
  updateButtonStates();
}

function showFileError(msg) {
  const el = dom.fileError();
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

// ──────────────────────────────────────────────────────────────
// Envío de mensajes
// ──────────────────────────────────────────────────────────────

async function sendCurrentMessage() {
  if (messageQueue.length === 0 || currentIndex >= messageQueue.length) return;

  const message = messageQueue[currentIndex];
  const statusEl = dom.sendStatus();

  if (statusEl) statusEl.textContent = `Enviando (${currentIndex + 1}/${messageQueue.length})…`;

  const res = await sendMessage({
    channel:  channelName,
    message,
    platform: 'kick',
  });

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
    // Si fue 401, bridge-client ya redirigió; en cualquier otro error, pausamos
    if (res.status !== 401) stopAutoSend();
  }
}

function startAutoSend() {
  if (intervalId !== null) return;
  if (messageQueue.length === 0) {
    showFileError('Carga un archivo de mensajes primero.');
    return;
  }
  if (!channelName) {
    showFileError('Configura el nombre del canal en Ajustes.');
    switchTab('settings');
    return;
  }

  intervalId = setInterval(sendCurrentMessage, sendInterval * 1000);
  updateButtonStates();
  dom.sendStatus()?.setAttribute('data-running', 'true');
}

function stopAutoSend() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  updateButtonStates();
  dom.sendStatus()?.removeAttribute('data-running');
}

function updateProgress() {
  const bar = dom.progressBar();
  if (!bar || messageQueue.length === 0) return;
  const pct = Math.round((currentIndex / messageQueue.length) * 100);
  bar.style.width = `${pct}%`;
  bar.setAttribute('aria-valuenow', String(pct));
}

function updateButtonStates() {
  const start    = dom.startBtn();
  const stop     = dom.stopBtn();
  const sendOnce = dom.sendOnceBtn();
  const hasQueue = messageQueue.length > 0 && currentIndex < messageQueue.length;
  const running  = intervalId !== null;

  if (start)    start.disabled    = running || !hasQueue;
  if (stop)     stop.disabled     = !running;
  if (sendOnce) sendOnce.disabled = running || !hasQueue;
}

// ──────────────────────────────────────────────────────────────
// Settings
// ──────────────────────────────────────────────────────────────

async function loadSettings() {
  const result = await window.bridge?.settingsRead();
  if (!result?.ok || !result.settings) return;

  const s = result.settings;

  if (s.serverUrl) {
    dom.serverUrlInp().value = s.serverUrl;
    setServerUrl(s.serverUrl);
    sessionStorage.setItem('scb_server_url', s.serverUrl.replace(/\/+$/, ''));
  }
  if (s.channelName) {
    dom.channelInp().value = s.channelName;
    channelName = s.channelName;
  }
  if (s.sendInterval) {
    dom.intervalInp().value = String(s.sendInterval);
    sendInterval = Number(s.sendInterval);
  }
}

async function handleSaveSettings() {
  const url      = dom.serverUrlInp()?.value.trim() ?? '';
  const channel  = dom.channelInp()?.value.trim()   ?? '';
  const interval = parseInt(dom.intervalInp()?.value ?? '5', 10);
  const msgEl    = dom.settMsg();

  if (!url)          { showSettingsMsg('Ingresa la URL del servidor.',    'error'); return; }
  if (!channel)      { showSettingsMsg('Ingresa el nombre del canal.',    'error'); return; }
  if (interval < 1)  { showSettingsMsg('El intervalo mínimo es 1 seg.',  'error'); return; }

  const res = await window.bridge?.settingsWrite({ serverUrl: url, channelName: channel, sendInterval: interval });

  if (res?.ok) {
    channelName  = channel;
    sendInterval = interval;
    setServerUrl(url);
    sessionStorage.setItem('scb_server_url', url.replace(/\/+$/, ''));
    showSettingsMsg('Configuración guardada.', 'success');
    ping();
  } else {
    showSettingsMsg(res?.error ?? 'No se pudo guardar.', 'error');
  }
}

function showSettingsMsg(msg, type) {
  const el = dom.settMsg();
  if (!el) return;
  el.textContent  = msg;
  el.dataset.type = type;
  el.hidden       = false;
  setTimeout(() => { el.hidden = true; }, 3000);
}

function switchTab(name) {
  document.querySelector(`[data-tab="${name}"]`)?.click();
}

// ──────────────────────────────────────────────────────────────
// Bootstrap
// ──────────────────────────────────────────────────────────────

export function initChatUI() {
  initTabs();

  // Conexión al estado del bridge
  onStatusChange(updateStatusUI);
  startPingLoop();

  // Chat
  dom.loadFileBtn()?.addEventListener('click', handleLoadFile);
  dom.startBtn()?.addEventListener('click', startAutoSend);
  dom.stopBtn()?.addEventListener('click', stopAutoSend);
  dom.sendOnceBtn()?.addEventListener('click', sendCurrentMessage);

  // Settings
  dom.saveSettBtn()?.addEventListener('click', handleSaveSettings);

  loadSettings().then(() => {
    renderMessageList();
    updateButtonStates();
  });
}

// Auto-inicio si el script se carga directamente en la página
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', initChatUI);
}