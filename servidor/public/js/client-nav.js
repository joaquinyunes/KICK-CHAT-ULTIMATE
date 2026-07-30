// ============================================================================
// Módulo de navegación común para páginas de cliente (Chat / Simulador / Ajustes / VODs)
// Refactor separado por responsabilidad: cada función se auto-protege con try/catch
// para que un fallo aislado NO rompa el resto del menú.
// ============================================================================
import { onStatusChange, ping } from './bridge-client.js';

// ─── Config & helpers ────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: 'chat',      label: 'Chat',      ico: '💬', url: '/chat' },
  { id: 'simulador', label: 'Simulador', ico: '🤖', url: '/simulador' },
  { id: 'ajustes',   label: 'Ajustes',    ico: '⚙️', url: '/ajustes' },
  { id: 'vods',      label: 'VODs',       ico: '🎬', url: '/vods' },
];

function ss(key) { return sessionStorage.getItem(key) || localStorage.getItem(key) || ''; }

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const el = (id) => (typeof document !== 'undefined' && document.getElementById(id)) || null;

// ─── Estado de conexión (badge) ─────────────────────────────────────────────
export function updateStatusUI(status) {
  safe(() => {
    const badge = el('status-badge');
    const label = el('status-label');
    if (!badge || !label) return;
    badge.className = 'status-dot status-' + status;
    label.textContent = status === 'connected' ? 'Conectado' : status === 'checking' ? 'Verificando…' : 'Desconectado';
  });
}

// ─── Auth ────────────────────────────────────────────────────────────────────
export async function handleLogout() {
  try { await fetch('/auth/logout', { method: 'POST' }); } catch {}
  safe(() => { sessionStorage.clear(); localStorage.removeItem('scb_jwt'); localStorage.removeItem('scb_role'); localStorage.removeItem('scb_server_url'); });
  safe(() => { window.location.href = '/'; });
}

// ─── Render del menú ─────────────────────────────────────────────────────────
export function renderNav(activeId) {
  safe(() => {
    const container = el('client-nav');
    if (!container) return;
    container.innerHTML = NAV_ITEMS.map(item => {
      const active = item.id === activeId ? ' active' : '';
      return `<a href="${item.url}" class="client-nav-item${active}" data-nav="${item.id}">
        <span class="nav-ico">${item.ico}</span><span>${item.label}</span>
      </a>`;
    }).join('');
  });
}

// ─── Header superior ─────────────────────────────────────────────────────────
export function renderAuthHeader(activeId) {
  safe(() => {
    const h = el('chat-header');
    if (!h) return;
    h.innerHTML = `
      <span class="app-title">StreamChat Bridge</span>
      <div class="connection-status">
        <span id="status-badge" class="status-dot status-disconnected"></span>
        <span id="status-label">Desconectado</span>
        <button id="logout-btn" class="btn btn-ghost" style="margin-left:12px">Cerrar sesión</button>
      </div>`;
    safe(() => { el('logout-btn')?.addEventListener('click', handleLogout); });
  });
  // Si hay header pero no el contenedor de menú, aun así pintamos el nav en otro lugar
  renderIntoFallback(activeId);
}

function renderIntoFallback(activeId) {
  safe(() => {
    const anyNav = document.querySelector('[data-nav]');
    if (anyNav) return;
    const header = el('chat-header');
    if (header && !el('client-nav')) renderNav(activeId);
  });
}

// ─── Status loop ─────────────────────────────────────────────────────────────
export function startStatusLoop() {
  safe(() => onStatusChange(updateStatusUI));
  safe(() => pingOnce());
  const t = setInterval(() => safe(() => ping()), 15000);
  if (t && typeof t.unref === 'function') t.unref();
}

function pingOnce() { ping(); }

// ─── Auth gate ───────────────────────────────────────────────────────────────
export async function requireAuth() {
  const token = ss('scb_jwt');
  const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
  try {
    const res = await fetch('/auth/me', { headers });
    if (!res.ok) { safe(() => { window.location.href = '/'; }); return false; }
    const data = await res.json();
    if (data.user.role !== 'admin' && data.user.role !== 'client') { safe(() => { window.location.href = '/'; }); return false; }
    if (token) { fetch('/auth/sync-cookie', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } }).catch(() => {}); }
    return true;
  } catch {
    safe(() => { window.location.href = '/'; });
    return false;
  }
}

// ─── Página actual (resiliente a varios nombres de ruta) ────────────────────
export function currentPage() {
  const p = (typeof window !== 'undefined' ? window.location.pathname : '').split('/').pop() || '';
  const clean = p.replace('.html', '');
  if (clean === 'simulador' || clean === 'stream-simulator') return 'simulador';
  if (clean === 'ajustes') return 'ajustes';
  if (clean === 'vods') return 'vods';
  return 'chat';
}

export { NAV_ITEMS };