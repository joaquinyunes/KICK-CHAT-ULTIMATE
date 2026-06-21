import { getServerUrl, getAuthHeaders, showMsg, initCommon, esc } from './admin-common.js';

async function handleAddBot() {
  const bearer = document.getElementById('adm-bot-bearer')?.value?.trim();
  if (!bearer) { showMsg('adm-bot-msg', 'Pegá un bearer token.', 'error'); return; }
  try {
    const res = await fetch(`${getServerUrl()}/api/admin/bots`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ bearer }) });
    const data = await res.json();
    if (res.ok) {
      showMsg('adm-bot-msg', `Bot "${data.bot_name}" agregado.`, 'success');
      document.getElementById('adm-bot-bearer').value = '';
      loadBots();
    } else { showMsg('adm-bot-msg', `Error: ${data.error || 'Error'}`, 'error'); }
  } catch { showMsg('adm-bot-msg', 'Error de conexión.', 'error'); }
}

async function loadBots() {
  const container = document.getElementById('adm-bot-list');
  if (!container) return;
  try {
    const res = await fetch(`${getServerUrl()}/api/admin/bots`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.success) { container.innerHTML = '<p style="opacity:0.6;font-style:italic">Error al cargar.</p>'; return; }
    const bots = data.bots || [];
    if (bots.length === 0) {
      container.innerHTML = '<p style="opacity:0.6;font-style:italic">No hay bots todavía. Agregá un bearer token.</p>';
    } else {
      container.innerHTML = bots.map(b => `
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #333;padding:8px 0">
          <span><strong>${esc(b.bot_name)}</strong></span>
          <span style="font-size:0.85em;opacity:0.7">${b.has_bearer ? 'Bearer configurado' : 'Sin bearer'}</span>
        </div>
      `).join('');
    }
  } catch { container.innerHTML = '<p style="opacity:0.6;font-style:italic">Error al cargar bots.</p>'; }
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await initCommon())) return;
  loadBots();
  document.getElementById('adm-add-bot-btn')?.addEventListener('click', handleAddBot);
});
