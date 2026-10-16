import { sendMessage } from './bridge-client.js';
import { renderNav, renderAuthHeader, requireAuth, startStatusLoop } from './client-nav.js';
import { SECCIONES, VARIABLES } from './tematicas/index.js';
import { parseHilos, varsIn, resolve, buildHilos, countMsgs, pickHilo, parseNoticias, VAR_RE, varKey } from './tematicas/engine.js';

// Temáticas: una sección por momento del stream (Saludos, Noticias, Slots, Cierre + las propias).
// La sección elegida es la que se envía. Los mensajes vienen en hilos (uno abre, otros responden)
// y ningún hilo se repite hasta que salieron todos los de esa sección.

const STORE_KEY = 'scb_tematicas_v3';
const MAX_USED = 3000;
const COLA = 3;   // hilos que se muestran en "Así saldría"

const esc = (s) => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
const uid = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const $ = (id) => document.getElementById(id);

// ─── Estado ─────────────────────────────────────────────────────────────────
const defaults = () => ({ v: 3, sel: 'saludos', modos: {}, vars: {}, noticias: '', min: 4, max: 9, orden: {}, custom: [], overrides: {}, used: [] });

let state = defaults();
let used = new Set();
const run = { running: false, timer: null, sending: false, queue: [], cola: [], newsIdx: 0, lastUser: '', enRafaga: false };
let sentTotal = 0;
let failedTotal = 0;

function save() {
  try {
    state.used = [...used].slice(-MAX_USED);
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch { /* sin storage */ }
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw && raw.v === 3) {
      state = { ...defaults(), ...raw };
      used = new Set(Array.isArray(raw.used) ? raw.used : []);
    } else {
      migrate();
    }
  } catch { state = defaults(); }
  if (!secById(state.sel)) state.sel = 'saludos';
}

/** Trae las secciones propias y variables de las versiones anteriores de esta página. */
function migrate() {
  const add = (nombre, texto) => {
    const t = String(texto || '').split('\n').map((l) => l.replace(/^[+-] /, '')).join('\n').trim();
    if (t) state.custom.push({ id: uid(), nombre: String(nombre || 'Mi sección').slice(0, 40), emoji: '✨', textos: { base: t } });
  };
  try {
    const v2 = JSON.parse(localStorage.getItem('scb_tematicas_v2') || 'null');
    if (v2) {
      Object.assign(state.vars, v2.vars || {});
      for (const c of v2.custom || []) add(c.nombre, Object.values(c.lineas || {}).join('\n'));
      return;
    }
    const v1 = JSON.parse(localStorage.getItem('scb_tematicas') || 'null');
    for (const s of (v1 && v1.sections) || []) {
      Object.assign(state.vars, s.vars || {});
      if (!['deportivas', 'slots'].includes(String(s.name || '').trim().toLowerCase())) add(s.name, s.lines);
    }
  } catch { /* nada que migrar */ }
}

// ─── Secciones ──────────────────────────────────────────────────────────────
const allSecs = () => [...SECCIONES, ...state.custom];
const secById = (id) => allSecs().find((s) => s.id === id) || null;
const isBuiltin = (id) => SECCIONES.some((s) => s.id === id);
const sec = () => secById(state.sel) || SECCIONES[0];
const modoOf = (s) => (s.modos ? (state.modos[s.id] || s.modos[0][0]) : 'base');
const enOrden = () => state.orden[state.sel] === 'orden';

function texto(s, modo = modoOf(s)) {
  const ov = state.overrides[s.id];
  if (ov && typeof ov[modo] === 'string') return ov[modo];
  return (s.textos && s.textos[modo]) || '';
}

const noticias = () => parseNoticias(state.noticias);
function nextNoticia() {
  const list = noticias();
  if (!list.length) return '';
  return list[run.newsIdx++ % list.length];
}

/** Hilos listos de la sección elegida (para noticias, con la noticia que toca). */
function hilos(noticia = noticias()[0] || '') { return buildHilos(texto(sec()), state.vars, noticia); }

/** Variables de la sección (todos sus modos, así no aparecen y desaparecen al cambiar). */
function secVars() {
  const s = sec();
  const keys = [];
  for (const m of s.modos ? s.modos.map((x) => x[0]) : ['base']) {
    for (const k of varsIn(texto(s, m))) if (k !== 'noticia' && !keys.includes(k)) keys.push(k);
  }
  const order = Object.keys(VARIABLES);
  return keys.sort((a, b) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)));
}

// ─── Cola: el hilo que está saliendo + los próximos ─────────────────────────
function fillCola() {
  while (run.cola.length < COLA) {
    const skip = new Set(run.cola.map((h) => h.key));
    const pick = pickHilo(hilos(nextNoticia()), used, skip, { enOrden: enOrden() });
    if (!pick) break;
    if (pick.reset) logNote(`♻️ Ya salieron todos los mensajes de ${sec().nombre}: vuelven a estar disponibles.`);
    run.cola.push(pick.hilo);
  }
}

/** Se cambió la sección, el modo o los datos: se rearma lo que viene. */
function rebuild(clearQueue) {
  if (clearQueue) run.queue = [];
  run.cola = [];
  fillCola();
  renderPreview();
  renderStat();
}

function takeLine() {
  if (!run.queue.length) {
    if (!run.cola.length) fillCola();
    const h = run.cola.shift();
    if (!h) return null;
    used.add(h.key);
    run.queue = h.lines.slice();
    fillCola();
  }
  return run.queue.shift() || null;
}

// ─── Envío ──────────────────────────────────────────────────────────────────
function channel() {
  try { return String(JSON.parse(localStorage.getItem('scb_settings') || '{}').channelName || '').trim(); }
  catch { return ''; }
}

async function dispatch(tag, msg) {
  let res;
  try { res = await sendMessage({ channel: channel(), message: msg }); }
  catch (e) { res = { ok: false, error: e.message, status: 0 }; }
  const ok = !!(res && res.ok);
  // Ráfaga: el servidor deja a la misma cuenta 1, 2 o 3 mensajes seguidos. Si este
  // salió de la misma que el anterior, esa persona está escribiendo seguido y el
  // próximo sale con menos pausa.
  const user = (ok && res && res.username) || '';
  run.enRafaga = !!user && user === run.lastUser;
  run.lastUser = user;
  if (ok) sentTotal++; else failedTotal++;
  logSend(tag, res && res.username, msg, ok, res && res.status);
  renderMetrics();
  return { ok, res };
}

function setStatus(text, kind) {
  const el = $('tm-status');
  el.textContent = text;
  el.className = 'cc-status' + (kind ? ' ' + kind : '');
}

function motivoVacio() {
  const s = sec();
  if (s.usaNoticias && !noticias().length) return 'Pegá al menos una noticia.';
  if (!parseHilos(texto(s)).length) return 'Esta sección no tiene mensajes: agregalos en “Editar”.';
  return 'No hay mensajes listos: completá los campos de arriba.';
}

async function sendNext() {
  if (run.sending) return false;
  if (!channel()) { setStatus('Configurá el canal en Ajustes.', 'err'); return false; }
  const msg = takeLine();
  if (!msg) { setStatus(motivoVacio(), 'err'); return false; }
  run.sending = true;
  const { ok, res } = await dispatch(`${sec().emoji} ${sec().nombre}`, msg);
  run.sending = false;
  save();
  setStatus(ok ? `${res.username || '?'} ✓ ${msg.slice(0, 50)}` : `Error ${(res && res.status) || '?'} · ${msg.slice(0, 50)}`, ok ? 'ok' : 'err');
  renderPreview();
  renderStat();
  return ok;
}

function intervalo() {
  const a = Math.max(1, Number(state.min) || 1);
  const b = Math.max(1, Number(state.max) || a);
  return [Math.min(a, b), Math.max(a, b)];
}

function schedule() {
  if (!run.running) return;
  clearTimeout(run.timer);
  const [lo, hi] = intervalo();
  const seg = run.enRafaga
    ? Math.max(0.8, lo * 0.25) + Math.random() * Math.max(0.6, lo * 0.35)
    : lo + Math.random() * (hi - lo);
  run.timer = setTimeout(async () => {
    if (!run.running) return;
    await sendNext();
    schedule();
  }, seg * 1000);
}

function start() {
  if (run.running) return;
  if (!channel()) { alert('Configurá el canal en Ajustes.'); return; }
  if (!run.queue.length && !run.cola.length) {
    rebuild(false);
    if (!run.cola.length) { setStatus(motivoVacio(), 'err'); return; }
  }
  run.running = true;
  renderRunState();
  sendNext().finally(schedule);   // el primero sale enseguida
}

function stop() {
  run.running = false;
  clearTimeout(run.timer);
  run.timer = null;
  renderRunState();
  setStatus('Detenido');
}

// ─── Render ─────────────────────────────────────────────────────────────────
function renderTabs() {
  $('tm-tabs').innerHTML = allSecs().map((s) =>
    `<button type="button" class="tm-tab${s.id === state.sel ? ' active' : ''}${s.id === state.sel && run.running ? ' running' : ''}" data-id="${esc(s.id)}">` +
    `<span class="tm-dot"></span>${esc(s.emoji || '✨')} ${esc(s.nombre)}</button>`
  ).join('') + '<button type="button" class="tm-tab tm-tab-add" data-add="1">+ Nueva sección</button>';
}

function renderSec() {
  const s = sec();
  $('tm-desc').textContent = s.desc || 'Sección propia: editá sus mensajes abajo.';

  const modos = $('tm-modos');
  modos.hidden = !s.modos;
  if (s.modos) {
    const cur = modoOf(s);
    modos.innerHTML = s.modos.map(([k, label]) =>
      `<button type="button" class="tm-modo m-${k}${k === cur ? ' on' : ''}" data-modo="${k}">${label}</button>`).join('');
  }

  const ord = enOrden() ? 'orden' : 'azar';
  $('tm-orden').querySelectorAll('[data-orden]').forEach((b) => b.classList.toggle('on', b.dataset.orden === ord));

  $('tm-news-box').hidden = !s.usaNoticias;
  if (document.activeElement !== $('tm-news')) $('tm-news').value = state.noticias;

  renderVars();
  renderEditor();
}

let varsSig = '';
function renderVars() {
  const host = $('tm-vars');
  const keys = secVars();
  host.hidden = !keys.length;
  const sig = state.sel + '|' + keys.join(',');
  if (sig !== varsSig) {   // no redibujar los inputs mientras se escribe (se perdería el foco)
    varsSig = sig;
    host.innerHTML = keys.map((k) => {
      const def = VARIABLES[k] || { label: k, ej: k + '…' };
      return `<label class="tm-var"><span class="cc-lbl">${esc(def.label)} <span class="tm-var-badge" data-badge="${esc(k)}"></span></span>` +
        `<input type="text" maxlength="60" data-var="${esc(k)}" value="${esc(state.vars[k] || '')}" placeholder="${esc(def.ej)}" spellcheck="false" autocomplete="off"></label>`;
    }).join('');
  }
  // +N = cuántos mensajes del modo actual usan ese campo
  const txt = parseHilos(texto(sec())).flat();
  host.querySelectorAll('[data-badge]').forEach((el) => {
    const k = el.dataset.badge;
    const n = txt.filter((l) => varsIn(l).includes(k)).length;
    const lleno = !!String(state.vars[k] || '').trim();
    el.textContent = lleno ? '✓' : (n ? '+' + n : '');
    el.classList.toggle('ok', lleno);
  });
}

function renderStat() {
  const h = hilos();
  const total = countMsgs(h);
  const libres = countMsgs(h.filter((x) => !used.has(x.key)));
  $('tm-stat').innerHTML = total
    ? `<b>${libres}</b> mensajes sin usar de <b>${total}</b> · no se repite ninguno hasta que salgan todos ` +
      '<button type="button" class="tm-link" data-reset-used="1">reiniciar</button>'
    : `<span class="tm-warn">${esc(motivoVacio())}</span>`;
}

/** Lo que va a salir: lo que queda del hilo actual + los próximos hilos. Click en una línea = sale ya. */
function renderPreview() {
  const blocks = [];
  if (run.queue.length) blocks.push({ now: true, lines: run.queue });
  for (const h of run.cola) blocks.push({ lines: h.lines });
  $('tm-preview').innerHTML = '<div class="tm-preview-title">Así saldría · click en una línea para enviarla ya ' +
    '<button type="button" class="tm-reshuffle" data-act="reshuffle" title="Ver otras">↻</button></div>' +
    (blocks.length
      ? blocks.map((b, bi) => `<div class="tm-hilo${b.now ? ' now' : ''}">` + b.lines.map((l, li) =>
        `<div class="tm-preview-row${li ? ' reply' : ''}" data-b="${bi}" data-l="${li}" title="Enviar ahora">${esc(l)}</div>`).join('') + '</div>').join('')
      : `<span class="tm-preview-empty">${esc(motivoVacio())}</span>`);
}

function renderRunState() {
  $('tm-start').disabled = run.running;
  $('tm-stop').disabled = !run.running;
  $('tm-sec').classList.toggle('is-running', run.running);
  if (run.running) { const [a, b] = intervalo(); setStatus(`Enviando cada ${a}–${b} s`); }
  renderTabs();
}

function renderMetrics() {
  $('tm-sent').textContent = sentTotal;
  $('tm-failed').textContent = failedTotal;
  const ch = $('tm-channel');
  const name = channel();
  ch.textContent = name || 'sin configurar';
  ch.classList.toggle('unset', !name);
}

// ─── Editor ─────────────────────────────────────────────────────────────────
function renderEditor() {
  const s = sec();
  const builtin = isBuiltin(s.id);
  const ta = $('tm-edit-lines');
  if (document.activeElement !== ta) ta.value = texto(s);
  const name = $('tm-edit-name');
  name.hidden = builtin;
  if (!builtin && document.activeElement !== name) name.value = s.nombre;
  $('tm-edit-del').hidden = builtin;
  const ov = state.overrides[s.id];
  $('tm-edit-reset').hidden = !(builtin && ov && typeof ov[modoOf(s)] === 'string');
  const hs = parseHilos(ta.value);
  const modo = s.modos ? s.modos.find((m) => m[0] === modoOf(s)) : null;
  $('tm-edit-count').innerHTML = `<b>${hs.flat().length}</b> mensajes en <b>${hs.length}</b> ${hs.some((h) => h.length > 1) ? 'conversaciones' : 'renglones'}` +
    (modo ? ` · ${esc(modo[1])}` : '');
}

function onEdit(text) {
  const s = sec();
  if (isBuiltin(s.id)) (state.overrides[s.id] ||= {})[modoOf(s)] = text;
  else (s.textos ||= {}).base = text;
  save();
  renderEditor();
  renderVars();
  rebuild(false);
}

function selectSec(id) {
  state.sel = id;
  save();
  renderTabs();
  renderSec();
  rebuild(true);
  if (run.running) setStatus(`Enviando ${sec().nombre}…`);
}

function newSec() {
  const s = { id: uid(), nombre: 'Nueva sección', emoji: '✨', textos: { base: '' } };
  state.custom.push(s);
  selectSec(s.id);
  $('tm-edit').open = true;
  const n = $('tm-edit-name');
  n.focus();
  n.select();
}

// ─── Envío manual (EN VIVO y "Así saldría") ─────────────────────────────────
function setLiveStatus(text, kind) {
  const el = $('tm-live-status');
  el.textContent = text;
  el.className = 'cc-status' + (kind ? ' ' + kind : '');
}

async function liveSend(raw) {
  const text = String(raw || '').trim();
  if (!text) return false;
  if (!channel()) { setLiveStatus('Configurá el canal en Ajustes.', 'err'); return false; }
  const msg = resolve(text, state.vars);
  if (msg === null) {
    const falta = [...text.matchAll(VAR_RE)].map((m) => varKey(m[1])).filter((k) => !String(state.vars[k] || '').trim());
    setLiveStatus(`Falta completar: ${falta.join(', ')}`, 'err');
    return false;
  }
  setLiveStatus('Enviando…');
  const { ok, res } = await dispatch('EN VIVO', msg);
  setLiveStatus(ok ? `${res.username || '?'} ✓ ${msg.slice(0, 50)}` : `Error ${(res && res.status) || '?'} · ${msg.slice(0, 50)}`, ok ? 'ok' : 'err');
  return ok;
}

/** Click en una línea de la vista previa: sale ya y la conversación sigue desde ahí. */
async function sendFromPreview(bi, li) {
  if (!channel()) { setStatus('Configurá el canal en Ajustes.', 'err'); return; }
  const blocks = run.queue.length ? [null, ...run.cola] : [...run.cola];
  const b = blocks[bi];
  let line;
  if (b === null) {
    line = run.queue[li];
    run.queue = run.queue.slice(li + 1);
  } else if (b) {
    line = b.lines[li];
    used.add(b.key);
    run.cola = run.cola.filter((h) => h !== b);
    run.queue = b.lines.slice(li + 1);
    fillCola();
  }
  if (!line) return;
  renderPreview();
  const { ok, res } = await dispatch(`${sec().emoji} ${sec().nombre}`, line);
  save();
  setStatus(ok ? `${res.username || '?'} ✓ ${line.slice(0, 50)}` : `Error ${(res && res.status) || '?'}`, ok ? 'ok' : 'err');
  renderStat();
}

// ─── Registro ───────────────────────────────────────────────────────────────
function logRow(html, cls) {
  const box = $('tm-log');
  if (box.querySelector('.empty-state')) box.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'log-row' + (cls ? ' ' + cls : '');
  row.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString('es-AR', { hour12: false })}</span>` + html;
  box.insertBefore(row, box.firstChild);
  while (box.children.length > 120) box.removeChild(box.lastChild);
}
function logSend(tag, bot, msg, ok, status) {
  logRow(`<span class="log-tag tm-log-tag">${esc(tag)}</span><span class="log-bot">${esc(ok ? (bot || '?') : 'ERR ' + (status || '?'))}</span><span class="log-msg">${esc(msg)}</span>`, ok ? '' : 'err');
}
function logNote(text) { logRow(`<span class="log-msg tm-log-note">${esc(text)}</span>`, 'tm-note'); }

// ─── Eventos ────────────────────────────────────────────────────────────────
function wire() {
  $('tm-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tm-tab');
    if (!b) return;
    if (b.dataset.add) newSec();
    else if (b.dataset.id !== state.sel) selectSec(b.dataset.id);
  });

  $('tm-modos').addEventListener('click', (e) => {
    const b = e.target.closest('[data-modo]');
    if (!b) return;
    state.modos[sec().id] = b.dataset.modo;
    save();
    renderSec();
    rebuild(true);
  });

  $('tm-orden').addEventListener('click', (e) => {
    const b = e.target.closest('[data-orden]');
    if (!b || b.dataset.orden === (enOrden() ? 'orden' : 'azar')) return;
    state.orden[state.sel] = b.dataset.orden;
    // en orden arranca desde el primero de la lista
    if (b.dataset.orden === 'orden') for (const h of hilos()) used.delete(h.key);
    save();
    renderSec();
    rebuild(true);
  });

  $('tm-news').addEventListener('input', (e) => { state.noticias = e.target.value; save(); rebuild(false); });

  $('tm-vars').addEventListener('input', (e) => {
    const k = e.target.dataset.var;
    if (!k) return;
    state.vars[k] = e.target.value;
    save();
    renderVars();
    rebuild(false);
  });

  const num = (id, key) => $(id).addEventListener('input', (e) => {
    const n = parseInt(e.target.value, 10);
    if (n > 0) {
      state[key] = Math.min(n, 600);
      save();
      if (run.running) { renderRunState(); schedule(); }
    }
  });
  num('tm-min', 'min');
  num('tm-max', 'max');

  $('tm-start').addEventListener('click', start);
  $('tm-stop').addEventListener('click', stop);
  $('tm-stop-all').addEventListener('click', stop);
  $('tm-once').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    await sendNext();
    b.disabled = false;
  });

  $('tm-sec').addEventListener('click', (e) => {
    if (e.target.closest('[data-reset-used]')) {
      if (!confirm('¿Reiniciar la memoria? Los mensajes ya enviados van a poder volver a salir.')) return;
      used.clear();
      save();
      rebuild(false);
      return;
    }
    if (e.target.closest('[data-act="reshuffle"]')) { rebuild(false); return; }
    const row = e.target.closest('.tm-preview-row');
    if (row) sendFromPreview(Number(row.dataset.b), Number(row.dataset.l));
  });

  $('tm-edit-lines').addEventListener('input', (e) => onEdit(e.target.value));
  $('tm-edit-name').addEventListener('input', (e) => {
    const s = sec();
    if (isBuiltin(s.id)) return;
    s.nombre = e.target.value || 'Sin nombre';
    save();
    renderTabs();
  });
  $('tm-edit-reset').addEventListener('click', () => {
    const s = sec();
    if (!confirm(`¿Volver a los mensajes originales de ${s.nombre}? Se pierden tus cambios.`)) return;
    delete state.overrides[s.id][modoOf(s)];
    save();
    $('tm-edit-lines').value = texto(s);
    renderSec();
    rebuild(true);
  });
  $('tm-edit-del').addEventListener('click', () => {
    const s = sec();
    if (isBuiltin(s.id) || !confirm(`¿Borrar la sección "${s.nombre}"?`)) return;
    state.custom = state.custom.filter((x) => x.id !== s.id);
    selectSec('saludos');
  });

  const liveInput = $('tm-live-input');
  const liveBtn = $('tm-live-send');
  const doLive = async () => {
    if (liveBtn.disabled) return;
    liveBtn.disabled = true;
    if (await liveSend(liveInput.value)) liveInput.value = '';
    liveBtn.disabled = false;
    liveInput.focus();
  };
  liveBtn.addEventListener('click', doLive);
  liveInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doLive(); } });

  $('tm-clear-log').addEventListener('click', () => { $('tm-log').innerHTML = '<div class="empty-state">Todavía no se envió nada.</div>'; });
  window.addEventListener('beforeunload', () => { run.running = false; clearTimeout(run.timer); save(); });
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await requireAuth())) return;
  renderAuthHeader('tematicas');
  renderNav('tematicas');
  startStatusLoop();
  load();
  wire();
  $('tm-min').value = state.min;
  $('tm-max').value = state.max;
  renderTabs();
  renderSec();
  rebuild(true);
  renderMetrics();
  save();
  setInterval(renderMetrics, 3000);   // refleja un cambio de canal hecho en /ajustes
});
