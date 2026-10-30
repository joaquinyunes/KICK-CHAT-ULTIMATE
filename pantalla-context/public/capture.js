// Funciones puras del lado del navegador (sin DOM) para poder probarlas con node --test.

export const MAX_SIDE = 1568; // por encima de esto la API reduce la imagen igualmente
export const MIN_REGION_PX = 32;

const clamp01 = (n) => Math.min(1, Math.max(0, n));

// Dos puntos normalizados (0..1) -> rectángulo {x, y, w, h} normalizado.
export function normalizeRect(a, b) {
  const x1 = clamp01(Math.min(a.x, b.x));
  const y1 = clamp01(Math.min(a.y, b.y));
  const x2 = clamp01(Math.max(a.x, b.x));
  const y2 = clamp01(Math.max(a.y, b.y));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// Rectángulo normalizado (o null = pantalla completa) -> píxeles del vídeo original.
export function toSourceRect(selection, videoWidth, videoHeight) {
  const s = selection ?? { x: 0, y: 0, w: 1, h: 1 };
  const x = Math.round(s.x * videoWidth);
  const y = Math.round(s.y * videoHeight);
  const w = Math.min(videoWidth - x, Math.round(s.w * videoWidth));
  const h = Math.min(videoHeight - y, Math.round(s.h * videoHeight));
  return { x, y, w, h };
}

export function isRegionTooSmall(rect) {
  return rect.w < MIN_REGION_PX || rect.h < MIN_REGION_PX;
}

export const MAX_UPSCALE = 3; // ampliar más que esto solo agranda el desenfoque

// Tamaño de salida: conserva la proporción y limita el lado largo a `maxSide`. Solo amplía si se pide `minSide`
// (el OCR falla con letra diminuta pero lee bien la misma imagen ampliada), hasta un máximo de MAX_UPSCALE veces.
export function fitSize(w, h, maxSide = MAX_SIDE, minSide = 0) {
  const longSide = Math.max(w, h);
  let scale = Math.min(1, maxSide / longSide);
  if (scale === 1 && longSide < minSide) scale = Math.min(MAX_UPSCALE, minSide / longSide);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

// Luminancia de una miniatura RGBA (como la de ImageData.data) -> Uint8Array.
export function luminance(rgba) {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) {
    const p = i * 4;
    out[i] = Math.round(0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]);
  }
  return out;
}

// Fracción de celdas de la miniatura cuya luminancia cambió más de `cellDelta` (0..255).
// Mide "cuánta pantalla ha cambiado" sin que el ruido de compresión dispare falsas alarmas.
export function changeRatio(a, b, cellDelta = 24) {
  if (!a || !b || a.length !== b.length) return 1;
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > cellDelta) changed++;
  return changed / a.length;
}

// Umbrales de la vigilancia (sobre una miniatura de 32x18 = 576 celdas).
export const CHANGE_RATIO = 0.02; // desde ~12 celdas distintas se considera que algo cambió
export const SETTLED_RATIO = 0.005; // por debajo de ~3 celdas entre dos lecturas, la imagen está quieta
export const MAX_SETTLE_MS = 8000; // si nunca se queda quieta (reels, animaciones), se analiza igualmente

// Decide qué hacer en cada lectura de la vigilancia: "analyze", "wait" (hay trabajo pendiente) o "idle".
//   notBefore   no analizar antes de este instante (respiro tras un error)
//   lastEnd     instante en que terminó el último análisis
//   minGapMs    separación mínima entre análisis
//   heartbeatMs refrescar aunque no cambie nada (0 = nunca)
export function decideWatch({ busy, now, notBefore, lastEnd, minGapMs, heartbeatMs, hasBaseline, changed, settled, changedSince, maxSettleMs = MAX_SETTLE_MS }) {
  if (busy || now < notBefore) return "wait";
  if (!hasBaseline) return "analyze";
  if (changed) {
    if (now - lastEnd < minGapMs) return "wait";
    if (!settled && now - (changedSince ?? now) < maxSettleMs) return "wait";
    return "analyze";
  }
  if (heartbeatMs > 0 && now - lastEnd >= heartbeatMs) return "analyze";
  return "idle";
}

// ---------- qué compartir ----------

export const SURFACE_CHOICES = { any: null, browser: "browser", window: "window", monitor: "monitor" };

// Opciones de getDisplayMedia. El navegador SIEMPRE muestra su propio selector (por privacidad no se puede saltar):
// `displaySurface` solo es una sugerencia de cuál mostrar primero. `selfBrowserSurface: "exclude"` oculta esta misma
// pestaña del selector (compartirla crearía un espejo infinito) y `surfaceSwitching` deja cambiar de pestaña sin reiniciar.
export function displayMediaOptions(surface = "any") {
  const video = { frameRate: { ideal: 2, max: 5 } };
  if (SURFACE_CHOICES[surface]) video.displaySurface = SURFACE_CHOICES[surface];
  return { video, audio: false, selfBrowserSurface: "exclude", surfaceSwitching: "include", monitorTypeSurfaces: "include", systemAudio: "exclude" };
}

const INTERNAL_LABEL = /^(?:web-contents-media-stream|window:|screen:|monitor:)/i;

// Qué se está compartiendo, a partir de lo que informa la pista de vídeo.
export function describeSource(settings = {}, label = "") {
  const kind = ["browser", "window", "monitor"].includes(settings.displaySurface) ? settings.displaySurface : "unknown";
  const name = label && !INTERNAL_LABEL.test(label) ? label : null;
  const text = { browser: "una pestaña", window: "una ventana", monitor: "toda la pantalla", unknown: "una fuente" }[kind];
  return { kind, name, text: name ? `${text} («${name}»)` : text };
}
