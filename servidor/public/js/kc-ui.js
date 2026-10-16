import { renderNav, renderAuthHeader, requireAuth, startStatusLoop } from './client-nav.js';

const $ = (id) => document.getElementById(id);

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function ago(ms) {
  if (!ms || Number.isNaN(ms)) return '—';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 0) return 'recién';
  if (s < 60) return `hace ${s}s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)}m`;
  return `hace ${Math.floor(s / 3600)}h`;
}

let toastTimer = null;
function toast(msg) {
  const el = $('kc-toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
}

// Devuelve siempre un objeto con `ok` (HTTP) para poder mostrar fallos reales.
async function post(url, body) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    return { ...data, ok: r.ok && data.success !== false, status: r.status };
  } catch {
    return { ok: false, message: 'No se pudo hablar con el servidor.' };
  }
}
const failMsg = (r) => r.message || r.error || (r.status === 401 ? 'La sesión venció: volvé a entrar.' : 'No se pudo completar.');

// ── Estado compartido entre poll() y los botones ───────────────────────
let last = { pipeline: {}, checks: [], summaries: [] };

function pipelineOn(p) { return !!p.running; }
function restarting(p) { return !p.running && !p.stopping && !p.blocked && p.startedAt > 0; }
// Mismo criterio que el servidor: corriendo, o corrido por fuera con un resumen de los últimos 5 min.
function alive(d) {
  if (d.pipeline && d.pipeline.running) return true;
  const s = d.summaries && d.summaries[0];
  return !!s && Date.now() - s.timestamp * 1000 < 300000;
}

// ── Render ──────────────────────────────────────────────────────────────
function captureLabel(p) {
  if (p.windowTitle) return `la ventana «${p.windowTitle}»`;
  if (p.monitor) return `el monitor ${p.monitor}`;
  return p.captureMode === 'remote' ? 'el HLS del canal' : 'todo el escritorio';
}

function renderHero(d) {
  const p = d.pipeline || {};
  const chan = (d.sender && d.sender.channel) || '';
  let state = 'off', title = 'Apagado', sub = 'El analizador no está mirando tu pantalla.';
  if (p.blocked) {
    state = 'bad'; title = 'Bloqueado';
    sub = 'Se cayó varias veces seguidas y el servidor dejó de reiniciarlo. Mirá el error de abajo.';
  } else if (p.running) {
    state = 'on'; title = p.simulation ? 'En vivo (simulación)' : 'En vivo';
    sub = `Mirando ${captureLabel(p)}${chan ? ` · escribiendo en el chat de ${chan}` : ' · sin canal de Kick configurado'}.`;
  } else if (restarting(p)) {
    state = 'warn'; title = 'Reiniciando…';
    sub = 'El analizador se cayó y el servidor lo está levantando de nuevo.';
  }
  $('kc-hero').dataset.state = state;
  $('kc-big').textContent = title;
  $('kc-state-sub').textContent = sub;

  const on = pipelineOn(p) || restarting(p);
  const btn = $('kc-toggle');
  btn.textContent = on ? '■ Apagar' : '▶ Encender';
  btn.className = `btn ${on ? 'btn-danger' : 'btn-primary'} kcx-toggle`;

  renderErr('kc-pipe-err', p.lastError || d.lastError || '');
}

function renderChecks(checks) {
  const bad = (checks || []).filter((c) => !c.ok);
  $('kc-prep').hidden = bad.length === 0;
  if (bad.length === 0) return;
  $('kc-prep-n').textContent = bad.length;
  $('kc-checks').innerHTML = checks.map((c) => c.ok
    ? `<li class="ok"><span class="ico">✔</span><span>${esc(c.label)}</span></li>`
    : `<li class="bad"><span class="ico">✖</span><b>${esc(c.label)}</b>
         <span class="fix">${esc(c.fix)}</span>
         ${c.cmd ? `<span class="kcx-cmd"><code>${esc(c.cmd)}</code><button type="button" class="kd-link-btn" data-copy="${esc(c.cmd)}">Copiar</button></span>` : ''}
       </li>`).join('');
}

function detalleHtml(d) {
  if (!d) return '';
  const items = Object.entries(d).filter(([, v]) => v != null && v !== '' && v !== 'null');
  if (!items.length) return '';
  return `<div class="kc-det">${items.map(([k, v]) => `<span><b>${esc(k)}</b> ${esc(v)}</span>`).join('')}</div>`;
}

function renderSummaries(sums, on) {
  const box = $('kc-sums');
  if (!Array.isArray(sums) || sums.length === 0) {
    box.innerHTML = `<p class="kc-empty">${on ? 'Esperando el primer análisis… tarda unos segundos.' : 'Todavía no hay ningún análisis. Encendé el analizador.'}</p>`;
    return;
  }
  const [now, ...older] = sums;
  box.innerHTML = `
    <div class="kcx-now">
      <div class="kcx-now-top">
        ${now.fase ? `<span class="kc-badge">${esc(now.fase)}</span>` : ''}
        <span>${now.timestamp ? ago(now.timestamp * 1000) : ''}${now.latencia_seg != null ? ` · atraso ${esc(now.latencia_seg)}s` : ''}</span>
      </div>
      <p class="kcx-now-txt">${esc(now.resumen_actual || '—')}</p>
      ${now.evento ? `<p class="kc-evento">⚡ ${esc(now.evento)}</p>` : ''}
      ${detalleHtml(now.detalle)}
    </div>
    ${older.length ? '<div class="kcx-sub">Antes</div>' : ''}
    ${older.map((s) => `<div class="kcx-old"><time>${s.timestamp ? ago(s.timestamp * 1000) : ''}</time>${esc(s.resumen_actual || '—')}</div>`).join('')}`;
}

function renderLines(lines, count, whenIso, regenerating, on) {
  const box = $('kc-lines');
  $('kc-lote-count').textContent = `${count || (lines ? lines.length : 0)} líneas`;
  $('kc-lote-when').textContent = whenIso ? `lote ${ago(Date.parse(whenIso))}` : (regenerating ? 'regenerando…' : 'sin lote');
  if (!Array.isArray(lines) || lines.length === 0) {
    box.innerHTML = regenerating
      ? '<p class="kc-empty">⏳ Escribiendo mensajes nuevos con lo que ve ahora… (puede tardar 1-2 min si Gemini está saturado)</p>'
      : `<p class="kc-empty">${on ? 'Todavía no llegó ningún lote. El primero tarda unos minutos.' : 'Todavía no llegó ningún lote.'}</p>`;
    return;
  }
  box.innerHTML = lines.map((l) => {
    const m = /^([^:]{1,40}):\s*(.*)$/.exec(l);
    return m
      ? `<div class="kc-line"><span class="u">${esc(m[1])}</span><span class="t">${esc(m[2])}</span></div>`
      : `<div class="kc-line"><span class="t">${esc(l)}</span></div>`;
  }).join('');
}

function renderErr(elId, msg) {
  $(elId).innerHTML = msg ? `<div class="kc-err">${esc(msg)}</div>` : '';
}

async function poll() {
  let d;
  try {
    const res = await fetch('/api/chat/kc-context', { headers: { 'Accept': 'application/json' } });
    if (!res.ok) { renderErr('kc-pipe-err', `El servidor respondió ${res.status}${res.status === 401 ? ' (sesión vencida, volvé a entrar)' : ''}.`); return; }
    d = await res.json();
  } catch {
    renderErr('kc-pipe-err', 'Sin conexión con el servidor.');
    return;
  }
  last = d;
  const on = alive(d);

  renderHero(d);
  renderChecks(d.checks);
  renderSummaries(d.summaries, on);
  renderLines(d.lines, d.lastCount, d.lastIngestAt, d.regenerating, on);

  const s = d.sender || {};
  $('kc-sent').textContent = s.sent || 0;
  $('kc-queued').textContent = s.queued || 0;
  $('kc-failed').textContent = s.failed || 0;
  $('kc-send-int').textContent = `cada ${s.minSeg ?? 7}-${s.maxSeg ?? 18}s`;
  $('kc-send-chan').textContent = s.channel ? `canal: ${s.channel}` : 'canal: sin configurar';
  $('kc-send-last').textContent = `último envío: ${s.lastSentAt ? ago(s.lastSentAt) : 'todavía ninguno'}`;
  renderErr('kc-send-err', s.lastError || '');

  // Analizar / Regenerar solo tienen sentido con el analizador encendido.
  for (const id of ['kc-analyze', 'kc-regen']) {
    $(id).disabled = !on;
    $(id).title = on ? '' : 'Encendé el analizador primero';
  }
}

// ── Pantalla ────────────────────────────────────────────────────────────
async function loadMonitors() {
  let d;
  try { d = await (await fetch('/api/chat/kc-monitors')).json(); } catch { return; }
  const cur = (d.selected && d.selected.monitor) || '';
  const opts = ['<option value="">escritorio completo</option>'];
  for (const m of (d.monitors || [])) {
    opts.push(`<option value="${m.index}">monitor ${m.index} — ${m.w}×${m.h}</option>`);
  }
  $('kc-monitor').innerHTML = opts.join('');
  $('kc-monitor').value = cur;
  if (d.note) toast(d.note);
}

// ── Ajustes ─────────────────────────────────────────────────────────────
let dirty = false;
function setSaveState(text, cls) {
  const el = $('kc-save-state');
  el.textContent = text;
  el.className = `kcx-help${cls ? ' ' + cls : ''}`;
}
function markDirty() { dirty = true; setSaveState('Hay cambios sin guardar.', 'dirty'); }

// Goteo y bloque usan campos distintos: el que no corresponde se apaga.
function syncModo() {
  const bloque = document.querySelector('input[name="kc-cad-modo"]:checked')?.value === 'bloque';
  $('kc-f-goteo').classList.toggle('off', bloque);
  $('kc-f-bloque').classList.toggle('off', !bloque);
}

async function loadConfig() {
  let d;
  try { d = await (await fetch('/api/chat/kc-config')).json(); } catch { return; }
  const g = d.gen || {};
  const s = d.send || {};
  $('kc-categoria').value = g.categoria || 'mixto';
  const r = document.querySelector(`input[name="kc-cad-modo"][value="${g.modo === 'bloque' ? 'bloque' : 'goteo'}"]`);
  if (r) r.checked = true;
  $('kc-cad-min').value = g.min_seg ?? 25;
  $('kc-cad-max').value = g.max_seg ?? 70;
  $('kc-cad-bloque').value = g.bloque_seg ?? 300;
  $('kc-min-seg').value = s.minSeg ?? 7;
  $('kc-max-seg').value = s.maxSeg ?? 18;
  syncModo();
  dirty = false;
  setSaveState('Sin cambios.');
}

function collectConfig() {
  const num = (id, def) => { const n = Number($(id).value); return Number.isFinite(n) && n > 0 ? n : def; };
  return {
    gen: {
      categoria: $('kc-categoria').value || 'mixto',
      modo: document.querySelector('input[name="kc-cad-modo"]:checked')?.value || 'goteo',
      min_seg: num('kc-cad-min', 25),
      max_seg: num('kc-cad-max', 70),
      bloque_seg: num('kc-cad-bloque', 300),
    },
    send: { minSeg: num('kc-min-seg', 7), maxSeg: num('kc-max-seg', 18) },
  };
}

async function saveConfig(applyNow) {
  const r = await post('/api/chat/kc-config', { ...collectConfig(), applyNow });
  if (!r.ok) { toast(`No se guardó: ${failMsg(r)}`); return; }
  await loadConfig(); // muestra lo que el servidor realmente guardó (ya corregido)
  const hora = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  setSaveState(`Guardado (${hora})`, 'saved');
  toast(r.message || (r.applied ? 'Ajustes guardados. Regenerando el lote…' : 'Ajustes guardados. Se aplican al próximo lote.'));
  setTimeout(poll, 600);
}

// ── Arranque ────────────────────────────────────────────────────────────
function flashPrep() {
  const el = $('kc-prep');
  if (el.hidden) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

window.addEventListener('DOMContentLoaded', async () => {
  const ok = await requireAuth();
  if (!ok) return;
  renderAuthHeader('kc');
  renderNav('kc');
  startStatusLoop();

  $('kc-toggle').addEventListener('click', async () => {
    const p = last.pipeline || {};
    const apagar = pipelineOn(p) || restarting(p);
    toast(apagar ? 'Apagando el analizador…' : 'Encendiendo el analizador…');
    const r = await post(apagar ? '/api/chat/kc-pipeline/stop' : '/api/chat/kc-pipeline/start');
    if (!r.ok) { toast(failMsg(r)); await poll(); flashPrep(); return; }
    toast(apagar ? 'Analizador apagado.' : 'Encendido. El primer análisis tarda unos segundos.');
    setTimeout(poll, 600);
  });
  $('kc-refresh').addEventListener('click', async () => {
    await post('/api/chat/kc-context/refresh');
    setTimeout(poll, 300);
  });
  $('kc-analyze').addEventListener('click', async () => {
    const r = await post('/api/chat/kc-analyze');
    toast(r.ok ? 'La IA va a mirar la pantalla en unos segundos.' : failMsg(r));
  });
  $('kc-regen').addEventListener('click', async () => {
    const r = await post('/api/chat/kc-regenerate');
    toast(r.ok ? (r.message || 'Regenerando…') : failMsg(r));
    setTimeout(poll, 800);
  });
  $('kc-apply-screen').addEventListener('click', async () => {
    toast('Cambiando la pantalla de captura…');
    const r = await post('/api/chat/kc-capture', { monitor: $('kc-monitor').value });
    toast(r.ok ? (r.message || 'Listo') : failMsg(r));
    setTimeout(poll, 1000);
  });

  $('kc-checks').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copiado ✔'; }
    catch { toast('Copialo a mano: ' + b.dataset.copy); }
  });

  $('ajustes').addEventListener('input', markDirty);
  $('ajustes').addEventListener('change', (e) => { if (e.target.name === 'kc-cad-modo') syncModo(); });
  $('kc-save').addEventListener('click', () => saveConfig(false));
  $('kc-save-regen').addEventListener('click', () => saveConfig(true));

  loadMonitors();
  loadConfig();
  poll();
  setInterval(poll, 3000);
});
