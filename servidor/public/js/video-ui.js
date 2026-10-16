import { sendMessage } from './bridge-client.js';
import { renderNav, renderAuthHeader, requireAuth, startStatusLoop } from './client-nav.js';
import { parseVideoText, buildSchedule, fmtClock, parseClock, MIN_MS } from './video-schedule.js';

// Video: los comentarios (con MIN 1, MIN 2… del Simulador) salen al chat en el minuto del video que les toca.
// Un reloj propio hace de "video": si se pausa, no sale nada; nunca sale un mensaje del minuto 20 estando en el 10.
// El envío corre en el navegador (igual que la página Chat): hay que dejar esta pestaña abierta.

const STORE_KEY = 'scb_video';
const MAX_LATE_MS = 25000;   // un mensaje con más retraso que esto (pestaña congelada, salto del reloj) se omite en vez de amontonarse
const RESUME_WINDOW_MS = 90000; // recargar/cambiar de pestaña dentro de este margen no pierde el reloj

const $ = (id) => document.getElementById(id);
const esc = (s) => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));

// ─── Estado ──────────────────────────────────────────────────────────────────
let channelName = '';
let chatroomId = '';
let text = '';
let duracion = 0;                       // minutos; 0 = tomar el último minuto con mensajes
let parsed = { threads: [], hasHeaders: false };
let sched = { events: [], minutes: new Map(), maxMinute: 0, total: 0, needsDuration: false };
const clock = { running: false, base: 0, t0: 0 };
const done = new Set();                 // keys de mensajes ya enviados u omitidos
const queued = new Set();               // keys esperando su turno de envío
const queue = [];
let pumping = false;
let sentTotal = 0, failedTotal = 0, skippedTotal = 0;
let lastSecond = -1;
let worker = null;
let fallbackTimer = null;

const now = () => clock.base + (clock.running ? performance.now() - clock.t0 : 0);
const durEf = () => (duracion > 0 ? duracion : sched.maxMinute);
const endMs = () => durEf() * MIN_MS;

// ─── Persistencia (no crítica) ───────────────────────────────────────────────
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, text, duracion, time: Math.round(now()), running: clock.running, savedAt: Date.now() }));
  } catch { /* sin storage */ }
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!s || typeof s !== 'object') return null;
    text = typeof s.text === 'string' ? s.text : '';
    duracion = Number.isFinite(s.duracion) ? s.duracion : 0;
    return s;
  } catch { return null; }
}

function normalizeChannel(input) {
  if (!input) return '';
  let s = String(input).trim();
  try { s = new URL(s).pathname; } catch { /* no era URL */ }
  s = s.replace(/^https?:\/\/(www\.)?kick\.com\//i, '');
  return s.split('?')[0].split('#')[0].replace(/^\/+|\/+$/g, '');
}
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('scb_settings') || '{}');
    if (saved.channelName) channelName = normalizeChannel(saved.channelName);
    if (saved.chatroomId) chatroomId = saved.chatroomId;
  } catch { /* ignorar */ }
}

// ─── Agenda ──────────────────────────────────────────────────────────────────
function rebuild() {
  parsed = parseVideoText(text);
  sched = buildSchedule(parsed, duracion);
  renderSummary();
  renderStrip();
  renderClock();
}

// Marca como hechos los mensajes anteriores a `ms` (saltar hacia adelante / retomar): nunca "des-hace" un envío.
function markBefore(ms) {
  for (const e of sched.events) { if (e.t < ms) done.add(e.key); else break; }
}

// ─── Reloj ───────────────────────────────────────────────────────────────────
function startTicker() {
  if (worker || fallbackTimer) return;
  try {
    worker = new Worker('js/video-timer-worker.js');
    worker.onmessage = tick;
    worker.postMessage('start');
  } catch {
    worker = null;
    fallbackTimer = setInterval(tick, 250); // sin Worker: se frena con la pestaña en segundo plano
  }
}
function stopTicker() {
  if (worker) { worker.postMessage('stop'); worker.terminate(); worker = null; }
  if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = null; }
}

function play() {
  if (clock.running) return;
  if (!channelName && !chatroomId) { alert('Configurá el canal en Ajustes.'); return; }
  if (sched.needsDuration) { setStatus('Estos comentarios no traen MIN: poné la duración del video para repartirlos.', 'err'); return; }
  if (!sched.events.length) { setStatus('Pegá primero los comentarios.', 'err'); return; }
  if (endMs() > 0 && now() >= endMs()) { done.clear(); clock.base = 0; } // ya había terminado: arranca de nuevo
  clock.t0 = performance.now();
  clock.running = true;
  startTicker();
  setStatus('En marcha. Seguí el video con este reloj.', 'ok');
  save();
  renderClock();
}

function pause(msg) {
  if (!clock.running) return;
  clock.base = now();
  clock.running = false;
  stopTicker();
  queue.length = 0; queued.clear();          // lo que esperaba turno vuelve a "pendiente" y sale al reanudar
  setStatus(msg || 'Pausado. No se envía nada hasta que reanudes.');
  save();
  renderClock();
}

function stop() {
  const wasRunning = clock.running;
  if (wasRunning) { clock.running = false; stopTicker(); }
  clock.base = 0;
  done.clear(); queue.length = 0; queued.clear();
  setStatus('Detenido en 0:00. Al iniciar, todo vuelve a salir desde el principio.');
  save();
  renderClock(); renderStrip();
}

function seek(ms) {
  const end = endMs();
  ms = Math.max(0, end > 0 ? Math.min(ms, end) : ms);
  if (clock.running) clock.t0 = performance.now();
  clock.base = ms;
  markBefore(ms);                            // lo que quedó atrás no se reenvía ni se manda de golpe
  queue.length = 0; queued.clear();
  setStatus('Reloj en ' + fmtClock(ms) + '.');
  lastSecond = -1;
  save();
  renderClock(); renderStrip();
}

function tick() {
  const t = now();
  const end = endMs();
  if (clock.running && end > 0 && t >= end) {   // terminó el video
    clock.base = end; clock.running = false; stopTicker();
    setStatus('Fin del video (' + fmtClock(end) + ').', 'ok');
    save();
  }
  if (clock.running) {
    for (const e of sched.events) {
      if (e.t > t) break;
      if (done.has(e.key) || queued.has(e.key)) continue;
      if (t - e.t > MAX_LATE_MS) { done.add(e.key); skippedTotal++; continue; }
      queued.add(e.key); queue.push(e);
    }
    if (queue.length) pump();
  }
  const sec = Math.floor(t / 1000);
  if (sec !== lastSecond || !clock.running) { lastSecond = sec; renderClock(); if (sec % 2 === 0) save(); }
}

// ─── Envío ───────────────────────────────────────────────────────────────────
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length && clock.running) {
      const e = queue.shift();
      let res;
      try { res = await sendMessage({ channel: channelName, message: e.text, chatroom_id: chatroomId || undefined }); }
      catch (err) { res = { ok: false, error: err && err.message, status: 0 }; }
      done.add(e.key); queued.delete(e.key);
      if (res && res.ok) sentTotal++; else failedTotal++;
      dotKick(res && res.ok);
      logSend(e, res);
      renderMetrics();
    }
  } finally {
    pumping = false;
    if (!clock.running) { queue.length = 0; queued.clear(); }
  }
}

function logSend(e, res) {
  const box = $('vd-log');
  if (!box) return;
  if (box.querySelector('.empty-state')) box.innerHTML = '';
  const ok = !!(res && res.ok);
  const row = document.createElement('div');
  row.className = 'log-row' + (ok ? '' : ' err');
  row.innerHTML =
    '<span class="log-time">' + new Date().toLocaleTimeString('es-AR', { hour12: false }) + '</span>' +
    '<span class="log-tag" title="minuto del video">' + fmtClock(e.t) + '</span>' +
    '<span class="log-bot">' + esc(ok ? (res.username || '?') : 'ERR ' + ((res && res.status) || '?')) + '</span>' +
    '<span class="log-msg">' + esc(e.text) + '</span>';
  box.insertBefore(row, box.firstChild);
  while (box.children.length > 120) box.removeChild(box.lastChild);
}

// ─── Render ──────────────────────────────────────────────────────────────────
function setStatus(msg, kind) {
  const el = $('vd-status');
  el.textContent = msg || '';
  el.className = 'cc-status' + (kind ? ' ' + kind : '');
}

function dotKick(ok) { $('vd-kick-dot').className = 'status-dot ' + (ok ? 'status-connected' : 'status-disconnected'); }

function renderMetrics() {
  $('vd-m-total').textContent = sched.total;
  $('vd-m-sent').textContent = sentTotal;
  $('vd-m-failed').textContent = failedTotal;
  $('vd-m-skipped').textContent = skippedTotal;
  const ch = $('vd-channel');
  if (channelName) { ch.textContent = channelName; ch.classList.remove('unset'); }
  else if (chatroomId) { ch.textContent = 'chatroom ' + chatroomId; ch.classList.remove('unset'); }
  else { ch.textContent = 'sin configurar'; ch.classList.add('unset'); }
}

function renderSummary() {
  const dh = $('vd-dur-hint');
  dh.textContent = duracion > 0 ? '= ' + fmtClock(duracion * MIN_MS) : (sched.maxMinute ? 'auto: ' + sched.maxMinute + ' min (último minuto con mensajes)' : '');

  const sum = $('vd-summary');
  const warn = [];
  if (!sched.total) {
    sum.textContent = 'Sin comentarios cargados.';
  } else if (sched.needsDuration) {
    sum.textContent = sched.total + ' mensajes sin encabezados MIN.';
    warn.push('⚠️ Poné la duración del video: sin MIN 1, MIN 2… se reparten parejo a lo largo de ella.');
  } else {
    const ms = [...sched.minutes.keys()];
    sum.textContent = sched.total + ' mensajes · ' + parsed.threads.length + ' hilos · minutos ' + Math.min(...ms) + '–' + sched.maxMinute + (sched.minutes.size !== sched.maxMinute ? ' (' + sched.minutes.size + ' con mensajes)' : '');
    if (duracion > 0 && sched.maxMinute > duracion) warn.push('⚠️ Hay mensajes hasta el minuto ' + sched.maxMinute + ' pero el video dura ' + duracion + ': lo que pasa de la duración no se enviará.');
    if (duracion > 0 && parsed.hasHeaders) {
      const vacios = [];
      for (let m = 1; m <= duracion && vacios.length < 6; m++) if (!sched.minutes.has(m)) vacios.push(m);
      if (vacios.length) warn.push('ℹ️ Minutos sin comentarios: ' + vacios.join(', ') + (vacios.length === 6 ? '…' : '') + '.');
    }
  }
  $('vd-warn').textContent = warn.join('\n');
  renderMetrics();
}

function typicalCount() {
  const freq = new Map();
  for (const c of sched.minutes.values()) freq.set(c, (freq.get(c) || 0) + 1);
  let best = 0, bestN = 0;
  for (const [c, n] of freq) if (n > bestN) { best = c; bestN = n; }
  return bestN >= 2 ? best : 0; // sin una cantidad que se repita no hay "normal" contra qué comparar
}

function renderStrip() {
  const box = $('vd-strip');
  const n = durEf();
  if (!n) { box.innerHTML = '<div class="empty-state">Sin minutos todavía.</div>'; return; }
  const typ = typicalCount();
  const cells = [];
  for (let m = 1; m <= n; m++) {
    const c = sched.minutes.get(m) || 0;
    const off = typ && c !== typ ? ' off' : '';
    cells.push('<div class="vd-min' + off + '" data-m="' + m + '" title="Minuto ' + m + ': ' + c + ' mensajes. Clic para ir ahí."><b>' + m + '</b><span>' + c + '</span></div>');
  }
  box.innerHTML = cells.join('');
  paintStrip();
}

function paintStrip() {
  const cur = Math.floor(now() / MIN_MS) + 1;
  $('vd-strip').querySelectorAll('.vd-min').forEach((el) => {
    const m = +el.dataset.m;
    el.classList.toggle('past', m < cur);
    el.classList.toggle('cur', m === cur);
  });
}

function renderClock() {
  const t = now();
  const end = endMs();
  $('vd-now').textContent = fmtClock(t);
  $('vd-end').textContent = fmtClock(end);
  $('vd-bar').style.width = (end > 0 ? Math.min(100, (t / end) * 100) : 0) + '%';
  const p = $('vd-clock-panel');
  const state = clock.running ? 'run' : t > 0 ? 'pause' : 'stop';
  p.classList.toggle('is-running', state === 'run');
  p.classList.toggle('is-paused', state === 'pause');
  $('vd-badge').textContent = state === 'run' ? 'en marcha' : state === 'pause' ? 'pausado' : 'detenido';
  $('vd-play').disabled = clock.running;
  $('vd-play').textContent = state === 'pause' ? '▶ Reanudar' : '▶ Iniciar';
  $('vd-pause').disabled = !clock.running;
  paintStrip();

  const nxt = sched.events.find((e) => e.t >= t && !done.has(e.key) && !queued.has(e.key));
  $('vd-next').innerHTML = nxt
    ? 'Próximo: <b>' + fmtClock(nxt.t) + '</b> (en ' + Math.max(0, Math.ceil((nxt.t - t) / 1000)) + ' s) — ' + esc(nxt.text.slice(0, 70))
    : (sched.events.length ? 'No quedan mensajes por enviar.' : '');
}

// ─── Init ────────────────────────────────────────────────────────────────────
function bind() {
  $('vd-text').addEventListener('input', (e) => { text = e.target.value; rebuild(); save(); });
  $('vd-duracion').addEventListener('input', (e) => {
    const n = parseFloat(e.target.value);
    duracion = Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 600) : 0;
    rebuild(); save();
  });
  $('vd-clear').addEventListener('click', () => {
    if (text.trim() && !window.confirm('¿Vaciar los comentarios cargados?')) return;
    if (clock.running) pause();
    text = ''; $('vd-text').value = '';
    done.clear();
    rebuild(); save();
  });
  $('vd-play').addEventListener('click', play);
  $('vd-pause').addEventListener('click', () => pause());
  $('vd-stop').addEventListener('click', stop);
  const go = () => {
    const ms = parseClock($('vd-seek').value);
    if (Number.isNaN(ms)) { setStatus('Escribí el tiempo como mm:ss (ej: 12:30) o en segundos.', 'err'); return; }
    seek(ms); $('vd-seek').value = '';
  };
  $('vd-go').addEventListener('click', go);
  $('vd-seek').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  $('vd-back').addEventListener('click', () => seek(now() - 10000));
  $('vd-fwd').addEventListener('click', () => seek(now() + 10000));
  $('vd-strip').addEventListener('click', (e) => {
    const cell = e.target.closest('.vd-min');
    if (cell) seek((+cell.dataset.m - 1) * MIN_MS);
  });
  $('vd-clear-log').addEventListener('click', () => { $('vd-log').innerHTML = '<div class="empty-state">Todavía no se envió nada.</div>'; });
  window.addEventListener('pagehide', save);
  window.addEventListener('beforeunload', save);
}

window.addEventListener('DOMContentLoaded', async () => {
  const ok = await requireAuth();
  if (!ok) return;
  renderAuthHeader('video');
  renderNav('video');
  startStatusLoop();

  loadSettings();
  const saved = load();
  $('vd-text').value = text;
  $('vd-duracion').value = duracion || '';
  bind();
  rebuild();

  // Retoma el reloj si se recargó o se volvió de otra pestaña hace poco.
  if (saved && Number.isFinite(saved.time) && sched.events.length) {
    const gap = Date.now() - (saved.savedAt || 0);
    const resume = saved.running && gap >= 0 && gap < RESUME_WINDOW_MS;
    clock.base = Math.round(saved.time + (resume ? gap : 0));
    markBefore(clock.base);
    if (resume) {
      clock.t0 = performance.now();
      clock.running = true;
      startTicker();
      setStatus('Reloj retomado en ' + fmtClock(clock.base) + '.', 'ok');
    } else if (clock.base > 0) {
      setStatus('Pausado en ' + fmtClock(clock.base) + '. Reanudá cuando el video siga.');
    }
    renderClock();
  }
  renderMetrics();
});
