import { getServerUrl, getAuthHeaders, showMsg, initCommon, esc } from './admin-common.js';

async function addPool() {
  const name = document.getElementById('pool-name')?.value?.trim();
  const textarea = document.getElementById('pool-messages');
  const lines = textarea?.value?.split('\n').map(l => l.trim()).filter(l => l) || [];
  if (!name) { showMsg('pool-msg', 'Nombre requerido.', 'error'); return; }
  if (lines.length === 0) { showMsg('pool-msg', 'Al menos un mensaje.', 'error'); return; }
  try {
    const res = await fetch(`${getServerUrl()}/api/admin/pools`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ name, messages: lines }) });
    const data = await res.json();
    if (res.ok) {
      showMsg('pool-msg', `Pool "${name}" creado (${lines.length} msgs).`, 'success');
      textarea.value = '';
      document.getElementById('pool-name').value = '';
      loadPools();
    } else { showMsg('pool-msg', `Error: ${data.error || 'Error'}`, 'error'); }
  } catch { showMsg('pool-msg', 'Error de conexión.', 'error'); }
}

async function deletePool(id) {
  if (!confirm('Eliminar este pool?')) return;
  try {
    const res = await fetch(`${getServerUrl()}/api/admin/pools/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
    if (res.ok) loadPools();
  } catch {}
}

async function loadPools() {
  const container = document.getElementById('pool-list');
  if (!container) return;
  try {
    const res = await fetch(`${getServerUrl()}/api/admin/pools`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.success) { container.innerHTML = '<p style="opacity:0.6;font-style:italic">Error al cargar.</p>'; return; }
    const pools = data.pools || [];
    if (pools.length === 0) {
      container.innerHTML = '<p style="opacity:0.6;font-style:italic">No hay pools todavia. Crea uno.</p>';
    } else {
      container.innerHTML = pools.map(p => `
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #333;padding:8px 0">
          <span><strong>${esc(p.name)}</strong> (${p.message_count} mensajes)</span>
          <button class="btn btn-danger btn-small" onclick="deletePool(${p.id})">Eliminar</button>
        </div>
      `).join('');
    }
  } catch { container.innerHTML = '<p style="opacity:0.6;font-style:italic">Error al cargar pools.</p>'; }
}

window.deletePool = deletePool;

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await initCommon())) return;
  loadPools();
  document.getElementById('add-pool-btn')?.addEventListener('click', addPool);
});
