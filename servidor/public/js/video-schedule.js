// Parseo y agenda de los comentarios de un video. Sin DOM ni red: se puede probar en Node (test/video-schedule.test.ts).
//
// Texto de entrada (lo que devuelve la IA con el prompt del Simulador en modo video):
//   MIN 1            ← encabezado: el minuto 1 del video cubre de 0:00 a 0:59
//   mensaje que abre un hilo
//   respuesta
//   ---              ← separa hilos (también sirven líneas en blanco y KICKCHAT123456)
//   otro hilo
//   MIN 2
//   ...
// Sin encabezados MIN se reparte parejo a lo largo de la duración indicada.

export const MIN_MS = 60000;
export const MAX_MSG_LEN = 500; // largo máximo de un mensaje de Kick

const HEADER_RE = /^[\s[(#*=\-–—]*MIN(?:UTO)?\.?\s*(\d{1,3})\s*[\])#*=\-–—:.\s]*$/i;
const SEP_RE = /^\s*(?:-{3,}|={3,}|\*{3,}|_{3,}|KICKCHAT123456)\s*$/;

// Margen dentro de cada minuto: nada sale en el primer segundo ni pegado al minuto siguiente.
const EDGE_START = 1200;
const EDGE_END = 58500;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Azar determinista: el mismo texto da siempre la misma agenda (así una recarga o un texto agregado no reordena lo ya programado).
function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Texto pegado → hilos { minute: number|null, lines: string[] }. minute null = sin encabezado. */
export function parseVideoText(text) {
  const threads = [];
  let minute = null;
  let cur = [];
  let hasHeaders = false;
  let hasBreaks = false; // separadores o líneas en blanco entre mensajes
  const close = () => {
    if (cur.length) threads.push({ minute, lines: cur });
    cur = [];
  };
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    const h = HEADER_RE.exec(line);
    if (h) { close(); minute = Math.max(1, parseInt(h[1], 10)); hasHeaders = true; continue; }
    if (line === '' || SEP_RE.test(line)) { if (cur.length) hasBreaks = true; close(); continue; }
    cur.push(line.slice(0, MAX_MSG_LEN));
  }
  close();

  // Sin separadores en todo el texto es una lista plana: cada línea es un mensaje suelto.
  const out = hasBreaks
    ? threads
    : threads.flatMap((t) => t.lines.map((l) => ({ minute: t.minute, lines: [l] })));
  return { threads: out, hasHeaders };
}

function scheduleMinute(minute, threads) {
  const base = (minute - 1) * MIN_MS;
  const k = threads.length;
  const room = EDGE_END - EDGE_START;
  const events = [];
  threads.forEach((lines, i) => {
    const r = rng(hash(minute + '|' + i + '|' + lines[0]));
    // Pausa entre una línea y la siguiente del hilo. Irregular a propósito: 1 de cada
    // 4 sale casi pegada (una ráfaga: la misma persona manda otro mensaje al toque o
    // alguien reacciona en el acto) y el resto tarda lo que tarda leer y contestar.
    let gaps = lines.slice(1).map(() => (r() < 0.25 ? 900 + r() * 1600 : 2500 + r() * 6500));
    let span = gaps.reduce((a, b) => a + b, 0);
    if (span > room) { const f = room / span; gaps = gaps.map((g) => g * f); span = room; }
    const slot = room / k;
    let start = EDGE_START + i * slot + r() * slot * 0.85; // los hilos se reparten por el minuto y se pisan entre sí
    start = Math.max(EDGE_START, Math.min(start, EDGE_END - span));
    let t = start;
    lines.forEach((text, j) => {
      if (j > 0) t += gaps[j - 1];
      events.push({ t: base + Math.round(t), text, minute, key: minute + '|' + i + '|' + j + '|' + hash(text).toString(36) });
    });
  });
  return events;
}

/**
 * Hilos → agenda. Devuelve { events, minutes, maxMinute, total, needsDuration }.
 * events: [{ t (ms de video), text, minute, key }] ordenados por t. minutes: Map minuto → cantidad de mensajes.
 * duracionMin solo hace falta si el texto no trae encabezados MIN.
 */
export function buildSchedule(parsed, duracionMin = 0) {
  const { threads, hasHeaders } = parsed;
  const total = threads.reduce((a, t) => a + t.lines.length, 0);
  if (!total) return { events: [], minutes: new Map(), maxMinute: 0, total: 0, needsDuration: false };

  let placed;
  if (hasHeaders) {
    placed = threads.map((t) => ({ minute: t.minute ?? 1, lines: t.lines }));
  } else {
    if (!(duracionMin > 0)) return { events: [], minutes: new Map(), maxMinute: 0, total, needsDuration: true };
    let cum = 0;
    placed = threads.map((t) => {
      const minute = Math.min(duracionMin, 1 + Math.floor((cum / total) * duracionMin));
      cum += t.lines.length;
      return { minute, lines: t.lines };
    });
  }

  const byMinute = new Map();
  for (const t of placed) {
    if (!byMinute.has(t.minute)) byMinute.set(t.minute, []);
    byMinute.get(t.minute).push(t.lines);
  }
  const events = [];
  const minutes = new Map();
  for (const [m, list] of [...byMinute.entries()].sort((a, b) => a[0] - b[0])) {
    const evs = scheduleMinute(m, list);
    minutes.set(m, evs.length);
    events.push(...evs);
  }
  events.sort((a, b) => a.t - b.t);
  return { events, minutes, maxMinute: Math.max(...minutes.keys()), total, needsDuration: false };
}

/** ms → "m:ss" (o "h:mm:ss" si pasa de la hora). */
export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "12:34", "1:02:03" o "754" (segundos) → ms. NaN si no se entiende. */
export function parseClock(str) {
  const s = String(str || '').trim();
  if (!s) return NaN;
  const parts = s.split(':').map((x) => x.trim());
  if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return NaN;
  const n = parts.map(Number);
  const sec = n.length === 1 ? n[0] : n.length === 2 ? n[0] * 60 + n[1] : n[0] * 3600 + n[1] * 60 + n[2];
  return sec * 1000;
}
