import { requireAuth, startStatusLoop, renderNav, renderAuthHeader } from './client-nav.js';

const $ = (id) => document.getElementById(id);
const out = (v) => { $('out').textContent = typeof v === 'string' ? v : JSON.stringify(v, null, 2); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(path, opts) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

function fmtExpiry(sec, expired) {
  if (!sec) return '';
  if (expired) return 'renovando token…';
  return 'sesión activa · se renueva sola';
}

async function loadStatus() {
  const { data: s } = await api('/kick20/api/status');
  if (typeof s !== 'object') { out(s); return; }

  $('app-state').textContent = s.configured
    ? '✅ App configurada · client_id ' + s.client_id_masked
    : '⚠️ Falta configurar la app — abrí "Credenciales de la app" abajo.';
  $('app-redirect').textContent = 'redirect_uri: ' + s.redirect_uri;
  if (!$('cfg-redirect').value) $('cfg-redirect').value = s.redirect_uri;
  if (!s.configured) $('cfg-card').open = true;

  $('acc-count').textContent = s.accounts.length;
  $('btn-connect').disabled = !s.configured;

  const list = $('acc-list');
  if (s.accounts.length === 0) {
    list.innerHTML = '<div class="k20-empty">Ninguna cuenta conectada todavía.</div>';
    return;
  }
  list.innerHTML = s.accounts.map((a) => `
    <div class="k20-acc">
      <span class="k20-dot ${a.expired ? 'warn' : ''}"></span>
      <div>
        <div class="name">${esc(a.username)}</div>
        <div class="meta">${esc(a.scope || '')} · ${fmtExpiry(a.expires_at, a.expired)}</div>
      </div>
      <div class="spacer"></div>
      <button class="btn btn-ghost btn-xs" data-refresh="${esc(a.username)}">Refrescar</button>
      <button class="btn btn-ghost btn-xs" data-remove="${esc(a.username)}">Quitar</button>
    </div>`).join('');

  list.querySelectorAll('[data-refresh]').forEach((b) => b.onclick = async () => {
    out(await (await api('/kick20/api/refresh', { method: 'POST', body: JSON.stringify({ username: b.dataset.refresh }) })).data);
    loadStatus();
  });
  list.querySelectorAll('[data-remove]').forEach((b) => b.onclick = async () => {
    if (!confirm('¿Quitar la cuenta ' + b.dataset.remove + '?')) return;
    out(await (await api('/kick20/api/disconnect', { method: 'POST', body: JSON.stringify({ username: b.dataset.remove }) })).data);
    loadStatus();
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  const ok = await requireAuth();
  if (!ok) return;
  renderAuthHeader('kick20');
  renderNav('kick20');
  startStatusLoop();

  $('btn-connect').onclick = () => {
    window.open('/kick20/connect', '_blank', 'noopener');
    out('Abrí la pestaña de Kick, aprobá el acceso y volvé acá — la cuenta aparece sola en unos segundos.');
  };

  $('btn-save').onclick = async () => {
    const body = JSON.stringify({
      client_id: $('cfg-id').value.trim(),
      client_secret: $('cfg-secret').value.trim(),
      redirect_uri: $('cfg-redirect').value.trim(),
    });
    const r = await api('/kick20/api/config', { method: 'POST', body });
    out(r.data);
    if (r.ok) { $('cfg-secret').value = ''; $('cfg-id').value = ''; loadStatus(); }
  };
  $('btn-refresh-all').onclick = async () => {
    out(await (await api('/kick20/api/refresh', { method: 'POST', body: '{}' })).data);
    loadStatus();
  };

  const q = new URLSearchParams(location.search);
  if (q.get('ok')) out('✅ Cuenta conectada' + (q.get('user') ? ': ' + q.get('user') : '') + '.');
  else if (q.get('err')) out('❌ OAuth: ' + q.get('err'));
  if (q.has('ok') || q.has('err')) history.replaceState(null, '', '/kick20');

  loadStatus();
  // refresco periódico para captar cuentas recién conectadas en otra pestaña
  const t = setInterval(loadStatus, 4000);
  if (t && t.unref) t.unref();
});
