import { renderNav, renderAuthHeader, requireAuth, startStatusLoop } from './client-nav.js';

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
  const el = document.getElementById('kc-toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
}

function setPill(id, text, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'kc-pill' + (cls ? ' ' + cls : '');
}

function renderSummaries(sums) {
  const box = document.getElementById('kc-sums');
  if (!Array.isArray(sums) || sums.length === 0) {
    box.innerHTML = '<p class="kc-empty">Esperando el primer resumen del Módulo 8…</p>';
    return;
  }
  box.innerHTML = sums.map((s) => `
    <div class="kc-sum">
      <div class="kc-sum-head">
        ${s.fase ? `<span class="kc-badge">${esc(s.fase)}</span>` : ''}
        <span class="kc-time">${s.timestamp ? ago(s.timestamp * 1000) : ''}</span>
      </div>
      <p>${esc(s.resumen_actual || '—')}</p>
      ${s.contexto_previo ? `<p class="prev">antes: ${esc(s.contexto_previo)}</p>` : ''}
      ${s.tendencia_detectada ? `<p class="trend">→ ${esc(s.tendencia_detectada)}</p>` : ''}
    </div>`).join('');
}

function renderLines(lines, count, whenIso, regenerating) {
  const box = document.getElementById('kc-lines');
  document.getElementById('kc-lote-count').textContent = `${count || (lines ? lines.length : 0)} líneas`;
  document.getElementById('kc-lote-when').textContent = whenIso ? `lote ${ago(Date.parse(whenIso))}` : (regenerating ? 'regenerando…' : 'sin lote');
  if (!Array.isArray(lines) || lines.length === 0) {
    box.innerHTML = regenerating
      ? '<p class="kc-empty">⏳ Regenerando el lote con el contexto actual… (el Módulo 12 está llamando a Gemini)</p>'
      : '<p class="kc-empty">Todavía no llegó ningún lote del Módulo 12.</p>';
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
  const el = document.getElementById(elId);
  el.innerHTML = msg ? `<div class="kc-err">${esc(msg)}</div>` : '';
}

let lastCapLabel = '';

function renderCaptureLabel(p) {
  if (p.windowTitle) return `ventana "${p.windowTitle}"`;
  if (p.monitor) return `monitor ${p.monitor}`;
  return p.captureMode === 'remote' ? 'HLS del canal' : 'escritorio completo';
}

async function poll() {
  let d;
  try {
    const res = await fetch('/api/chat/kc-context', { headers: { 'Accept': 'application/json' } });
    if (!res.ok) { renderErr('kc-pipe-err', `kc-context HTTP ${res.status}`); return; }
    d = await res.json();
  } catch (e) {
    renderErr('kc-pipe-err', 'sin conexión con el servidor');
    return;
  }

  const p = d.pipeline || {};
  const big = document.getElementById('kc-big');
  if (p.blocked) { big.textContent = '■ PIPELINE BLOQUEADO (revisá los logs)'; big.className = 'big off'; }
  else if (p.running) { big.textContent = p.simulation ? '● SIMULACIÓN EN CURSO' : '● PIPELINE EN VIVO — capturando'; big.className = 'big on'; }
  else if (p.enabled) { big.textContent = '● ARRANCANDO…'; big.className = 'big warn'; }
  else { big.textContent = '■ PIPELINE APAGADO'; big.className = 'big off'; }

  const capLabel = renderCaptureLabel(p);
  setPill('kc-cap-pill', `captura: ${capLabel}`);
  lastCapLabel = capLabel;

  const chan = (d.sender && d.sender.channel) || '—';
  setPill('kc-chan-pill', `canal: ${chan}`, chan && chan !== '—' ? 'on' : 'warn');
  renderErr('kc-pipe-err', p.lastError || d.lastError || '');

  renderSummaries(d.summaries);
  renderLines(d.lines, d.lastCount, d.lastIngestAt, d.regenerating);

  const s = d.sender || {};
  document.getElementById('kc-sent').textContent = s.sent || 0;
  document.getElementById('kc-queued').textContent = s.queued || 0;
  document.getElementById('kc-failed').textContent = s.failed || 0;
  document.getElementById('kc-send-int').textContent = `cada ${s.minSeg ?? 7}-${s.maxSeg ?? 18}s${s.bearerRandom ? ' · bearer al azar' : ' · bearer rotativo'}`;
  document.getElementById('kc-send-chan').textContent = `canal: ${s.channel || '—'}`;
  document.getElementById('kc-send-last').textContent = `último envío: ${ago(s.lastSentAt)}`;
  renderErr('kc-send-err', s.lastError || '');
}

async function loadMonitors() {
  let d;
  try {
    d = await (await fetch('/api/chat/kc-monitors')).json();
  } catch { return; }
  const sel = document.getElementById('kc-monitor');
  const cur = (d.selected && d.selected.monitor) || '';
  const opts = ['<option value="">escritorio completo</option>'];
  for (const m of (d.monitors || [])) {
    opts.push(`<option value="${m.index}">monitor ${m.index} — ${m.w}×${m.h}${m.x || m.y ? ` (${m.x},${m.y})` : ''}</option>`);
  }
  sel.innerHTML = opts.join('');
  sel.value = cur;
  if (d.note) toast(d.note);
}

// ── Ajustes ─────────────────────────────────────────────────────────
async function loadConfig() {
  let d;
  try { d = await (await fetch('/api/chat/kc-config')).json(); } catch { return; }
  const g = d.gen || {};
  const s = d.send || {};
  document.getElementById('kc-categoria').value = g.categoria || 'mixto';
  const cadModo = g.modo === 'bloque' ? 'bloque' : 'goteo';
  const r = document.querySelector(`input[name="kc-cad-modo"][value="${cadModo}"]`);
  if (r) r.checked = true;
  document.getElementById('kc-cad-min').value = g.min_seg ?? 25;
  document.getElementById('kc-cad-max').value = g.max_seg ?? 70;
  document.getElementById('kc-cad-bloque').value = g.bloque_seg ?? 300;
  document.getElementById('kc-min-seg').value = s.minSeg ?? 7;
  document.getElementById('kc-max-seg').value = s.maxSeg ?? 18;
  document.getElementById('kc-bearer-random').checked = s.bearerRandom !== false;
}

function collectConfig() {
  return {
    gen: {
      categoria: document.getElementById('kc-categoria').value || 'mixto',
      modo: document.querySelector('input[name="kc-cad-modo"]:checked')?.value || 'goteo',
      min_seg: Number(document.getElementById('kc-cad-min').value) || 25,
      max_seg: Number(document.getElementById('kc-cad-max').value) || 70,
      bloque_seg: Number(document.getElementById('kc-cad-bloque').value) || 300,
    },
    send: {
      minSeg: Number(document.getElementById('kc-min-seg').value) || 7,
      maxSeg: Number(document.getElementById('kc-max-seg').value) || 18,
      bearerRandom: document.getElementById('kc-bearer-random').checked,
    },
  };
}

async function saveConfig(applyNow) {
  const payload = collectConfig();
  payload.applyNow = !!applyNow;
  const r = await post('/api/chat/kc-config', payload);
  toast(applyNow ? 'Ajustes guardados. Regenerando el lote…' : 'Ajustes guardados (se aplican al próximo lote).');
  setTimeout(poll, 600);
  return r;
}

async function post(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json().catch(() => ({}));
}

window.addEventListener('DOMContentLoaded', async () => {
  const ok = await requireAuth();
  if (!ok) return;
  renderAuthHeader('kc');
  renderNav('kc');
  startStatusLoop();

  document.getElementById('kc-start').addEventListener('click', async () => {
    toast('Arrancando el pipeline…');
    await post('/api/chat/kc-pipeline/start');
    setTimeout(poll, 600);
  });
  document.getElementById('kc-stop').addEventListener('click', async () => {
    toast('Parando el pipeline…');
    await post('/api/chat/kc-pipeline/stop');
    setTimeout(poll, 600);
  });
  document.getElementById('kc-refresh').addEventListener('click', async () => {
    await post('/api/chat/kc-context/refresh');
    setTimeout(poll, 400);
  });
  document.getElementById('kc-analyze').addEventListener('click', async () => {
    const r = await post('/api/chat/kc-analyze');
    toast(r.message || 'Analizando el contexto…');
  });
  document.getElementById('kc-regen').addEventListener('click', async () => {
    const r = await post('/api/chat/kc-regenerate');
    toast(r.message || 'Regenerando…');
    setTimeout(poll, 800);
  });
  document.getElementById('kc-apply-screen').addEventListener('click', async () => {
    const monitor = document.getElementById('kc-monitor').value;
    toast('Cambiando la pantalla de captura y reiniciando el pipeline…');
    const r = await post('/api/chat/kc-capture', { monitor });
    toast(r.message || 'Listo');
    setTimeout(poll, 1000);
  });

  document.getElementById('kc-save').addEventListener('click', () => saveConfig(false));
  document.getElementById('kc-save-regen').addEventListener('click', () => saveConfig(true));
  document.getElementById('kc-set-toggle').addEventListener('click', () => {
    const body = document.getElementById('kc-set-body');
    const open = body.hasAttribute('hidden');
    if (open) body.removeAttribute('hidden'); else body.setAttribute('hidden', '');
    document.getElementById('kc-set-caret').textContent = open ? '▾' : '▸';
  });

  loadMonitors();
  loadConfig();
  poll();
  const t = setInterval(poll, 3000);
  if (t && typeof t.unref === 'function') t.unref();
});
