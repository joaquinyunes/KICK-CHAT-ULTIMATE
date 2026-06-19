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
      log.innerHTML = '<p style="opacity:0.6;font-style:italic">Sin actividad todavía.</p>';
      return;
    }
    log.innerHTML = `<div class="table-header" style="grid-template-columns:1fr 1fr 1fr 1fr"><span>Hora</span><span>Bot</span><span>Canal</span><span>Estado</span></div>` +
      msgs.map(m => {
        const time = new Date(m.sent_at * 1000).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        const status = m.success ? 'OK' : `FAIL ${esc(m.error_reason) || ''}`;
        return `<div class="table-row" style="grid-template-columns:1fr 1fr 1fr 1fr"><span>${time}</span><span>${esc(m.bot_name) || '—'}</span><span>${esc(m.channel) || '—'}</span><span>${esc(status)}</span></div>`;
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

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await initCommon())) return;
  checkOAuthResult('dash-msg');
  loadDashboard();
  document.getElementById('dash-oauth-btn')?.addEventListener('click', () => { window.location.href = '/admin/bots'; });
  document.getElementById('dash-create-client-btn')?.addEventListener('click', () => { window.location.href = '/admin/clientes'; });
  document.getElementById('dash-agregar-bot-btn')?.addEventListener('click', () => { window.location.href = '/admin/bots'; });
  document.getElementById('dash-proxies-btn')?.addEventListener('click', () => { window.location.href = '/admin/proxies'; });
});
