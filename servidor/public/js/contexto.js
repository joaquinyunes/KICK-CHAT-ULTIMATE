// Contexto SIN IA: situaciones del stream + detector por palabras clave (lógica pura, sin DOM).
// Una situación dice qué sección de Temáticas usar y cómo reconocer, en un texto pegado, que está pasando eso.
import { norm } from './tematicas/engine.js';

/**
 * id: clave · tecla: atajo (solo si no se está escribiendo) · seccion/modo: dónde cae en Temáticas
 * cats: nombres de categoría del glosario que cuentan como "de esta situación" (se compara sin tildes, por contiene)
 * kw: palabras o frases (sin tildes) que delatan la situación en un texto; "x\d+" no hace falta: se detecta aparte
 */
export const SITUACIONES = [
  { id: 'pendiente', label: 'Pendiente', emoji: '⏳', tecla: '1', seccion: 'slots', modo: 'pendiente',
    cats: ['pendiente', 'espera', 'jugando'], kw: ['spin', 'spins', 'jugando', 'girando', 'apuesta', 'arranca', 'a ver', 'probando'] },
  { id: 'bien', label: 'Pagó', emoji: '✅', tecla: '2', seccion: 'slots', modo: 'bien',
    cats: ['bien', 'pago', 'gano', 'ganancia', 'festejo'], kw: ['pago', 'gano', 'ganancia', 'multiplicador', 'jackpot', 'cobro', 'salio'] },
  { id: 'mal', label: 'No pagó', emoji: '❌', tecla: '3', seccion: 'slots', modo: 'mal',
    cats: ['mal', 'perdio', 'perdida', 'queja', 'bronca'], kw: ['perdio', 'perdi', 'nada', 'se comio', 'cero', 'no pago', 'quemo', 'barrio', 'sin premio'] },
  { id: 'bonus', label: 'Bonus', emoji: '🎁', tecla: '4', seccion: 'bonus', modo: 'base',
    cats: ['bonus', 'scatter', 'giros'], kw: ['bonus', 'scatter', 'scatters', 'giros gratis', 'free spin', 'free spins', 'compra de bonus', 'retrigger'] },
  { id: 'premio', label: 'Premio grande', emoji: '💥', tecla: '5', seccion: 'premio', modo: 'base',
    cats: ['premio', 'big win', 'hype', 'grande'], kw: ['premio grande', 'mega', 'max win', 'maxwin', 'big win', 'record', 'brutal', 'historico', 'locura'] },
  { id: 'apuestas', label: 'Apuestas', emoji: '🧾', tecla: '6', seccion: 'apuestas', modo: 'base',
    cats: ['apuesta', 'deporte', 'partido', 'futbol'], kw: ['partido', 'cuota', 'ticket', 'combinada', 'gol', 'empate', 'arbitro', 'liga'] },
  { id: 'pedidos', label: 'Pedidos', emoji: '🙏', tecla: '7', seccion: 'pedidos', modo: 'base',
    cats: ['pedido', 'peticion'], kw: ['pedido', 'pide', 'piden', 'pone', 'mostra', 'saluda', 'juga la'] },
  { id: 'charla', label: 'Charla', emoji: '💬', tecla: '8', seccion: 'charla', modo: 'base',
    cats: ['charla', 'random', 'irl', 'general'], kw: ['charla', 'hablando', 'contando', 'anecdota', 'sueno', 'comida', 'clima'] },
  { id: 'sorteo', label: 'Sorteos', emoji: '🎉', tecla: '9', seccion: 'sorteo', modo: 'base',
    cats: ['sorteo', 'evento', 'raid', 'sub', 'follow'], kw: ['sorteo', 'raid', 'sub', 'follow', 'seguidor', 'giveaway', 'donacion', 'ganador', 'meta'] },
  { id: 'pausa', label: 'Pausa', emoji: '⏸', tecla: '0', seccion: 'pausa', modo: 'base',
    cats: ['pausa', 'afk', 'tecnico', 'falla'], kw: ['pausa', 'ya vuelvo', 'ya vuelve', 'se fue', 'afk', 'lag', 'sin audio', 'se cayo', 'se congelo', 'reinicia', 'volvio'] },
  { id: 'saludos', label: 'Saludos', emoji: '👋', tecla: '', seccion: 'saludos', modo: 'base',
    cats: ['saludo', 'bienvenida', 'inicio'], kw: ['hola', 'buenas', 'empieza', 'arranco', 'inicio', 'bienvenidos', 'recien llego'] },
  { id: 'cierre', label: 'Cierre', emoji: '🏁', tecla: '', seccion: 'cierre', modo: 'base',
    cats: ['cierre', 'despedida', 'fin'], kw: ['chau', 'termina', 'despedida', 'cierre', 'fin del stream', 'nos vamos', 'hasta manana'] },
];

export const sitById = (id) => SITUACIONES.find((s) => s.id === id) || null;

/** ¿`kw` aparece en `n` (ya normalizado) como palabra o inicio de palabra? */
export function hasWord(n, kw) {
  const k = norm(kw);
  if (!k) return false;
  return (' ' + n).includes(' ' + k);
}

/**
 * Qué situación describe un texto: [{ sit, score, hits }] de mayor a menor (solo las que tienen al menos una coincidencia).
 * "x500" / "500x" suman a Pagó/Premio grande; no entiende frases, solo palabras: ante empate gana la primera de la lista.
 */
export function detectar(texto) {
  const n = norm(texto);
  if (!n) return [];
  const out = [];
  for (const sit of SITUACIONES) {
    const hits = sit.kw.filter((k) => hasWord(n, k));
    let score = hits.length;
    if ((sit.id === 'bien' || sit.id === 'premio') && /(^| )(x\d{2,}|\d{2,}x)( |$)/.test(n)) { score += 1; hits.push('multiplicador'); }
    if (score > 0) out.push({ sit, score, hits });
  }
  return out.sort((a, b) => b.score - a.score);
}
