import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { HttpError } from "../validate.js";
import { imageSize } from "./image.js";
import { enhanceLightText } from "./preprocess.js";

const require = createRequire(import.meta.url);

// Los idiomas vienen en paquetes npm (@tesseract.js-data/<código>), así que no se descarga nada en tiempo de ejecución.
// Tesseract admite un único directorio de idiomas: con varios se juntan en una carpeta temporal (copia única).
async function resolveLangPath(langs, override) {
  if (override) return override;
  const dirs = langs.map((code) => {
    try {
      return require(`@tesseract.js-data/${code}`).langPath;
    } catch {
      throw new Error(`Falta el idioma de OCR "${code}". Instálalo con: npm install @tesseract.js-data/${code} (o define PANTALLA_OCR_LANG_PATH).`);
    }
  });
  if (dirs.length === 1) return dirs[0];

  const merged = path.join(os.tmpdir(), "pantalla-contexto-tessdata");
  await fs.mkdir(merged, { recursive: true });
  for (const [i, code] of langs.entries()) {
    const from = path.join(dirs[i], `${code}.traineddata.gz`);
    const to = path.join(merged, `${code}.traineddata.gz`);
    const [a, b] = await Promise.all([fs.stat(from), fs.stat(to).catch(() => null)]);
    if (b?.size !== a.size) await fs.copyFile(from, to);
  }
  return merged;
}

const alnum = (text) => (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
// Líneas que parecen texto de verdad (no el ruido que el OCR inventa con iconos y dibujos).
const textual = (lines) => lines.filter((l) => alnum(l.text) >= 3 && alnum(l.text) / l.text.length >= 0.55);
const usefulChars = (lines) => lines.filter((l) => l.confidence >= 60).reduce((n, l) => n + alnum(l.text), 0);

// ¿Merece la pena un segundo paso? Solo si la lectura normal salió pobre: así las pantallas normales no gastan CPU extra.
// Se mide solo sobre las líneas textuales: los dibujos (símbolos sueltos) bajan la media sin que haya nada que mejorar.
export function readsPoorly({ lines }) {
  if (lines.length === 0) return false; // pantalla vacía: no hay texto garabateado que rescatar, y no merece el gasto
  const clean = textual(lines);
  const chars = clean.reduce((n, l) => n + alnum(l.text), 0);
  if (chars === 0) return true;
  const mean = clean.reduce((n, l) => n + l.confidence * alnum(l.text), 0) / chars;
  return mean < 60 || usefulChars(lines) < 15;
}

const overlaps = (a, b) => {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return false;
  const inter = w * h;
  const union = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
  return inter / union >= 0.3;
};

// Une dos lecturas de la misma imagen: donde ambas ven una línea gana la más segura; lo que solo vio una se añade.
export function mergeReadings(first, second) {
  const merged = [...first];
  for (const line of second) {
    const i = merged.findIndex((m) => m.bbox && line.bbox && overlaps(m.bbox, line.bbox));
    if (i === -1) merged.push(line);
    else if (line.confidence > merged[i].confidence) merged[i] = line;
  }
  return merged.sort((a, b) => (a.bbox?.y0 ?? 0) - (b.bbox?.y0 ?? 0) || (a.bbox?.x0 ?? 0) - (b.bbox?.x0 ?? 0));
}

// Motor de OCR (Tesseract compilado a WebAssembly, sin dependencias nativas).
//   - El trabajador (~160 MB de RAM) se crea al primer uso y se libera tras `keepAliveMs` sin actividad.
//   - Modo de segmentación 11 («texto disperso»): el que mejor lee interfaces, donde las etiquetas están sueltas.
export function createOcrEngine({ langs = ["eng"], langPath = null, keepAliveMs = 60_000, loadTesseract = () => import("tesseract.js") } = {}) {
  let workerPromise = null;
  let idleTimer = null;

  async function startWorker() {
    const dir = await resolveLangPath(langs, langPath);
    const mod = await loadTesseract();
    const createWorker = mod.createWorker ?? mod.default?.createWorker;
    const worker = await createWorker(langs, 1, { langPath: dir, gzip: true, cacheMethod: "none" });
    await worker.setParameters({ tessedit_pageseg_mode: "11", user_defined_dpi: "300" });
    return worker;
  }

  async function release() {
    clearTimeout(idleTimer);
    const pending = workerPromise;
    workerPromise = null;
    if (pending) await (await pending.catch(() => null))?.terminate();
  }

  return {
    langs,

    // Comprueba que Tesseract y los idiomas están instalados, sin arrancar el trabajador.
    async available() {
      try {
        await loadTesseract();
        await resolveLangPath(langs, langPath);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    // `image` es un Buffer JPEG/PNG. Devuelve el texto y las líneas con su caja y confianza, y las dimensiones.
    // Si la primera lectura sale pobre y es un JPEG, hace un segundo paso con la imagen realzada y fusiona ambas.
    async recognize(image, { enhance = "auto" } = {}) {
      clearTimeout(idleTimer);
      workerPromise ??= startWorker();
      try {
        const worker = await workerPromise;
        const read = async (input) => {
          const { data } = await worker.recognize(input, {}, { text: true, blocks: true });
          const lines = (data.blocks ?? [])
            .flatMap((block) => block.paragraphs.flatMap((p) => p.lines))
            .map((line) => ({ text: line.text.trim(), confidence: line.confidence, bbox: line.bbox }))
            .filter((line) => line.text);
          return { text: data.text.trim(), confidence: data.confidence, lines };
        };

        const started = performance.now();
        const size = imageSize(image);
        let result = await read(image);
        let enhanced = false;
        if (enhance !== "never" && (enhance === "always" || readsPoorly(result))) {
          const pre = enhanceLightText(image);
          if (pre) {
            const second = await read(pre.image);
            const lines = mergeReadings(result.lines, second.lines);
            const kept = usefulChars(lines) >= usefulChars(result.lines);
            // La mejor de las dos confianzas: la fusión nunca debe parecer peor que sus partes.
            if (kept) {
              result = { text: lines.map((l) => l.text).join("\n"), confidence: Math.max(result.confidence, second.confidence), lines };
              enhanced = true;
            }
          }
        }
        return { ...result, width: size?.width ?? null, height: size?.height ?? null, enhanced, ms: Math.round(performance.now() - started) };
      } catch (err) {
        workerPromise = null; // si el trabajador quedó en mal estado, se recrea en la siguiente captura
        throw new HttpError(502, "ocr_failed", `El OCR falló: ${err.message}`);
      } finally {
        idleTimer = setTimeout(release, keepAliveMs);
        idleTimer.unref?.();
      }
    },

    close: release,
  };
}
