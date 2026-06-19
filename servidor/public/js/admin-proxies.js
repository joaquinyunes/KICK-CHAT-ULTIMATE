import { getServerUrl, getAuthHeaders, showMsg, initCommon, esc } from './admin-common.js';

let proxies = [];

async function loadProxies() {
  const res = await fetch(getServerUrl() + '/api/admin/proxies', { headers: getAuthHeaders() });
  const data = await res.json();
  if (!data.success) { showMsg('msg', 'Error al cargar proxies', 'error'); return; }
  proxies = data.proxies;
  renderProxies();
}

function renderProxies() {
  const container = document.getElementById('proxy-list');
  const count = document.getElementById('proxy-count');
  if (!container) return;
  count.textContent = proxies.length;
  if (proxies.length === 0) {
    container.innerHTML = '<p style="opacity:.5;text-align:center;padding:40px">No hay proxies. Agrega uno o importa desde texto.</p>';
    return;
  }
  container.innerHTML = proxies.map(p => `
    <div class="proxy-card" data-id="${p.id}">
      <span class="proxy-status ${p.is_active ? 'active' : 'inactive'}">${p.is_active ? 'Activo' : 'Inactivo'}</span>
      <div>
        <div class="proxy-addr">${esc(p.host)}:${p.port}</div>
        <div class="proxy-creds">${esc(p.username)}:***** (${esc(p.protocol)})</div>
      </div>
      <div class="proxy-actions">
        <button class="btn btn-small ${p.is_active ? 'btn-warn' : 'btn-primary'} btn-toggle" data-id="${p.id}" data-active="${p.is_active}">${p.is_active ? 'Desactivar' : 'Activar'}</button>
        <button class="btn btn-small btn-danger btn-del" data-id="${p.id}">Eliminar</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.btn-toggle').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const active = btn.dataset.active === '1' ? 0 : 1;
      await updateProxy(id, { is_active: active });
      await loadProxies();
    });
  });

  container.querySelectorAll('.btn-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Eliminar este proxy?')) return;
      const id = Number(btn.dataset.id);
      const res = await fetch(getServerUrl() + '/api/admin/proxies/' + id, { method: 'DELETE', headers: getAuthHeaders() });
      const data = await res.json();
      if (data.success) {
        showMsg('msg', 'Proxy eliminado', 'success');
        await loadProxies();
      } else {
        showMsg('msg', data.error || 'Error al eliminar', 'error');
      }
    });
  });
}

async function updateProxy(id, body) {
  const res = await fetch(getServerUrl() + '/api/admin/proxies/' + id, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.success) showMsg('msg', data.error || 'Error al actualizar', 'error');
  return data;
}

async function init() {
  const ok = await initCommon();
  if (!ok) return;

  document.getElementById('btn-add').addEventListener('click', async () => {
    const host = document.getElementById('f-host').value.trim();
    const port = document.getElementById('f-port').value.trim();
    const username = document.getElementById('f-user').value.trim();
    const password = document.getElementById('f-pass').value.trim();
    const protocol = document.getElementById('f-proto').value.trim() || 'http';
    if (!host || !port || !username || !password) {
      showMsg('msg', 'Completa todos los campos', 'error'); return;
    }
    const res = await fetch(getServerUrl() + '/api/admin/proxies', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ host, port: Number(port), username, password, protocol }),
    });
    const data = await res.json();
    if (data.success) {
      showMsg('msg', 'Proxy agregado', 'success');
      document.getElementById('f-host').value = '';
      document.getElementById('f-port').value = '';
      document.getElementById('f-user').value = '';
      document.getElementById('f-pass').value = '';
      await loadProxies();
    } else {
      showMsg('msg', data.error || 'Error', 'error');
    }
  });

  document.getElementById('btn-import').addEventListener('click', async () => {
    const text = document.getElementById('import-text').value;
    if (!text.trim()) { showMsg('msg', 'Pega los proxies primero', 'error'); return; }
    const res = await fetch(getServerUrl() + '/api/admin/proxies/import', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (data.success) {
      showMsg('msg', data.imported + ' proxies importados', 'success');
      document.getElementById('import-text').value = '';
      await loadProxies();
    } else {
      showMsg('msg', data.error || 'Error', 'error');
    }
  });

  await loadProxies();
}

init();
