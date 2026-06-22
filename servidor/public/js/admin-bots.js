import { getServerUrl, getAuthHeaders, showMsg, initCommon, esc } from './admin-common.js';

let editingBotId = null;

async function handleAddBot() {
  const bearer = document.getElementById('adm-bot-bearer')?.value?.trim();
  if (!bearer) { showMsg('adm-bot-msg', 'Pegá un bearer token.', 'error'); return; }
  try {
    if (editingBotId) {
      const res = await fetch(`${getServerUrl()}/api/admin/bots/${editingBotId}`, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ bearer }) });
      const data = await res.json();
      if (res.ok) {
        showMsg('adm-bot-msg', `Bot "${data.bot_name}" actualizado.`, 'success');
        cancelEdit();
        loadBots();
      } else { showMsg('adm-bot-msg', `Error: ${data.error || 'Error'}`, 'error'); }
    } else {
      const res = await fetch(`${getServerUrl()}/api/admin/bots`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ bearer }) });
      const data = await res.json();
      if (res.ok) {
        showMsg('adm-bot-msg', `Bot "${data.bot_name}" agregado.`, 'success');
        document.getElementById('adm-bot-bearer').value = '';
        loadBots();
      } else { showMsg('adm-bot-msg', `Error: ${data.error || 'Error'}`, 'error'); }
    }
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
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding:8px 0;gap:8px">
          <span><strong>${esc(b.bot_name)}</strong> <span style="font-size:0.85em;opacity:0.7">${b.has_bearer ? '✓ bearer' : '✗ sin bearer'}</span></span>
          <div style="display:flex;gap:4px;flex-shrink:0">
            <button class="btn-edit-bot" data-id="${b.id}" data-name="${esc(b.bot_name)}" style="background:none;border:1px solid var(--signal);color:var(--signal);font-size:11px;padding:3px 8px;border-radius:4px;cursor:pointer">Actualizar</button>
            <button class="btn-delete-bot" data-id="${b.id}" data-name="${esc(b.bot_name)}" style="background:none;border:1px solid var(--alert);color:var(--alert);font-size:11px;padding:3px 8px;border-radius:4px;cursor:pointer">Eliminar</button>
          </div>
        </div>
      `).join('');
      container.querySelectorAll('.btn-edit-bot').forEach(btn => {
        btn.addEventListener('click', () => startEdit(parseInt(btn.dataset.id), btn.dataset.name));
      });
      container.querySelectorAll('.btn-delete-bot').forEach(btn => {
        btn.addEventListener('click', () => deleteBot(parseInt(btn.dataset.id), btn.dataset.name));
      });
    }
  } catch { container.innerHTML = '<p style="opacity:0.6;font-style:italic">Error al cargar bots.</p>'; }
}

function startEdit(botId, botName) {
  editingBotId = botId;
  const input = document.getElementById('adm-bot-bearer');
  const btn = document.getElementById('adm-add-bot-btn');
  const title = document.querySelector('.admin-card-title');
  if (input) { input.value = ''; input.placeholder = 'Nuevo bearer para ' + botName; input.focus(); }
  if (btn) btn.textContent = 'Actualizar Bot';
  if (title) title.textContent = 'Actualizar Bot: ' + botName;
  document.getElementById('adm-cancel-edit')?.remove();
  const cancelBtn = document.createElement('button');
  cancelBtn.id = 'adm-cancel-edit';
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.className = 'btn btn-ghost';
  cancelBtn.style.cssText = 'margin-top:6px;font-size:12px;padding:6px 12px';
  btn?.parentNode?.appendChild(cancelBtn);
  cancelBtn.addEventListener('click', cancelEdit);
}

function cancelEdit() {
  editingBotId = null;
  const input = document.getElementById('adm-bot-bearer');
  const btn = document.getElementById('adm-add-bot-btn');
  const title = document.querySelector('.admin-card-title');
  if (input) { input.value = ''; input.placeholder = 'Pegá el bearer token aquí'; }
  if (btn) btn.textContent = 'Agregar Bot';
  if (title) title.textContent = 'Agregar Bot';
  document.getElementById('adm-cancel-edit')?.remove();
}

async function deleteBot(botId, botName) {
  if (!confirm(`Eliminar bot "${botName}"? Esta acción no se puede deshacer.`)) return;
  try {
    const res = await fetch(`${getServerUrl()}/api/admin/bots/${botId}`, { method: 'DELETE', headers: getAuthHeaders() });
    const data = await res.json();
    if (data.success) {
      showMsg('adm-bot-msg', `Bot "${botName}" eliminado.`, 'success');
      loadBots();
    } else { showMsg('adm-bot-msg', `Error: ${data.error || 'Error'}`, 'error'); }
  } catch { showMsg('adm-bot-msg', 'Error de conexión.', 'error'); }
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await initCommon())) return;
  loadBots();
  document.getElementById('adm-add-bot-btn')?.addEventListener('click', handleAddBot);
});
