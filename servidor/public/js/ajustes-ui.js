import { requireAuth, startStatusLoop, renderNav, renderAuthHeader } from './client-nav.js';

function loadSettingsUI() {
  const saved = JSON.parse(localStorage.getItem('scb_settings') || '{}');
  if (saved.channelName) document.getElementById('cfg-channel').value = saved.channelName;
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
  if (!channel) { showMsg('Ingresá el nombre del canal.', 'error'); return; }
  localStorage.setItem('scb_settings', JSON.stringify({ channelName: channel }));
  document.getElementById('cfg-channel').value = channel;
  showMsg('Canal guardado.', 'success');
}

window.addEventListener('DOMContentLoaded', async () => {
  const ok = await requireAuth();
  if (!ok) return;
  renderAuthHeader('ajustes');
  renderNav('ajustes');
  startStatusLoop();
  loadSettingsUI();
  document.getElementById('save-settings-btn')?.addEventListener('click', handleSaveSettings);
});