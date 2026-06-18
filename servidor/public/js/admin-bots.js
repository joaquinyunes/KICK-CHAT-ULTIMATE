import { getServerUrl, getAuthHeaders, showMsg, checkOAuthResult, initCommon } from './admin-common.js';

async function handleAddBot() {
  const botName = document.getElementById('adm-bot-name')?.value?.trim();
  const bearer = document.getElementById('adm-bot-bearer')?.value?.trim();
  if (!botName || !bearer) { showMsg('adm-bot-msg', 'Completa todos los campos.', 'error'); return; }
  try {
    const res = await fetch(`${getServerUrl()}/api/admin/bots`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ bot_name: botName, bearer }) });
    const data = await res.json();
    if (res.ok) {
      showMsg('adm-bot-msg', `Bot "${botName}" agregado.`, 'success');
      document.getElementById('adm-bot-name').value = '';
      document.getElementById('adm-bot-bearer').value = '';
      loadBots();
    } else { showMsg('adm-bot-msg', `Error: ${data.error || 'Error'}`, 'error'); }
  } catch { showMsg('adm-bot-msg', 'Error de conexión.', 'error'); }
}

async function handleBulkAddBots() {
  const textarea = document.getElementById('adm-bulk-bots');
  const lines = textarea?.value?.split('\n').map(l => l.trim()).filter(l => l) || [];
  if (lines.length === 0) { showMsg('adm-bulk-msg', 'Pegá los bots en el formato nombre|bearer.', 'error'); return; }
  let added = 0, errors = [];
  for (const line of lines) {
    const sep = line.indexOf('|');
    if (sep === -1) { errors.push(`Línea inválida (falta |): ${line.substring(0, 30)}`); continue; }
    const botName = line.substring(0, sep).trim();
    const bearer = line.substring(sep + 1).trim();
    if (!botName || !bearer) { errors.push(`Línea incompleta: ${line.substring(0, 30)}`); continue; }
    try {
      const res = await fetch(`${getServerUrl()}/api/admin/bots`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ bot_name: botName, bearer }) });
      if (res.ok) added++;
      else { const d = await res.json(); errors.push(`${botName}: ${d.error || 'error'}`); }
    } catch { errors.push(`${botName}: error de conexión`); }
  }
  const msg = errors.length === 0 ? `${added} bots agregados.` : `${added} agregados, ${errors.length} errores: ${errors.slice(0, 3).join(', ')}`;
  showMsg('adm-bulk-msg', msg, errors.length === 0 ? 'success' : 'error');
  if (added > 0) { textarea.value = ''; loadBots(); }
}

async function loadBots() {
  const container = document.getElementById('adm-bot-list');
  if (!container) return;
  try {
    const res = await fetch(`${getServerUrl()}/api/admin/bots`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.success) { container.innerHTML = '<p style="opacity:0.6;font-style:italic">Error al cargar.</p>'; return; }
    const bots = data.bots || [];
    let html = `<div class="table-header"><span>Bot</span><span>OAuth</span><span>Bearer</span></div>`;
    if (bots.length === 0) {
      html = '<p style="opacity:0.6;font-style:italic">No hay bots todavía. Conectá una cuenta de Kick.</p>';
    } else {
      html += bots.map(b => {
        const oauth = b.has_oauth ? 'Conectado' : 'No conectado';
        const bearer = b.has_bearer ? 'Tiene token' : 'Sin token';
        return `<div class="table-row"><span><strong>${b.bot_name}</strong></span><span>${oauth}</span><span>${bearer}</span></div>`;
      }).join('');
    }
    container.innerHTML = html;
  } catch { container.innerHTML = '<p style="opacity:0.6;font-style:italic">Error al cargar bots.</p>'; }
}

async function startKickOAuth() {
  try {
    const res = await fetch(`${getServerUrl()}/auth/kick/start`, { method: 'POST', headers: getAuthHeaders() });
    const data = await res.json();
    if (data.url) {
      const box = document.getElementById('adm-oauth-url');
      const copyBtn = document.getElementById('adm-oauth-copy');
      const link = document.getElementById('adm-oauth-link');
      if (box) { box.value = data.url; box.hidden = false; box.select(); }
      if (copyBtn) copyBtn.hidden = false;
      if (link) { link.href = data.url; link.textContent = data.url; link.hidden = false; }
      document.getElementById('adm-oauth-url-label')?.removeAttribute('hidden');
    } else alert('Error al iniciar OAuth');
  } catch { alert('Error de conexión.'); }
}

function copyOAuthUrl() {
  const box = document.getElementById('adm-oauth-url');
  if (!box) return;
  box.select();
  navigator.clipboard?.writeText(box.value);
  const btn = document.getElementById('adm-oauth-copy');
  if (btn) { btn.textContent = 'Copiado'; setTimeout(() => { btn.textContent = 'Copiar'; }, 2000); }
}

window.addEventListener('DOMContentLoaded', () => {
  if (!initCommon()) return;
  checkOAuthResult('adm-bot-msg');
  loadBots();
  document.getElementById('adm-add-bot-btn')?.addEventListener('click', handleAddBot);
  document.getElementById('adm-bulk-add-btn')?.addEventListener('click', handleBulkAddBots);
  document.getElementById('adm-oauth-connect-btn')?.addEventListener('click', startKickOAuth);
  document.getElementById('adm-oauth-name-btn')?.addEventListener('click', startKickOAuth);
  document.getElementById('adm-oauth-copy')?.addEventListener('click', copyOAuthUrl);
});
