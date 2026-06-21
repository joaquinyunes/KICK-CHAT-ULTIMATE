import { getServerUrl, getAuthHeaders, showMsg, checkOAuthResult, initCommon, esc } from './admin-common.js';

async function loadDashboard() {
  try {
    const res = await fetch(`${getServerUrl()}/api/admin/dashboard`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.success) return;
    const s = data.stats;
    setText('dash-total-bots', s.total_bots);
    setText('dash-oauth-bots', s.oauth_bots);
    setText('dash-total-clients', `${s.total_clients} (${s.active_clients} act)`);
    setText('dash-msgs-sent', s.messages_sent);
    setText('dash-uptime', fmtUptime(s.uptime_seconds));
    setText('dash-expired', s.expired_clients);
    setText('dash-total-proxies', `${s.total_proxies} (${s.active_proxies} act)`);

    const log = document.getElementById('dash-recent-log');
    if (!log) return;
    const msgs = data.recent_messages || [];
    if (msgs.length === 0) {
      log.innerHTML = '<div style="color:var(--text-muted);font-style:italic;text-align:center;padding:32px 0">Sin actividad todavía.</div>';
      return;
    }
    log.innerHTML = `<table class="data-table">
      <thead><tr><th>Hora</th><th>Bot</th><th>Canal</th><th>Estado</th></tr></thead>
      <tbody>${msgs.map(m => {
        const time = new Date(m.sent_at * 1000).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        const ok = m.success;
        const status = ok
          ? '<span class="tag">✓ OK</span>'
          : `<span class="tag" style="background:var(--alert-glow);color:var(--alert);border-color:rgba(255,92,92,0.3)">✗ ${esc(m.error_reason) || 'FAIL'}</span>`;
        return `<tr><td>${time}</td><td>${esc(m.bot_name) || '—'}</td><td>${esc(m.channel) || '—'}</td><td>${status}</td></tr>`;
      }).join('')}</tbody></table>`;
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

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await initCommon())) return;
  checkOAuthResult('dash-msg');
  loadDashboard();
  document.getElementById('dash-oauth-btn')?.addEventListener('click', () => { window.location.href = '/admin/bots'; });
  document.getElementById('dash-create-client-btn')?.addEventListener('click', () => { window.location.href = '/admin/clientes'; });
  document.getElementById('dash-agregar-bot-btn')?.addEventListener('click', () => { window.location.href = '/admin/bots'; });
  document.getElementById('dash-proxies-btn')?.addEventListener('click', () => { window.location.href = '/admin/proxies'; });
});
