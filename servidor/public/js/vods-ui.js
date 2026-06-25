import { getServerUrl, getAuthHeaders, showMsg, esc } from './admin-common.js';
import { onStatusChange, ping } from './bridge-client.js';

function ss(key) { return sessionStorage.getItem(key) || localStorage.getItem(key) || ''; }

let viewerInterval = null;

async function initAuth() {
  const token = ss('scb_jwt');
  const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
  try {
    const res = await fetch('/auth/me', { headers });
    if (!res.ok) { window.location.href = '/'; return false; }
    const data = await res.json();
    if (data.user.role !== 'admin' && data.user.role !== 'client') { window.location.href = '/'; return false; }
    if (token) { fetch('/auth/sync-cookie', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } }).catch(() => {}); }
  } catch { window.location.href = '/'; return false; }
  onStatusChange(updateStatusUI);
  ping();
  setInterval(() => ping(), 15000);
  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
  return true;
}

function updateStatusUI(status) {
  const badge = document.getElementById('status-badge');
  const label = document.getElementById('status-label');
  if (!badge || !label) return;
  badge.className = 'status-dot status-' + status;
  label.textContent = status === 'connected' ? 'Conectado' : status === 'checking' ? 'Verificando…' : 'Desconectado';
}

async function handleLogout() {
  try { await fetch('/auth/logout', { method: 'POST' }); } catch {}
  sessionStorage.clear();
  localStorage.removeItem('scb_jwt');
  localStorage.removeItem('scb_role');
  localStorage.removeItem('scb_server_url');
  window.location.href = '/';
}

async function loadVods() {
  const container = document.getElementById('vod-list');
  try {
    const res = await fetch(getServerUrl() + '/api/client/vods', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.success) { container.innerHTML = '<p style="opacity:0.6;font-style:italic">Error al cargar.</p>'; return; }
    const vods = data.vods || [];
    if (vods.length === 0) {
      container.innerHTML = '<p style="opacity:0.6;font-style:italic">No tienes VODs o clips agregados. Pegá URLs arriba.</p>';
      return;
    }
    container.innerHTML = vods.map(v => `
      <div class="vod-item" data-id="${v.id}">
        <div class="vod-url">${esc(v.url)}</div>
        <div class="vod-meta">
          <span class="vod-badge ${v.type}">${esc(v.type)}</span>
          ${v.channel ? `<span style="font-size:11px;color:var(--text-muted)">${esc(v.channel)}</span>` : ''}
          <span style="font-size:11px;color:var(--text-muted)">${v.views_count} views</span>
          <button class="btn btn-small btn-danger vod-del" data-id="${v.id}">X</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.vod-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Quitar este VOD?')) return;
        const id = btn.dataset.id;
        const res = await fetch(getServerUrl() + '/api/client/vods/' + id, { method: 'DELETE', headers: getAuthHeaders() });
        const data = await res.json();
        if (data.success) {
          showMsg('vod-msg', 'VOD eliminado', 'success');
          loadVods();
        } else {
          showMsg('vod-msg', data.error || 'Error', 'error');
        }
      });
    });
  } catch {
    container.innerHTML = '<p style="opacity:0.6;font-style:italic">Error de conexión.</p>';
  }
}

function formatUptime(seconds) {
  if (!seconds || seconds < 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

async function loadViewerStats() {
  try {
    const res = await fetch(getServerUrl() + '/api/client/vods/stats', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.success) return;
    const v = data.viewer;
    const s = data.stats;
    const limit = data.hourly_limit || 50;

    const running = v.running;
    document.getElementById('stat-status').textContent = running ? 'Corriendo' : 'Detenido';
    document.getElementById('stat-status').style.color = running ? 'var(--success,#27ae60)' : 'var(--text-muted)';
    document.getElementById('stat-views-gen').textContent = v.viewsGenerated || 0;
    document.getElementById('stat-views-fail').textContent = v.viewsFailed || 0;
    document.getElementById('stat-hourly').textContent = (s.last_hour || 0) + ' / ' + limit;
    document.getElementById('stat-total').textContent = s.total_views || 0;

    const uptime = running && v.startedAt ? Math.floor(Date.now() / 1000 - v.startedAt) : null;
    document.getElementById('stat-uptime').textContent = formatUptime(uptime);

    const visitEl = document.getElementById('stat-current-visit');
    if (running && v.currentVisit) {
      const elapsed = Math.floor(Date.now() / 1000 - v.currentVisit.startedAt);
      const remaining = Math.max(0, 60 - elapsed);
      const url = v.currentVisit.vodUrl || '(VOD #' + v.currentVisit.vodId + ')';
      visitEl.textContent = `${url} — ${elapsed}s (próxima en ~${remaining}s)`;
    } else if (running) {
      visitEl.textContent = 'Esperando...';
    } else {
      visitEl.textContent = '—';
    }

    const pct = limit > 0 ? Math.min(100, ((s.last_hour || 0) / limit) * 100) : 0;
    const bar = document.getElementById('hourly-progress');
    const fill = document.getElementById('hourly-fill');
    if (bar && fill) {
      bar.style.display = 'block';
      fill.style.width = pct + '%';
    }

    document.getElementById('btn-start-viewer').style.display = running ? 'none' : '';
    document.getElementById('btn-stop-viewer').style.display = running ? '' : 'none';
  } catch {}
}

async function refreshPermissions() {
  try {
    const res = await fetch(getServerUrl() + '/api/client/permissions', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.success) return;
    renderNav(data.permissions || []);
  } catch {}
}

function renderNav(permissions) {
  const container = document.getElementById('nav-links');
  const links = [];
  if (permissions.includes('chat')) links.push({ href: '/chat.html', label: '💬 Chat' });
  if (permissions.includes('simulator')) links.push({ href: '/stream-simulator.html', label: '🤖 Simulador' });
  if (permissions.includes('vods')) links.push({ href: '/vods.html', label: '🎬 VODs', active: true });
  container.innerHTML = links.map(l =>
    `<a href="${l.href}" class="${l.active ? 'active' : ''}">${l.label}</a>`
  ).join('');
}

async function init() {
  const ok = await initAuth();
  if (!ok) return;

  await refreshPermissions();

  document.getElementById('btn-add-vod').addEventListener('click', async () => {
    const url = document.getElementById('vod-url-input').value.trim();
    if (!url) { showMsg('vod-msg', 'Pegá una URL de VOD o clip de Kick', 'error'); return; }
    const res = await fetch(getServerUrl() + '/api/client/vods', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (data.success) {
      showMsg('vod-msg', 'VOD agregado', 'success');
      document.getElementById('vod-url-input').value = '';
      loadVods();
    } else {
      showMsg('vod-msg', data.error || 'Error', 'error');
    }
  });

  document.getElementById('btn-start-viewer').addEventListener('click', async () => {
    const res = await fetch(getServerUrl() + '/api/client/vods/start', { method: 'POST', headers: getAuthHeaders() });
    const data = await res.json();
    if (data.success) {
      showMsg('vod-msg', 'Visor iniciado', 'success');
      loadViewerStats();
      if (!viewerInterval) {
        viewerInterval = setInterval(loadViewerStats, 3000);
      }
    } else {
      showMsg('vod-msg', data.error || 'Error', 'error');
    }
  });

  document.getElementById('btn-stop-viewer').addEventListener('click', async () => {
    const res = await fetch(getServerUrl() + '/api/client/vods/stop', { method: 'POST', headers: getAuthHeaders() });
    const data = await res.json();
    if (data.success) {
      showMsg('vod-msg', 'Visor detenido', 'success');
      loadViewerStats();
    } else {
      showMsg('vod-msg', data.error || 'Error', 'error');
    }
  });

  await loadVods();
  await loadViewerStats();
  viewerInterval = setInterval(loadViewerStats, 1000);
}

init();
