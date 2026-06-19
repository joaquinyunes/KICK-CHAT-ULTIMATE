import { onStatusChange, ping } from './bridge-client.js';

export function ss(key) { return sessionStorage.getItem(key) || localStorage.getItem(key) || ''; }

export function isAdmin() { return (sessionStorage.getItem('scb_role') || localStorage.getItem('scb_role')) === 'admin'; }

export function getServerUrl() { return (ss('scb_server_url') || window.location.origin).replace(/\/+$/, ''); }

export function getAuthHeaders() {
  const token = ss('scb_jwt');
  return { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' };
}

export function updateStatusUI(status) {
  const badge = document.getElementById('status-badge');
  const label = document.getElementById('status-label');
  if (!badge || !label) return;
  badge.className = 'status-dot status-' + status;
  label.textContent = status === 'connected' ? 'Conectado' : status === 'checking' ? 'Verificando…' : 'Desconectado';
}

export function showMsg(elId, msg, type) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg; el.dataset.type = type; el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 4000);
}

export function handleLogout() {
  sessionStorage.clear();
  localStorage.removeItem('scb_jwt');
  localStorage.removeItem('scb_role');
  localStorage.removeItem('scb_server_url');
  window.location.href = '/';
}

export function checkOAuthResult(msgElId) {
  const params = new URLSearchParams(window.location.search);
  const oauth = params.get('oauth');
  if (oauth === 'success') {
    showMsg(msgElId, 'Bot conectado a Kick correctamente.', 'success');
    window.history.replaceState({}, '', window.location.pathname);
    return true;
  } else if (oauth === 'error') {
    showMsg(msgElId, 'Error OAuth: ' + (params.get('reason') || 'desconocido'), 'error');
    window.history.replaceState({}, '', window.location.pathname);
    return true;
  }
  return false;
}

export function initCommon() {
  ['scb_jwt','scb_role','scb_server_url'].forEach(k => {
    const s = sessionStorage.getItem(k);
    if (s && !localStorage.getItem(k)) localStorage.setItem(k, s);
  });
  if (!isAdmin()) { window.location.href = '/chat.html'; return false; }
  onStatusChange(updateStatusUI);
  ping();
  setInterval(() => ping(), 15000);
  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
  return true;
}
