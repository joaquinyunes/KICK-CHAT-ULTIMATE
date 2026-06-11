import { onStatusChange, ping } from './bridge-client.js';

function isAdmin() { return sessionStorage.getItem('scb_role') === 'admin'; }

function getServerUrl() { return (sessionStorage.getItem('scb_server_url') || '').replace(/\/+$/, ''); }

function getAuthHeaders() {
  const token = sessionStorage.getItem('scb_jwt');
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
      if (btn.dataset.tab === 'clientes') loadClientes();
    });
  });
}

// ─── Bots ────────────────────────────────────────────

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

async function loadBots() {
  const container = document.getElementById('adm-bot-list');
  if (!container) return;
  try {
    const res = await fetch(`${getServerUrl()}/admin/bots`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.success) { container.innerHTML = '<p style="opacity:0.6;font-style:italic">Error al cargar.</p>'; return; }
    const bots = data.bots || [];
    if (bots.length === 0) { container.innerHTML = '<p style="opacity:0.6;font-style:italic">No hay bots todavía.</p>'; return; }
    container.innerHTML = `<div class="table-header"><span>Bot</span><span>OAuth</span><span>Acción</span></div>` +
      bots.map(b => {
        const connected = b.oauth_refresh_token ? '✅ Conectado' : '⛔ No conectado';
        return `<div class="table-row">
          <span><strong>${b.bot_name}</strong></span>
          <span>${connected}</span>
          <span>${b.oauth_refresh_token ? '' : `<a href="${getServerUrl()}/auth/kick/login?botId=${b.id}" class="btn btn-small btn-primary">Conectar con Kick</a>`}</span>
        </div>`;
      }).join('');
  } catch { container.innerHTML = '<p style="opacity:0.6;font-style:italic">Error al cargar bots.</p>'; }
}

// ─── Clientes ─────────────────────────────────────────

async function handleCreateClient() {
  const username = document.getElementById('adm-client-name')?.value?.trim();
  const password = document.getElementById('adm-client-pass')?.value?.trim();
  if (!username || !password) { showMsg('adm-client-msg', 'Completa todos los campos.', 'error'); return; }
  if (password.length < 6) { showMsg('adm-client-msg', 'Mínimo 6 caracteres.', 'error'); return; }
  try {
    const res = await fetch(`${getServerUrl()}/admin/users`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (res.ok) {
      showMsg('adm-client-msg', `✅ Cliente "${username}" creado.`, 'success');
      document.getElementById('adm-client-name').value = '';
      document.getElementById('adm-client-pass').value = '';
      loadClientes();
    } else { showMsg('adm-client-msg', `❌ ${data.error || 'Error'}`, 'error'); }
  } catch { showMsg('adm-client-msg', '❌ Error de conexión.', 'error'); }
}

async function assignBotToClient(botId, username) {
  try {
    const res = await fetch(`${getServerUrl()}/admin/assign`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ bot_id: botId, username }) });
    const data = await res.json();
    if (res.ok) { loadClientes(); } else { alert(`Error: ${data.error}`); }
  } catch { alert('Error de conexión.'); }
}

async function unassignBotFromClient(botId, username) {
  try {
    const res = await fetch(`${getServerUrl()}/admin/unassign`, { method: 'DELETE', headers: getAuthHeaders(), body: JSON.stringify({ bot_id: botId, username }) });
    const data = await res.json();
    if (res.ok) { loadClientes(); } else { alert(`Error: ${data.error}`); }
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

    const users = (usersData.users || []).filter(u => u.role === 'client');
    if (users.length === 0) { container.innerHTML = '<p style="opacity:0.6;font-style:italic">No hay clientes todavía.</p>'; return; }

    container.innerHTML = users.map(u => {
      const fecha = new Date(u.created_at * 1000).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
      const assignedBotIds = new Set((u.bots || []).map(b => b.id));
      const availableBots = allBots.filter(b => !assignedBotIds.has(b.id));
      return `<div class="cliente-card">
        <div class="cliente-header">
          <strong>${u.username}</strong>
          <span class="cliente-meta">Creado: ${fecha} · ${u.is_active ? 'Activo' : 'Inactivo'}</span>
        </div>
        <div class="cliente-bots">
          <span class="cliente-bots-label">Bots asignados:</span>
          ${(u.bots || []).length === 0 ? '<span class="cliente-no-bots">Sin bots</span>' :
            (u.bots || []).map(b => `<span class="cliente-bot-tag">${b.bot_name} <button class="btn-unassign" data-bot-id="${b.id}" data-username="${u.username}" title="Quitar bot">✕</button></span>`).join('')}
        </div>
        ${availableBots.length > 0 ? `
          <div class="cliente-add-bot">
            <select class="bot-select" data-username="${u.username}">
              <option value="">+ Asignar bot...</option>
              ${availableBots.map(b => `<option value="${b.id}">${b.bot_name}</option>`).join('')}
            </select>
          </div>
        ` : ''}
      </div>`;
    }).join('');

    container.querySelectorAll('.btn-unassign').forEach(btn => {
      btn.addEventListener('click', () => unassignBotFromClient(parseInt(btn.dataset.botId), btn.dataset.username));
    });
    container.querySelectorAll('.bot-select').forEach(sel => {
      sel.addEventListener('change', () => {
        if (sel.value) assignBotToClient(parseInt(sel.value), sel.dataset.username);
        sel.value = '';
      });
    });
  } catch { container.innerHTML = '<p style="opacity:0.6;font-style:italic">Error al cargar clientes.</p>'; }
}

// ─── OAuth callback ──────────────────────────────────

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

// ─── Logout ──────────────────────────────────────────

function handleLogout() {
  sessionStorage.clear();
  window.location.href = '/';
}

// ─── Init ────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  if (!isAdmin()) { window.location.href = '/chat.html'; return; }

  history.replaceState({}, '', '/admin');

  onStatusChange(updateStatusUI);
  ping();
  setInterval(() => ping(), 15000);

  initTabs();

  document.getElementById('adm-add-bot-btn')?.addEventListener('click', handleAddBot);
  document.getElementById('adm-create-client-btn')?.addEventListener('click', handleCreateClient);
  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);

  checkOAuthResult();
  loadBots();
});
