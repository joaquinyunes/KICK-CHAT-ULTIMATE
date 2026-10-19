// Glosario propio (10k–20k entradas) SIN IA: importar, buscar, filtrar por situación y elegir sin repetir.
// Una línea = una palabra o frase.  Formatos (se pueden mezclar):
//   texto
//   categoria|texto
//   texto = significado            (el significado es solo una nota; lo que sale al chat es el texto)
//   categoria|texto = significado
// Lógica pura salvo cargar()/guardar() (localStorage, protegido).
import { norm } from './tematicas/engine.js';
import { hasWord } from './contexto.js';

export const KEY = 'sc_glosario_v1';
export const MAX_LEN = 200;        // largo máximo de una entrada
export const MAX_ITEMS = 50000;    // tope duro: más que eso no entra en localStorage cómodo
const MIN_FILTRADAS = 5;           // por debajo de esto se pasa a la estrategia siguiente

const item = (t, c = '', s = '') => ({ t, c, s, n: norm(t), nc: norm(c) });

/** Texto → { items, descartadas }. No deduplica contra lo ya cargado: eso lo hace mezclar(). */
export function parseGlosario(text) {
  const items = [];
  let descartadas = 0;
  for (const raw of String(text || '').split(/\r?\n/)) {
    let l = raw.replace(/<<<|>>>/g, '').trim();
    if (!l || l.startsWith('#') || l === '---') continue;
    let c = '';
    const sep = l.indexOf('|') >= 0 ? '|' : (l.indexOf('\t') >= 0 ? '\t' : '');
    if (sep) { const i = l.indexOf(sep); c = l.slice(0, i).trim(); l = l.slice(i + 1).trim(); }
    let s = '';
    const eq = l.indexOf(' = ');
    if (eq > 0) { s = l.slice(eq + 3).trim(); l = l.slice(0, eq).trim(); }
    if (!l || l.length > MAX_LEN || c.length > 40) { descartadas++; continue; }
    items.push(item(l, c, s));
  }
  return { items, descartadas };
}

/** Une lo nuevo con lo que ya había (sin repetidos por texto normalizado). modo: 'agregar' | 'reemplazar'. */
export function mezclar(base, nuevos, modo = 'agregar') {
  const out = modo === 'reemplazar' ? [] : base.slice();
  const seen = new Set(out.map((i) => i.n));
  let repetidas = 0;
  for (const i of nuevos) {
    if (!i.n || seen.has(i.n)) { repetidas++; continue; }
    if (out.length >= MAX_ITEMS) break;
    seen.add(i.n);
    out.push(i);
  }
  return { items: out, repetidas };
}

/** [[categoria, cantidad]] de mayor a menor; '' = sin categoría. */
export function categorias(items) {
  const m = new Map();
  for (const i of items) m.set(i.c, (m.get(i.c) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}

/** Entradas cuyo texto, categoría o significado contienen `q` (sin tildes ni mayúsculas). */
export function buscar(items, q, { cat = null, limit = 100 } = {}) {
  const k = norm(q);
  const out = [];
  for (const i of items) {
    if (cat !== null && i.c !== cat) continue;
    if (k && !(i.n.includes(k) || i.nc.includes(k) || norm(i.s).includes(k))) continue;
    out.push(i);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Entradas que van con una situación. Orden de criterios:
 *   1) categoría del glosario que se parezca a las `cats` de la situación
 *   2) el texto contiene alguna palabra clave de la situación
 *   3) todo el glosario
 * Devuelve { lista, por } para poder decirle al usuario por qué salió eso.
 */
export function filtrarPorSituacion(items, sit) {
  if (!sit) return { lista: items, por: 'todo' };
  const porCat = items.filter((i) => i.nc && sit.cats.some((k) => i.nc.includes(k)));
  if (porCat.length >= MIN_FILTRADAS) return { lista: porCat, por: 'categoría' };
  const porKw = items.filter((i) => sit.kw.some((k) => hasWord(i.n, k)));
  if (porKw.length >= MIN_FILTRADAS) return { lista: porKw, por: 'palabras clave' };
  return { lista: items, por: 'todo' };
}

/** n entradas al azar sin repetir (Fisher-Yates parcial); `used` (Set de n) se actualiza y se vacía solo al agotarse. */
export function elegir(lista, n, { used = new Set(), rng = Math.random } = {}) {
  const libres = lista.filter((i) => !used.has(i.n));
  const pool = libres.length >= n ? libres : lista;
  if (pool === lista) used.clear();
  const a = pool.slice();
  const k = Math.min(n, a.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  const sel = a.slice(0, k);
  for (const i of sel) used.add(i.n);
  return sel;
}

// ── Persistencia (compacta: [texto, categoria, significado]) ──────────────────
export function cargar() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(Array.isArray).map(([t, c, s]) => item(String(t || ''), String(c || ''), String(s || ''))).filter((i) => i.n) : [];
  } catch { return []; }
}

/** true si se guardó; false si el navegador no dejó (sin espacio o sin storage). */
export function guardar(items) {
  try { localStorage.setItem(KEY, JSON.stringify(items.map((i) => [i.t, i.c, i.s]))); return true; }
  catch { return false; }
}

export const aTexto = (items) => items.map((i) => (i.c ? i.c + '|' : '') + i.t + (i.s ? ' = ' + i.s : '')).join('\n');
