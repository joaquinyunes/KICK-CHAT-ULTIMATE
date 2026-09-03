import { initCommon, showMsg, esc } from './admin-common.js';

const $ = (id) => document.getElementById(id);

async function api(path, opts) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

function fmtExpiry(sec, expired) {
  if (!sec) return '';
  return expired ? 'renovando token…' : 'sesión activa · se renueva sola';
}

async function loadStatus() {
  const { data: s } = await api('/kick20/api/status');
  if (typeof s !== 'object') return;

  $('app-state').textContent = s.configured
    ? '✅ App configurada · client_id ' + s.client_id_masked
    : '⚠️ Falta configurar la app (abrí "Credenciales de la app" abajo).';
  $('app-redirect').textContent = 'redirect_uri: ' + s.redirect_uri;
  if (!$('cfg-redirect').value) $('cfg-redirect').value = s.redirect_uri;

  $('acc-count').textContent = '(' + s.accounts.length + ')';
  $('btn-connect').disabled = !s.configured;

  const list = $('acc-list');
  if (s.accounts.length === 0) {
    list.innerHTML = '<p style="opacity:.5;text-align:center;padding:32px">Ninguna cuenta conectada. Configurá la app y conectá una.</p>';
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
      <button class="btn btn-small" data-refresh="${esc(a.username)}">Refrescar</button>
      <button class="btn btn-small btn-warn" data-remove="${esc(a.username)}">Quitar</button>
    </div>`).join('');

  list.querySelectorAll('[data-refresh]').forEach((b) => b.onclick = async () => {
    await api('/kick20/api/refresh', { method: 'POST', body: JSON.stringify({ username: b.dataset.refresh }) });
    showMsg('msg', 'Token refrescado: ' + b.dataset.refresh, 'success');
    loadStatus();
  });
  list.querySelectorAll('[data-remove]').forEach((b) => b.onclick = async () => {
    if (!confirm('¿Quitar la cuenta ' + b.dataset.remove + '?')) return;
    await api('/kick20/api/disconnect', { method: 'POST', body: JSON.stringify({ username: b.dataset.remove }) });
    showMsg('msg', 'Cuenta quitada: ' + b.dataset.remove, 'success');
    loadStatus();
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  const ok = await initCommon();
  if (ok === false) return;

  $('btn-connect').onclick = async () => {
    const r = await api('/kick20/api/auth-url');
    if (!r.ok) { showMsg('msg', 'Error: ' + ((r.data && r.data.error) || r.status), 'error'); return; }
    $('connect-url').value = r.data.url;
    $('connect-url-box').hidden = false;
    $('connect-url').focus(); $('connect-url').select();
    showMsg('msg', 'Copiá la URL y abrila en tu navegador. Al aprobar, la cuenta aparece sola.', 'success');
  };
  $('btn-copy-url').onclick = async () => {
    const el = $('connect-url');
    el.select();
    try { await navigator.clipboard.writeText(el.value); } catch { document.execCommand('copy'); }
    showMsg('msg', 'URL copiada al portapapeles.', 'success');
  };
  $('btn-refresh-all').onclick = async () => {
    await api('/kick20/api/refresh', { method: 'POST', body: '{}' });
    showMsg('msg', 'Tokens refrescados.', 'success');
    loadStatus();
  };
  $('btn-save').onclick = async () => {
    const r = await api('/kick20/api/config', { method: 'POST', body: JSON.stringify({
      client_id: $('cfg-id').value.trim(),
      client_secret: $('cfg-secret').value.trim(),
      redirect_uri: $('cfg-redirect').value.trim(),
    }) });
    if (r.ok) { $('cfg-secret').value = ''; $('cfg-id').value = ''; showMsg('msg', 'Credenciales guardadas.', 'success'); loadStatus(); }
    else showMsg('msg', 'Error: ' + (r.data.error || r.status), 'error');
  };

  const q = new URLSearchParams(location.search);
  if (q.get('ok')) showMsg('msg', 'Cuenta conectada' + (q.get('user') ? ': ' + q.get('user') : '') + '.', 'success');
  else if (q.get('err')) showMsg('msg', 'OAuth: ' + q.get('err'), 'error');
  if (q.has('ok') || q.has('err')) history.replaceState(null, '', '/admin/kick20');

  loadStatus();
  const t = setInterval(loadStatus, 4000);
  if (t && t.unref) t.unref();
});
