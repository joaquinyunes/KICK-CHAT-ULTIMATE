import { initCommon, showMsg, esc } from './admin-common.js';
import { renderAuthHeader } from './client-nav.js';

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

// Resultados de "Probar" por cuenta (sobreviven al redibujado periódico de la lista).
const testResults = new Map();
const testing = new Set();

function fmtTest(r) {
  if (!r) return '';
  const bits = [];
  bits.push(r.ok ? (r.sent ? '✅ mensaje enviado' : '✅ OK') : '❌ ' + (r.error || 'falló'));
  if (r.api_name && r.name_matches === false) bits.push('la API devuelve otro usuario: ' + r.api_name);
  if (r.refreshed) bits.push('token renovado');
  bits.push(r.ms + ' ms');
  return bits.join(' · ');
}

async function runTest(username) {
  const names = username ? [username] : [...document.querySelectorAll('[data-test]')].map((b) => b.dataset.test);
  names.forEach((n) => { testing.add(n); testResults.delete(n); });
  await loadStatus();
  const r = await api('/kick20/api/test', { method: 'POST', body: JSON.stringify(username ? { username } : {}) });
  names.forEach((n) => testing.delete(n));
  if (!r.ok || typeof r.data !== 'object') {
    showMsg('msg', 'Error al probar: ' + ((r.data && r.data.error) || r.status), 'error');
    return loadStatus();
  }
  r.data.results.forEach((x) => testResults.set(x.username, x));
  showMsg('msg', 'Prueba: ' + r.data.passed + '/' + r.data.total + ' cuentas OK.', r.data.ok ? 'success' : 'error');
  loadStatus();
}

async function sendTestFrom(username, channel, text) {
  const t0 = Date.now();
  const r = await api('/kick20/api/send', { method: 'POST', body: JSON.stringify({ channel, content: text, username }) });
  const d = typeof r.data === 'object' && r.data ? r.data : {};
  const res = { username, ms: Date.now() - t0, sent: true, ok: r.ok && d.is_sent !== false };
  if (!res.ok) res.error = (d.error || 'http_' + r.status) + (d.body ? ' — ' + d.body.slice(0, 120) : '');
  return res;
}

async function runSend(only) {
  const channel = $('st-channel').value.trim().replace(/^@/, '');
  const text = $('st-text').value.trim();
  if (!channel || !text) { showMsg('msg', 'Completá el canal y el mensaje.', 'error'); return; }
  try { localStorage.setItem('k20-test-channel', channel); } catch { /* noop */ }
  const names = only ? [only] : [...document.querySelectorAll('[data-test]')].map((b) => b.dataset.test);
  if (!names.length) return;
  if (!confirm('Se enviará "' + text + '" en el chat de ' + channel + ' desde ' + names.length + ' cuenta(s). ¿Continuar?')) return;

  names.forEach((n) => { testing.add(n); testResults.delete(n); });
  await loadStatus();
  let passed = 0;
  for (let i = 0; i < names.length; i++) {
    const r = await sendTestFrom(names[i], channel, text);
    testing.delete(names[i]);
    testResults.set(names[i], r);
    if (r.ok) passed++;
    await loadStatus();
    if (i < names.length - 1) await new Promise((res) => setTimeout(res, 1500 + Math.random() * 1500));
  }
  showMsg('msg', 'Envío de prueba: ' + passed + '/' + names.length + ' cuentas enviaron.', passed === names.length ? 'success' : 'error');
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
  $('btn-test-all').disabled = testing.size > 0;
  $('btn-send-all').disabled = testing.size > 0 || s.accounts.length === 0;
  list.innerHTML = s.accounts.map((a) => {
    const t = testResults.get(a.username);
    const busy = testing.has(a.username);
    const dot = busy ? 'warn' : t ? (t.ok ? '' : 'bad') : (a.expired ? 'warn' : '');
    return `
    <div class="k20-acc">
      <span class="k20-dot ${dot}"></span>
      <div>
        <div class="name">${esc(a.username)}</div>
        <div class="meta">${esc(a.scope || '')} · ${fmtExpiry(a.expires_at, a.expired)} · ${a.sent || 0} enviados</div>
        ${busy ? '<div class="meta">probando…</div>' : t ? `<div class="meta k20-test ${t.ok ? 'ok' : 'bad'}">${esc(fmtTest(t))}</div>` : ''}
      </div>
      <div class="spacer"></div>
      <button class="btn btn-small" data-test="${esc(a.username)}" ${busy ? 'disabled' : ''}>Probar</button>
      <button class="btn btn-small" data-refresh="${esc(a.username)}">Refrescar</button>
      <button class="btn btn-small btn-warn" data-remove="${esc(a.username)}">Quitar</button>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-test]').forEach((b) => b.onclick = () => runTest(b.dataset.test));
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
  renderAuthHeader('kick20');
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
  $('btn-test-all').onclick = () => runTest();
  $('btn-send-all').onclick = () => runSend();
  try { $('st-channel').value = localStorage.getItem('k20-test-channel') || ''; } catch { /* noop */ }
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
