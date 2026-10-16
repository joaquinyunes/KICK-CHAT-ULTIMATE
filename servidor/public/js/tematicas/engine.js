// Lógica pura de Temáticas (sin DOM).
//
// Formato de una sección: hilos separados por una línea "---".
//   la primera línea del hilo abre la conversación y las demás le responden.
//   Si el texto no tiene ningún "---", cada renglón es un mensaje suelto.
//   {variable}: hueco que se completa arriba. Si falta en la línea que abre, el hilo no sale;
//   si falta en una respuesta, solo se saltea esa respuesta.
//   "# texto" es un comentario y no se envía.

export const VAR_RE = /\{([^{}|]+?)\}/g;
export const varKey = (name) => String(name).trim().toLowerCase();

/** Clave para comparar mensajes: sin mayúsculas, tildes, signos ni espacios de más. */
export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.,;:…"'()]/g, '').replace(/\s+/g, ' ').trim();
}

/** Texto → [[línea, línea…], …] */
export function parseHilos(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim());
  const conHilos = lines.includes('---');
  const out = [];
  let cur = [];
  for (const l of lines) {
    if (l === '---') { if (cur.length) out.push(cur); cur = []; continue; }
    if (!l || l.startsWith('#')) continue;
    if (conHilos) cur.push(l); else out.push([l]);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Variables de un texto, en orden de aparición. */
export function varsIn(text) {
  const seen = [];
  for (const m of String(text || '').matchAll(VAR_RE)) {
    const k = varKey(m[1]);
    if (k && !seen.includes(k)) seen.push(k);
  }
  return seen;
}

/** Reemplaza los huecos de una línea; null si alguno quedó vacío. */
export function resolve(tpl, vars) {
  let missing = false;
  const out = tpl.replace(VAR_RE, (_, name) => {
    const v = String((vars || {})[varKey(name)] ?? '').trim();
    if (!v) { missing = true; return ''; }
    return v;
  });
  return missing ? null : out.replace(/\s+/g, ' ').trim();
}

/** Un hilo con las variables puestas; null si no puede salir. */
export function resolveHilo(hilo, vars) {
  const first = resolve(hilo[0], vars);
  if (first === null) return null;
  const rest = hilo.slice(1).map((l) => resolve(l, vars)).filter((l) => l !== null);
  return [first, ...rest];
}

/** Noticias pegadas (una por renglón) → lista limpia. */
export function parseNoticias(text) {
  return String(text || '').split('\n').map((l) => l.trim().replace(/[.;]+$/, '')).filter(Boolean);
}

/**
 * Hilos listos para enviar: [{ key, lines }].
 * key identifica la plantilla (así un hilo no se repite aunque cambien las variables).
 * {noticia} usa `noticia` (la elige quien llama); sin noticia esos hilos no salen.
 */
export function buildHilos(text, vars, noticia = '') {
  const out = [];
  const seen = new Set();
  for (const h of parseHilos(text)) {
    const key = norm(h.join(' / '));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const lines = resolveHilo(h, { ...vars, noticia });
    if (lines) out.push({ key, lines });
  }
  return out;
}

/** Cantidad de mensajes de una lista de hilos. */
export const countMsgs = (hilos) => hilos.reduce((a, h) => a + h.lines.length, 0);

/**
 * Próximo hilo sin repetir (`used` = Set de keys, se modifica).
 * Si ya salieron todos, se vacía la memoria de esta sección y vuelve a empezar.
 * `skip` = keys que no se pueden elegir (ya están en la cola).
 * `enOrden` = el primero libre según el orden del texto; si no, uno al azar. → { hilo, reset } | null
 */
export function pickHilo(hilos, used, skip = new Set(), { enOrden = false, rng = Math.random } = {}) {
  if (!hilos.length) return null;
  let reset = false;
  let libres = hilos.filter((h) => !used.has(h.key) && !skip.has(h.key));
  if (!libres.length) {
    for (const h of hilos) used.delete(h.key);
    libres = hilos.filter((h) => !skip.has(h.key));
    if (!libres.length) return null;
    reset = true;
  }
  return { hilo: enOrden ? libres[0] : libres[Math.floor(rng() * libres.length)], reset };
}
