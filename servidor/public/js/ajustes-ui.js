import { requireAuth, startStatusLoop, renderNav, renderAuthHeader } from './client-nav.js';

function loadSettingsUI() {
  const saved = JSON.parse(localStorage.getItem('scb_settings') || '{}');
  if (saved.channelName) document.getElementById('cfg-channel').value = saved.channelName;
  if (saved.intervalMin) document.getElementById('cfg-interval-min').value = saved.intervalMin;
  if (saved.intervalMax) document.getElementById('cfg-interval-max').value = saved.intervalMax;
  if (saved.chatroomId) document.getElementById('cfg-chatroom-id').value = saved.chatroomId;
  document.getElementById('simKeyInput').value = localStorage.getItem('openrouter_api_key') || '';
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

function showMsg(msg, type) {
  const el = document.getElementById('settings-msg');
  if (!el) return;
  el.textContent = msg; el.dataset.type = type; el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 3000);
}

function handleSaveSettings() {
  const channel = normalizeChannel(document.getElementById('cfg-channel')?.value.trim() || '');
  const min = parseInt(document.getElementById('cfg-interval-min')?.value || '3', 10);
  const max = parseInt(document.getElementById('cfg-interval-max')?.value || '8', 10);
  const roomId = document.getElementById('cfg-chatroom-id')?.value.trim() || '';
  if (!channel && !roomId) { showMsg('Ingresá el nombre del canal o el Chatroom ID.', 'error'); return; }
  if (min < 1 || max < 1) { showMsg('Los intervalos mínimos son 1 seg.', 'error'); return; }
  localStorage.setItem('scb_settings', JSON.stringify({ channelName: channel, intervalMin: min, intervalMax: max, chatroomId: roomId }));
  var g = document.getElementById('cfg-channel');
  if (g) g.value = channel;
  showMsg('Configuración guardada.', 'success');
}

function handleSaveKey() {
  const v = document.getElementById('simKeyInput').value.trim();
  if (!v) { showMsg('Escribí la API key.', 'error'); return; }
  localStorage.setItem('openrouter_api_key', v);
  fetch('/api/chat/set-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: v }) }).catch(() => {});
  showMsg('API Key guardada.', 'success');
}

window.addEventListener('DOMContentLoaded', async () => {
  const ok = await requireAuth();
  if (!ok) return;
  renderAuthHeader('ajustes');
  renderNav('ajustes');
  startStatusLoop();
  loadSettingsUI();
  document.getElementById('save-settings-btn')?.addEventListener('click', handleSaveSettings);
  document.getElementById('save-or-key-btn')?.addEventListener('click', handleSaveKey);
});