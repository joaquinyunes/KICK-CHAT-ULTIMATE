import { getServerUrl, getAuthHeaders, showMsg, initCommon, esc } from './admin-common.js';

async function handleCreateClient() {
  const username = document.getElementById('adm-client-name')?.value?.trim();
  const password = document.getElementById('adm-client-pass')?.value?.trim();
  const linkUrl = document.getElementById('adm-client-link')?.value?.trim() || null;
  const expiresDays = parseInt(document.getElementById('adm-client-expires')?.value || '0', 10);
  if (!username || !password) { showMsg('adm-client-msg', 'Completa nombre y contraseña.', 'error'); return; }
  if (password.length < 6) { showMsg('adm-client-msg', 'Mínimo 6 caracteres.', 'error'); return; }
  const expiresAt = expiresDays > 0 ? Math.floor(Date.now() / 1000) + expiresDays * 86400 : null;
  const permChecks = document.querySelectorAll('.create-perm:checked');
  const permissions = Array.from(permChecks).map(c => c.value);
  const hourlyViewLimit = parseInt(document.getElementById('adm-client-hourly-limit')?.value || '50', 10);
  try {
    const res = await fetch(`${getServerUrl()}/api/admin/users`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ username, password, link_url: linkUrl, expires_at: expiresAt, permissions, hourly_view_limit: hourlyViewLimit }) });
    const data = await res.json();
    if (res.ok) {
      showMsg('adm-client-msg', `Cliente "${username}" creado.`, 'success');
      document.getElementById('adm-client-name').value = '';
      document.getElementById('adm-client-pass').value = '';
      document.getElementById('adm-client-link').value = '';
      document.getElementById('adm-client-expires').value = '';
      loadClientes();
    } else { showMsg('adm-client-msg', `Error: ${data.error || 'Error'}`, 'error'); }
  } catch { showMsg('adm-client-msg', 'Error de conexión.', 'error'); }
}

async function assignBotToClient(botId, username) {
  try {
    const res = await fetch(`${getServerUrl()}/api/admin/bots/assign`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ bot_id: botId, username }) });
    if (!res.ok) { const d = await res.json(); alert(`Error: ${d.error}`); return; }
    loadClientes();
  } catch { alert('Error de conexión.'); }
}

async function unassignBotFromClient(botId, username) {
  try {
    const res = await fetch(`${getServerUrl()}/api/admin/bots/unassign`, { method: 'DELETE', headers: getAuthHeaders(), body: JSON.stringify({ bot_id: botId, username }) });
    if (!res.ok) { const d = await res.json(); alert(`Error: ${d.error}`); return; }
    loadClientes();
  } catch { alert('Error de conexión.'); }
}

async function saveClientEdit(userId) {
  const card = document.querySelector(`.cliente-card[data-user-id="${userId}"]`);
  if (!card) return;
  const linkUrl = card.querySelector('.edit-link')?.value?.trim() || null;
  const expiresDays = parseInt(card.querySelector('.edit-expires')?.value || '0', 10);
  const expiresAt = expiresDays > 0 ? Math.floor(Date.now() / 1000) + expiresDays * 86400 : null;
  const isActive = card.querySelector('.edit-active')?.checked ? 1 : 0;
  const permChecks = card.querySelectorAll('.edit-perm:checked');
  const permissions = Array.from(permChecks).map(c => c.value);
  const hourlyViewLimit = parseInt(card.querySelector('.edit-hourly-limit')?.value || '50', 10);
  try {
    await fetch(`${getServerUrl()}/api/admin/users/${userId}`, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ link_url: linkUrl, expires_at: expiresAt, is_active: isActive, permissions, hourly_view_limit: hourlyViewLimit }) });
    loadClientes();
  } catch { alert('Error al guardar.'); }
}

async function deleteClient(userId, username) {
  if (!confirm(`Eliminar cliente "${username}"?`)) return;
  try {
    const res = await fetch(`${getServerUrl()}/api/admin/users/${userId}`, { method: 'DELETE', headers: getAuthHeaders() });
    if (!res.ok) { const d = await res.json(); alert(`Error: ${d.error}`); return; }
    loadClientes();
  } catch { alert('Error de conexión.'); }
}

async function loadClientes() {
  const container = document.getElementById('adm-client-list');
  if (!container) return;
  try {
    const [usersRes, botsRes] = await Promise.all([
      fetch(`${getServerUrl()}/api/admin/users/with-bots`, { headers: getAuthHeaders() }),
      fetch(`${getServerUrl()}/api/admin/bots`, { headers: getAuthHeaders() }),
    ]);
    const usersData = await usersRes.json();
    const botsData = await botsRes.json();
    if (!usersData.success) { container.innerHTML = '<p style="opacity:0.6;font-style:italic">Error al cargar.</p>'; return; }
    const allBots = (botsData.bots || []).filter(b => b.is_active);
    const now = Math.floor(Date.now() / 1000);
    const users = (usersData.users || []).filter(u => u.role === 'client');
    if (users.length === 0) { container.innerHTML = '<p style="opacity:0.6;font-style:italic">No hay clientes todavía.</p>'; return; }

    container.innerHTML = users.map(u => {
      const fecha = new Date(u.created_at * 1000).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
      const vence = u.expires_at ? new Date(u.expires_at * 1000).toLocaleDateString('es-AR') : 'Sin vencimiento';
      const vencido = u.expires_at && u.expires_at < now;
      const assignedBotIds = new Set((u.bots || []).map(b => b.id));
      const availableBots = allBots.filter(b => !assignedBotIds.has(b.id));
      const expiresDays = u.expires_at ? Math.round((u.expires_at - now) / 86400) : 0;
      const euser = esc(u.username);
      const ebotTag = (botName) => esc(botName);
      const eLink = esc(u.link_url || '');
      let userPerms = [];
      try { userPerms = JSON.parse(u.permissions || '["chat","simulator","vods"]'); } catch { userPerms = ['chat', 'simulator', 'vods']; }
      const hourlyLimit = u.hourly_view_limit ?? 50;
      const hasChat = userPerms.includes('chat');
      const hasSim = userPerms.includes('simulator');
      const hasVods = userPerms.includes('vods');

      return `<div class="cliente-card ${vencido ? 'cliente-vencido' : ''}" data-user-id="${u.id}">
        <div class="cliente-header">
          <div><strong>${euser}</strong><span class="cliente-meta"> Creado: ${fecha}</span></div>
          <div style="display:flex;gap:6px;align-items:center">
            <span class="cliente-badge ${u.is_active ? 'badge-active' : 'badge-inactive'}">${u.is_active ? 'Activo' : 'Inactivo'}</span>
            <span class="cliente-badge ${vencido ? 'badge-vencido' : 'badge-vigente'}">${vencido ? 'Vencido' : 'Vigente'}</span>
          </div>
        </div>
        <div class="cliente-bots">
          <span class="cliente-bots-label">Bots:</span>
          ${(u.bots || []).length === 0 ? '<span class="cliente-no-bots">Sin bots</span>' :
            (u.bots || []).map(b => `<span class="cliente-bot-tag">${ebotTag(b.bot_name)} <button class="btn-unassign" data-bot-id="${b.id}" data-username="${euser}" title="Quitar bot">X</button></span>`).join('')}
        </div>
        ${availableBots.length > 0 ? `<div class="cliente-add-bot"><div class="bot-checkbox-group" data-username="${euser}">${availableBots.map(b => `<label class="bot-check-label"><input type="checkbox" class="bot-check" value="${b.id}"> ${ebotTag(b.bot_name)}</label>`).join('')}</div><button class="btn btn-primary btn-small btn-assign-selected" data-username="${euser}">Asignar seleccionados</button></div>` : ''}
        <div class="cliente-edit">
          <div class="cliente-edit-grid">
            <div class="field"><label>Link</label><input class="edit-link" type="url" value="${eLink}" placeholder="https://..." /></div>
            <div class="field"><label>Vence en (dias)</label><input class="edit-expires" type="number" min="0" value="${expiresDays}" /></div>
            <div class="field" style="flex-direction:row;align-items:center;gap:8px"><label>Activo</label><input class="edit-active" type="checkbox" ${u.is_active ? 'checked' : ''} /></div>
          </div>
          <div class="cliente-edit-grid" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border,#2a2d35)">
            <div class="field"><label>Permisos</label>
              <div style="display:flex;gap:10px;flex-wrap:wrap">
                <label><input class="edit-perm" type="checkbox" value="chat" ${hasChat ? 'checked' : ''} /> Chat</label>
                <label><input class="edit-perm" type="checkbox" value="simulator" ${hasSim ? 'checked' : ''} /> Simulador</label>
                <label><input class="edit-perm" type="checkbox" value="vods" ${hasVods ? 'checked' : ''} /> VODs</label>
              </div>
            </div>
            <div class="field"><label>Vistas/hora</label><input class="edit-hourly-limit" type="number" min="0" value="${hourlyLimit}" style="width:80px" /></div>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <button class="btn btn-primary btn-small btn-save-client" data-user-id="${u.id}">Guardar</button>
            <button class="btn btn-danger btn-small btn-delete-client" data-user-id="${u.id}" data-username="${euser}">Eliminar</button>
          </div>
        </div>
      </div>`;
    }).join('');

    container.querySelectorAll('.btn-unassign').forEach(btn => {
      btn.addEventListener('click', () => unassignBotFromClient(parseInt(btn.dataset.botId), btn.dataset.username));
    });
    container.querySelectorAll('.btn-assign-selected').forEach(btn => {
      btn.addEventListener('click', () => {
        const checks = btn.parentElement.querySelectorAll('.bot-check:checked');
        const selected = Array.from(checks).map(c => parseInt(c.value)).filter(v => v);
        if (selected.length === 0) return;
        Promise.all(selected.map(botId => assignBotToClient(botId, btn.dataset.username))).then(() => loadClientes());
      });
    });
    container.querySelectorAll('.btn-save-client').forEach(btn => {
      btn.addEventListener('click', () => saveClientEdit(parseInt(btn.dataset.userId)));
    });
    container.querySelectorAll('.btn-delete-client').forEach(btn => {
      btn.addEventListener('click', () => deleteClient(parseInt(btn.dataset.userId), btn.dataset.username));
    });
  } catch { container.innerHTML = '<p style="opacity:0.6;font-style:italic">Error al cargar clientes.</p>'; }
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await initCommon())) return;
  loadClientes();
  document.getElementById('adm-create-client-btn')?.addEventListener('click', handleCreateClient);
});
