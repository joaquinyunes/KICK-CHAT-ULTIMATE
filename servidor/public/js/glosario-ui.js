import { renderNav, renderAuthHeader, requireAuth, startStatusLoop } from './client-nav.js';
import { parseGlosario, mezclar, categorias, buscar, filtrarPorSituacion, elegir, cargar, guardar, aTexto } from './glosario.js';
import { SITUACIONES, sitById, detectar } from './contexto.js';

// Glosario propio sin IA: cargar, generar líneas según la situación, buscar y limpiar.
// Todo vive en este navegador (localStorage); no se manda nada a ningún servidor.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let items = [];
let catSel = null;       // null = todas · '' = sin categoría
const used = new Set();  // lo que ya salió en el generador (no se repite hasta agotar)

function status(id, msg, type) {
  const e = $(id);
  e.textContent = msg || '';
  if (type) e.dataset.type = type; else delete e.dataset.type;
}

function persist() {
  if (!guardar(items)) status('gl-status', 'No se pudo guardar en el navegador (¿sin espacio?). Exportá el glosario para no perderlo.', 'error');
}

function renderTop() {
  $('gl-count').textContent = `${items.length.toLocaleString('es-AR')} entradas`;
  const cats = categorias(items);
  $('gl-cats').innerHTML = cats.length
    ? cats.slice(0, 40).map(([c, n]) => `<button type="button" class="gl-cat" data-cat="${esc(c)}" aria-pressed="${catSel === c}">${esc(c || 'sin categoría')}<b>${n.toLocaleString('es-AR')}</b></button>`).join('') +
      (cats.length > 40 ? `<span class="gl-help">…y ${cats.length - 40} categorías más (usá el buscador)</span>` : '')
    : '<span class="gl-empty">Todavía no cargaste nada.</span>';
}

function renderList() {
  const q = $('gl-q').value;
  const res = buscar(items, q, { cat: catSel, limit: 100 });
  $('gl-list').innerHTML = res.length
    ? res.map((i) => `<div class="gl-it"><span class="gl-t" title="${esc(i.t)}">${esc(i.t)}</span>${i.c ? `<span class="gl-c">${esc(i.c)}</span>` : ''}${i.s ? `<span class="gl-s" title="${esc(i.s)}">${esc(i.s)}</span>` : ''}<button type="button" data-del="${esc(i.n)}" title="Borrar">✕</button></div>`).join('') +
      (res.length === 100 ? '<div class="gl-empty">Se muestran las primeras 100. Afiná la búsqueda para ver otras.</div>' : '')
    : `<div class="gl-empty">${items.length ? 'No hay coincidencias.' : 'Cargá tus palabras arriba para verlas acá.'}</div>`;
}

const refresh = () => { renderTop(); renderList(); };

// ── 1 · Importar ────────────────────────────────────────────────────────────
function importar() {
  const text = $('gl-paste').value;
  if (!text.trim()) { status('gl-status', 'Pegá o elegí un archivo primero.', 'error'); return; }
  const modo = document.querySelector('input[name="gl-modo"]:checked').value;
  if (modo === 'reemplazar' && items.length && !confirm(`Esto borra tus ${items.length.toLocaleString('es-AR')} entradas actuales y carga las nuevas. ¿Seguir?`)) return;
  const { items: nuevos, descartadas } = parseGlosario(text);
  const m = mezclar(items, nuevos, modo);
  items = m.items;
  used.clear();
  persist();
  $('gl-paste').value = '';
  const extra = [m.repetidas ? `${m.repetidas.toLocaleString('es-AR')} repetidas salteadas` : '', descartadas ? `${descartadas} descartadas (muy largas)` : ''].filter(Boolean).join(' · ');
  status('gl-status', `✓ ${nuevos.length.toLocaleString('es-AR')} leídas → ${items.length.toLocaleString('es-AR')} en total${extra ? ' · ' + extra : ''}.`, 'ok');
  refresh();
}

// ── 2 · Generar ─────────────────────────────────────────────────────────────
let lastOut = '';
function generar() {
  if (!items.length) { status('gl-gen-info', 'Primero cargá tus palabras.', 'error'); return; }
  const sit = sitById($('gl-sit').value);
  const n = Math.min(Math.max(parseInt($('gl-n').value, 10) || 40, 1), 500);
  const { lista, por } = filtrarPorSituacion(items, sit);
  const sel = elegir(lista, n, { used });
  lastOut = sel.map((i) => i.t).join('\n');
  $('gl-out').value = lastOut;
  $('gl-copy').disabled = $('gl-dl').disabled = !lastOut;
  status('gl-gen-info', `${sel.length} líneas${sit ? ` para “${sit.label}”` : ''} · elegidas por ${por} (${lista.length.toLocaleString('es-AR')} candidatas).${por === 'todo' && sit ? ' Tus palabras no tienen categoría ni palabras clave de esta situación: salieron mezcladas.' : ''}`, 'ok');
}

async function copiar() {
  try { await navigator.clipboard.writeText(lastOut); status('gl-gen-info', '✓ Copiado.', 'ok'); }
  catch { const t = $('gl-out'); t.select(); try { document.execCommand('copy'); status('gl-gen-info', '✓ Copiado.', 'ok'); } catch { status('gl-gen-info', 'No se pudo copiar: seleccioná el texto a mano.', 'error'); } }
}

function descargar(texto, nombre) {
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Eventos ─────────────────────────────────────────────────────────────────
function wire() {
  $('gl-sit').innerHTML = '<option value="">Cualquiera (todo mezclado)</option>' +
    SITUACIONES.map((s) => `<option value="${s.id}">${s.emoji} ${s.label}</option>`).join('');

  $('gl-import').addEventListener('click', importar);
  $('gl-file').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    $('gl-paste').value = await f.text();
    status('gl-status', `Archivo “${f.name}” leído. Tocá Importar.`);
    e.target.value = '';
  });

  $('gl-ctx').addEventListener('input', (e) => {
    const r = detectar(e.target.value)[0];
    if (r) { $('gl-sit').value = r.sit.id; status('gl-gen-info', `Detecté: ${r.sit.emoji} ${r.sit.label} (${r.hits.join(', ')}).`); }
  });
  $('gl-gen').addEventListener('click', generar);
  $('gl-copy').addEventListener('click', copiar);
  $('gl-dl').addEventListener('click', () => descargar(lastOut, 'glosario-generado.txt'));

  $('gl-q').addEventListener('input', renderList);
  $('gl-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    catSel = catSel === b.dataset.cat ? null : b.dataset.cat;
    refresh();
  });
  $('gl-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    items = items.filter((i) => i.n !== b.dataset.del);
    persist();
    refresh();
  });
  $('gl-export').addEventListener('click', () => { if (items.length) descargar(aTexto(items), 'mi-glosario.txt'); });
  $('gl-clear').addEventListener('click', () => {
    if (!items.length || !confirm(`¿Borrar las ${items.length.toLocaleString('es-AR')} entradas? Si no las exportaste se pierden.`)) return;
    items = []; catSel = null; used.clear();
    persist();
    refresh();
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await requireAuth())) return;
  renderAuthHeader('glosario');
  renderNav('glosario');
  startStatusLoop();
  items = cargar();
  wire();
  refresh();
});
