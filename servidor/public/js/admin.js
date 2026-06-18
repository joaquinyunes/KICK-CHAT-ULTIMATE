import { onStatusChange, ping } from './bridge-client.js';

let editingUserId = null;

function ss(key) { return sessionStorage.getItem(key) || localStorage.getItem(key) || ''; }
function isAdmin() { return (sessionStorage.getItem('scb_role') || localStorage.getItem('scb_role')) === 'admin'; }
function getServerUrl() { return ss('scb_server_url').replace(/\/+$/, ''); }
function getAuthHeaders() {
  const token = ss('scb_jwt');
  return { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' };
}

function updateStatusUI(status) {
  const badge = document.getElementById('status-badge');
  const label = document.getElementById('status-label');
  if (!badge || !label) return;
  badge.className = `status-dot status-${status}`;
  label.textContent = status === 'connected' ? 'Conectado' : status === 'checking' ? 'Verificando…' : 'Desconectado';
}

function showMsg(elId, msg, type) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg; el.dataset.type = type; el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 4000);
}

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.getElementById(`panel-${btn.dataset.tab}`);
      if (panel) panel.classList.add('active');
      if (btn.dataset.tab === 'dashboard') loadDashboard();
      if (btn.dataset.tab === 'clientes') loadClientes();
    });
  });
}

function switchTab(name) {
  document.querySelector(`[data-tab="${name}"]`)?.click();
}

// ════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════

async function loadDashboard() {
  try {
    const res = await fetch(`${getServerUrl()}/admin/dashboard`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.success) return;
    const s = data.stats;
    setText('dash-total-bots', s.total_bots);
    setText('dash-oauth-bots', s.oauth_bots);
    setText('dash-total-clients', `${s.total_clients} (${s.active_clients} act)`);
    setText('dash-msgs-sent', s.messages_sent);
    setText('dash-uptime', fmtUptime(s.uptime_seconds));
    setText('dash-expired', s.expired_clients);

    const log = document.getElementById('dash-recent-log');
    if (!log) return;
    const msgs = data.recent_messages || [];
    if (msgs.length === 0) {
      log.innerHTML = '<p style="opacity:0.6;font-style:italic">Sin actividad todavía.</p>';
      return;
    }
    log.innerHTML = `<div class="table-header" style="grid-template-columns:1fr 1fr 1fr 1fr"><span>Hora</span><span>Bot</span><span>Canal</span><span>Estado</span></div>` +
      msgs.map(m => {
        const time = new Date(m.sent_at * 1000).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        const status = m.success ? '✅' : `❌ ${m.error_reason || ''}`;
        return `<div class="table-row" style="grid-template-columns:1fr 1fr 1fr 1fr"><span>${time}</span><span>${m.bot_name || '—'}</span><span>${m.channel || '—'}</span><span>${status}</span></div>`;
      }).join('');
  } catch {}
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? '—';
}

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}

// ════════════════════════════════════════════════════════════════
// BOTS
// ════════════════════════════════════════════════════════════════

async function handleAddBot() {
  const botName = document.getElementById('adm-bot-name')?.value?.trim();
  const bearer = document.getElementById('adm-bot-bearer')?.value?.trim();
  if (!botName || !bearer) { showMsg('adm-bot-msg', 'Completa todos los campos.', 'error'); return; }
  try {
    const res = await fetch(`${getServerUrl()}/admin/bots`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ bot_name: botName, bearer }) });
    const data = await res.json();
    if (res.ok) {
      showMsg('adm-bot-msg', `✅ Bot "${botName}" agregado.`, 'success');
      document.getElementById('adm-bot-name').value = '';
      document.getElementById('adm-bot-bearer').value = '';
      loadBots();
    } else { showMsg('adm-bot-msg', `❌ ${data.error || 'Error'}`, 'error'); }
  } catch { showMsg('adm-bot-msg', '❌ Error de conexión.', 'error'); }
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
      const res = await fetch(`${getServerUrl()}/admin/bots`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ bot_name: botName, bearer }) });
      if (res.ok) added++;
      else { const d = await res.json(); errors.push(`${botName}: ${d.error || 'error'}`); }
    } catch { errors.push(`${botName}: error de conexión`); }
  }
  const msg = errors.length === 0 ? `✅ ${added} bots agregados.` : `✅ ${added} agregados, ⚠️ ${errors.length} errores: ${errors.slice(0, 3).join(', ')}`;
  showMsg('adm-bulk-msg', msg, errors.length === 0 ? 'success' : 'error');
  if (added > 0) { textarea.value = ''; loadBots(); }
}

async function loadBots() {
  const container = document.getElementById('adm-bot-list');
  if (!container) return;
  try {
    const res = await fetch(`${getServerUrl()}/admin/bots`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.success) { container.innerHTML = '<p style="opacity:0.6;font-style:italic">Error al cargar.</p>'; return; }
    const bots = data.bots || [];
    let html = `<div class="table-header"><span>Bot</span><span>OAuth</span></div>`;
    if (bots.length === 0) {
      html = '<p style="opacity:0.6;font-style:italic">No hay bots todavía. Conectá una cuenta de Kick.</p>';
    } else {
      html += bots.map(b => {
        const connected = b.oauth_refresh_token ? '✅ Conectado' : '⛔ No conectado';
        return `<div class="table-row"><span><strong>${b.bot_name}</strong></span><span>${connected}</span></div>`;
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
  if (btn) { btn.textContent = '✓ Copiado'; setTimeout(() => { btn.textContent = 'Copiar'; }, 2000); }
}

async function startKickOAuthWithName() {
  const nameInput = document.getElementById('adm-bot-name');
  const name = nameInput?.value?.trim();
  if (!name) { alert('Primero escribí un nombre para el bot.'); nameInput?.focus(); return; }
  try {
    const res = await fetch(`${getServerUrl()}/auth/kick/start`, {
      method: 'POST', headers: getAuthHeaders(),
      body: JSON.stringify({ bot_name: name }),
    });
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

// ════════════════════════════════════════════════════════════════
// CLIENTES
// ════════════════════════════════════════════════════════════════

async function handleCreateClient() {
  const username = document.getElementById('adm-client-name')?.value?.trim();
  const password = document.getElementById('adm-client-pass')?.value?.trim();
  const linkUrl = document.getElementById('adm-client-link')?.value?.trim() || null;
  const expiresDays = parseInt(document.getElementById('adm-client-expires')?.value || '0', 10);
  if (!username || !password) { showMsg('adm-client-msg', 'Completa nombre y contraseña.', 'error'); return; }
  if (password.length < 6) { showMsg('adm-client-msg', 'Mínimo 6 caracteres.', 'error'); return; }
  const expiresAt = expiresDays > 0 ? Math.floor(Date.now() / 1000) + expiresDays * 86400 : null;
  try {
    const res = await fetch(`${getServerUrl()}/admin/users`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ username, password, link_url: linkUrl, expires_at: expiresAt }) });
    const data = await res.json();
    if (res.ok) {
      showMsg('adm-client-msg', `✅ Cliente "${username}" creado.`, 'success');
      document.getElementById('adm-client-name').value = '';
      document.getElementById('adm-client-pass').value = '';
      document.getElementById('adm-client-link').value = '';
      document.getElementById('adm-client-expires').value = '';
      loadClientes();
    } else { showMsg('adm-client-msg', `❌ ${data.error || 'Error'}`, 'error'); }
  } catch { showMsg('adm-client-msg', '❌ Error de conexión.', 'error'); }
}

async function assignBotToClient(botId, username) {
  try {
    const res = await fetch(`${getServerUrl()}/admin/assign`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ bot_id: botId, username }) });
    if (!res.ok) { const d = await res.json(); alert(`Error: ${d.error}`); return; }
    loadClientes();
  } catch { alert('Error de conexión.'); }
}

async function unassignBotFromClient(botId, username) {
  try {
    const res = await fetch(`${getServerUrl()}/admin/unassign`, { method: 'DELETE', headers: getAuthHeaders(), body: JSON.stringify({ bot_id: botId, username }) });
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
  try {
    await fetch(`${getServerUrl()}/admin/users/${userId}`, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ link_url: linkUrl, expires_at: expiresAt, is_active: isActive }) });
    loadClientes();
  } catch { alert('Error al guardar.'); }
}

async function deleteClient(userId, username) {
  if (!confirm(`¿Eliminar cliente "${username}"?`)) return;
  try {
    const res = await fetch(`${getServerUrl()}/admin/users/${userId}`, { method: 'DELETE', headers: getAuthHeaders() });
    if (!res.ok) { const d = await res.json(); alert(`Error: ${d.error}`); return; }
    loadClientes();
  } catch { alert('Error de conexión.'); }
}

async function loadClientes() {
  const container = document.getElementById('adm-client-list');
  if (!container) return;
  try {
    const [usersRes, botsRes] = await Promise.all([
      fetch(`${getServerUrl()}/admin/users-with-bots`, { headers: getAuthHeaders() }),
      fetch(`${getServerUrl()}/admin/bots`, { headers: getAuthHeaders() }),
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

      return `<div class="cliente-card ${vencido ? 'cliente-vencido' : ''}" data-user-id="${u.id}">
        <div class="cliente-header">
          <div>
            <strong>${u.username}</strong>
            <span class="cliente-meta">· Creado: ${fecha}</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <span class="cliente-badge ${u.is_active ? 'badge-active' : 'badge-inactive'}">${u.is_active ? 'Activo' : 'Inactivo'}</span>
            <span class="cliente-badge ${vencido ? 'badge-vencido' : 'badge-vigente'}">${vencido ? 'Vencido' : 'Vigente'}</span>
          </div>
        </div>

        <div class="cliente-bots">
          <span class="cliente-bots-label">Bots:</span>
          ${(u.bots || []).length === 0 ? '<span class="cliente-no-bots">Sin bots</span>' :
            (u.bots || []).map(b => `<span class="cliente-bot-tag">${b.bot_name} <button class="btn-unassign" data-bot-id="${b.id}" data-username="${u.username}" title="Quitar bot">✕</button></span>`).join('')}
        </div>

        ${availableBots.length > 0 ? `<div class="cliente-add-bot"><div class="bot-checkbox-group" data-username="${u.username}">${availableBots.map(b => `<label class="bot-check-label"><input type="checkbox" class="bot-check" value="${b.id}"> ${b.bot_name}</label>`).join('')}</div><button class="btn btn-primary btn-small btn-assign-selected" data-username="${u.username}">Asignar seleccionados</button></div>` : ''}

        <div class="cliente-edit">
          <div class="cliente-edit-grid">
            <div class="field"><label>Link</label><input class="edit-link" type="url" value="${u.link_url || ''}" placeholder="https://..." /></div>
            <div class="field"><label>Vence en (días)</label><input class="edit-expires" type="number" min="0" value="${expiresDays}" /></div>
            <div class="field" style="flex-direction:row;align-items:center;gap:8px"><label>Activo</label><input class="edit-active" type="checkbox" ${u.is_active ? 'checked' : ''} /></div>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <button class="btn btn-primary btn-small btn-save-client" data-user-id="${u.id}">Guardar</button>
            <button class="btn btn-danger btn-small btn-delete-client" data-user-id="${u.id}" data-username="${u.username}">Eliminar</button>
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

// ════════════════════════════════════════════════════════════════
// OAUTH CALLBACK
// ════════════════════════════════════════════════════════════════

function checkOAuthResult() {
  const params = new URLSearchParams(window.location.search);
  const oauth = params.get('oauth');
  if (oauth === 'success') {
    showMsg('adm-bot-msg', `✅ Bot conectado a Kick correctamente.`, 'success');
    window.history.replaceState({}, '', '/admin');
    loadBots();
  } else if (oauth === 'error') {
    showMsg('adm-bot-msg', `❌ Error OAuth: ${params.get('reason') || 'desconocido'}`, 'error');
    window.history.replaceState({}, '', '/admin');
  }
}

// ════════════════════════════════════════════════════════════════
// LOGOUT
// ════════════════════════════════════════════════════════════════

function handleLogout() {
  sessionStorage.clear();
  localStorage.removeItem('scb_jwt');
  localStorage.removeItem('scb_role');
  localStorage.removeItem('scb_server_url');
  window.location.href = '/';
}

// ════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════

window.addEventListener('DOMContentLoaded', () => {
  // Migrate session → local for cross-tab support
  ['scb_jwt','scb_role','scb_server_url'].forEach(k => {
    const s = sessionStorage.getItem(k);
    if (s && !localStorage.getItem(k)) localStorage.setItem(k, s);
  });
  if (!isAdmin()) { window.location.href = '/chat.html'; return; }

  onStatusChange(updateStatusUI);
  ping();
  setInterval(() => ping(), 15000);

  initTabs();

  // Botones
  document.getElementById('adm-add-bot-btn')?.addEventListener('click', handleAddBot);
  document.getElementById('adm-bulk-add-btn')?.addEventListener('click', handleBulkAddBots);
  document.getElementById('adm-oauth-connect-btn')?.addEventListener('click', startKickOAuth);
  document.getElementById('adm-oauth-name-btn')?.addEventListener('click', startKickOAuthWithName);
  document.getElementById('adm-oauth-copy')?.addEventListener('click', copyOAuthUrl);
  document.getElementById('adm-create-client-btn')?.addEventListener('click', handleCreateClient);
  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);

  // Dashboard quick actions
  document.getElementById('dash-oauth-btn')?.addEventListener('click', () => { switchTab('bots'); setTimeout(startKickOAuth, 100); });
  document.getElementById('dash-create-client-btn')?.addEventListener('click', () => switchTab('clientes'));
  document.getElementById('dash-agregar-bot-btn')?.addEventListener('click', () => switchTab('bots'));

  checkOAuthResult();
  loadDashboard();
  loadBots();
});
