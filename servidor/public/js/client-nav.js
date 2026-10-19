// ============================================================================
// Módulo de navegación común para páginas de cliente (Chat / Simulador / Ajustes / VODs)
// Refactor separado por responsabilidad: cada función se auto-protege con try/catch
// para que un fallo aislado NO rompa el resto del menú.
// ============================================================================
import { onStatusChange, ping } from './bridge-client.js';

// ─── Config & helpers ────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: 'chat',      label: 'Chat',      ico: '💬', url: '/chat' },
  { id: 'tematicas', label: 'Temáticas', ico: '🎯', url: '/tematicas' },
  { id: 'glosario',  label: 'Glosario',  ico: '📚', url: '/glosario' },
  { id: 'video',     label: 'Video',     ico: '⏱️', url: '/video' },
  { id: 'kc',        label: 'Contexto',  ico: '🎥', url: '/kc' },
  { id: 'simulador', label: 'Simulador', ico: '🤖', url: '/simulador' },
  { id: 'kick20',    label: 'Cuentas Kick', ico: '🔗', url: '/admin/kick20', adminOnly: true },
  { id: 'ajustes',   label: 'Ajustes',    ico: '⚙️', url: '/ajustes' },
  { id: 'vods',      label: 'VODs',       ico: '🎬', url: '/vods' },
];

function ss(key) { return sessionStorage.getItem(key) || localStorage.getItem(key) || ''; }

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const el = (id) => (typeof document !== 'undefined' && document.getElementById(id)) || null;

// ─── Tema "dashboard" (body.kd) ──────────────────────────────────────────────
// Las páginas con <body class="kd"> dibujan la barra superior nueva. Las que no
// la tienen (Simulador, Video) siguen con el menú de siempre, sin cambios.
const isKd = () => typeof document !== 'undefined' && !!document.body && document.body.classList.contains('kd');
const KD_ICON = {
  logo:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/></svg>',
  chev:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  sun:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>',
};

function kdEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function kdApplyTheme(light) {
  document.documentElement.classList.toggle('kd-light', !!light);
  const b = el('kd-theme');
  if (b) { b.innerHTML = light ? KD_ICON.moon : KD_ICON.sun; b.title = light ? 'Tema oscuro' : 'Tema claro'; }
}

// Barra nueva: 3 pestañas (+ Admin). Las páginas viejas siguen existiendo y
// marcan como activa la pestaña que las agrupa.
const KD_TABS = [
  { id: 'kc',         label: 'En vivo',    url: '/kc',              pages: ['kc'] },
  { id: 'chat',       label: 'Chat',       url: '/chat',            pages: ['chat', 'tematicas'] },
  { id: 'configurar', label: 'Configurar', url: '/configurar',      pages: ['configurar', 'ajustes', 'vods', 'simulador', 'video', 'kick20'] },
  { id: 'admin',      label: 'Admin',      url: '/admin/dashboard', pages: [], adminOnly: true },
];

function renderKdTop(activeId) {
  const h = el('chat-header');
  if (!h) return;
  const isAdmin = ss('scb_role') === 'admin';
  const links = KD_TABS
    .filter((t) => !t.adminOnly || isAdmin)
    .map((t) => {
      const on = t.pages.includes(activeId);
      return `<a href="${t.url}" class="kd-link${on ? ' active' : ''}" data-nav="${t.id}"${on ? ' aria-current="page"' : ''}>${kdEsc(t.label)}</a>`;
    }).join('');
  h.className = 'kd-top';
  h.innerHTML = `
    <div class="kd-top-in">
      <a class="kd-logo" href="/chat"><span class="kd-logo-mark">${KD_ICON.logo}</span><span>Stream<b>Chat</b></span></a>
      <nav class="kd-links" aria-label="Secciones">${links}</nav>
      <div class="kd-top-r">
        <span class="kd-sys"><span id="status-badge" class="status-dot status-checking"></span><span id="status-label" class="kd-sys-t">Verificando…</span></span>
        <button id="kd-theme" class="kd-iconbtn" type="button" aria-label="Cambiar tema"></button>
        <div class="kd-user">
          <button id="kd-user-btn" class="kd-user-btn" type="button" aria-haspopup="true" aria-expanded="false">
            <span id="kd-avatar" class="kd-avatar">·</span>${KD_ICON.chev}
          </button>
          <div id="kd-menu" class="kd-menu" hidden>
            <div class="kd-menu-who"><b id="kd-who">Mi cuenta</b><span id="kd-role"></span></div>
            <a href="/ajustes">Ajustes</a>
            <button id="kd-logout" type="button">Cerrar sesión</button>
          </div>
        </div>
      </div>
    </div>`;

  let light = false;
  safe(() => { light = localStorage.getItem('kd_theme') === 'light'; });
  kdApplyTheme(light);
  el('kd-theme')?.addEventListener('click', () => {
    const next = !document.documentElement.classList.contains('kd-light');
    safe(() => localStorage.setItem('kd_theme', next ? 'light' : 'dark'));
    kdApplyTheme(next);
  });

  const btn = el('kd-user-btn'); const menu = el('kd-menu');
  const close = () => { if (menu) menu.hidden = true; btn?.setAttribute('aria-expanded', 'false'); };
  btn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!menu) return;
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', (e) => { if (menu && !menu.hidden && !menu.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  el('kd-logout')?.addEventListener('click', handleLogout);

  // Usuario (inicial del avatar + nombre). Si falla, queda el genérico.
  const token = ss('scb_jwt');
  fetch('/auth/me', { headers: token ? { 'Authorization': 'Bearer ' + token } : {} })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const u = d && d.user; if (!u) return;
      const av = el('kd-avatar'); if (av) av.textContent = (u.username || '?').trim().charAt(0) || '?';
      const who = el('kd-who'); if (who) who.textContent = u.username || 'Mi cuenta';
      const role = el('kd-role'); if (role) role.textContent = u.role === 'admin' ? 'Administrador' : 'Cliente';
    })
    .catch(() => {});
}

// ─── Estado de conexión (badge) ─────────────────────────────────────────────
export function updateStatusUI(status) {
  safe(() => {
    const badge = el('status-badge');
    const label = el('status-label');
    if (!badge || !label) return;
    badge.className = 'status-dot status-' + status;
    label.textContent = isKd()
      ? (status === 'connected' ? 'Sistemas en línea' : status === 'checking' ? 'Verificando…' : 'Sin conexión')
      : (status === 'connected' ? 'Conectado' : status === 'checking' ? 'Verificando…' : 'Desconectado');
  });
}

// ─── Auth ────────────────────────────────────────────────────────────────────
export async function handleLogout() {
  try { await fetch('/auth/logout', { method: 'POST' }); } catch {}
  safe(() => { sessionStorage.clear(); localStorage.removeItem('scb_jwt'); localStorage.removeItem('scb_role'); localStorage.removeItem('scb_server_url'); });
  safe(() => { window.location.href = '/login'; });
}

// ─── Render del menú ─────────────────────────────────────────────────────────
export function renderNav(activeId) {
  if (isKd()) return; // en el tema nuevo los links viven en la barra superior
  safe(() => {
    const container = el('client-nav');
    if (!container) return;
    const isAdmin = ss('scb_role') === 'admin';
    container.innerHTML = NAV_ITEMS.filter(item => !item.adminOnly || isAdmin).map(item => {
      const active = item.id === activeId ? ' active' : '';
      return `<a href="${item.url}" class="client-nav-item${active}" data-nav="${item.id}">
        <span class="nav-ico">${item.ico}</span><span>${item.label}</span>
      </a>`;
    }).join('');
  });
}

// ─── Header superior ─────────────────────────────────────────────────────────
export function renderAuthHeader(activeId) {
  if (isKd()) { safe(() => renderKdTop(activeId)); return; }
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
    if (!res.ok) { safe(() => { window.location.href = '/login'; }); return false; }
    const data = await res.json();
    if (data.user.role !== 'admin' && data.user.role !== 'client') { safe(() => { window.location.href = '/login'; }); return false; }
    if (token) { fetch('/auth/sync-cookie', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } }).catch(() => {}); }
    return true;
  } catch {
    safe(() => { window.location.href = '/login'; });
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
  if (clean === 'kick20') return 'kick20';
  if (clean === 'tematicas') return 'tematicas';
  if (clean === 'glosario') return 'glosario';
  if (clean === 'video') return 'video';
  if (clean === 'kc') return 'kc';
  return 'chat';
}

export { NAV_ITEMS };