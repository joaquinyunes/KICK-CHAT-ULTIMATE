import { onStatusChange, ping } from './bridge-client.js';

export function ss(key) { return sessionStorage.getItem(key) || localStorage.getItem(key) || ''; }

export function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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
  el.style.animation = 'none';
  el.offsetHeight;
  el.style.animation = 'toast-in 0.25s ease';
  setTimeout(() => {
    el.style.animation = 'toast-out 0.25s ease forwards';
    setTimeout(() => { el.hidden = true; el.style.animation = ''; }, 250);
  }, 3500);
}

export async function handleLogout() {
  try {
    await fetch('/auth/logout', { method: 'POST' });
  } catch {}
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

export async function initCommon() {
  const token = ss('scb_jwt');
  const headers = token ? { 'Authorization': 'Bearer ' + token } : {};

  try {
    const res = await fetch('/auth/me', { headers });
    if (!res.ok) {
      window.location.href = '/';
      return false;
    }
    const data = await res.json();
    if (data.user.role !== 'admin') {
      window.location.href = '/';
      return false;
    }
    // Sincronizar token existente a cookie httpOnly para futuras navegaciones
    if (token) {
      fetch('/auth/sync-cookie', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } }).catch(() => {});
    }
  } catch {
    window.location.href = '/';
    return false;
  }

  onStatusChange(updateStatusUI);
  ping();
  setInterval(() => ping(), 15000);
  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
  return true;
}
