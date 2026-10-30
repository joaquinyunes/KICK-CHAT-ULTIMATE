import { extractContext } from "../ocr/extract.js";
import { normalizeResult } from "../validate.js";

const NOTES = {
  es: {
    enriched: "Texto leído por OCR e interpretado por una IA externa (no ve la imagen).",
    failed: (why) => `La IA externa no respondió (${why}); se muestra el análisis local.`,
  },
  en: {
    enriched: "Text read by OCR and interpreted by an external AI (it does not see the image).",
    failed: (why) => `The external AI did not respond (${why}); showing the local analysis.`,
  },
};

// Motor SIN modelo de visión: lee el texto de la pantalla (OCR) y lo interpreta con reglas. Funciona sin
// Ollama y sin ninguna clave. Opcionalmente, una IA externa de TEXTO refina el resultado (nunca recibe la imagen).
// Las zonas pequeñas se amplían antes de enviarlas (minSide): con letra diminuta el OCR falla, y ampliada lee bien.
export function createOcrBackend({ engine, index, enricher = null, maxSide = 1600, minSide = 1280, quality = 0.9 }) {
  const langs = engine.langs.join("+");

  async function info() {
    const check = await engine.available();
    const base = {
      name: enricher ? "ocr + IA" : "ocr",
      model: enricher ? `tesseract (${langs}) + ${enricher.model}` : `tesseract (${langs})`,
      cost: enricher ? "hybrid" : "free-local",
      local: !enricher,
      maxSide,
      minSide,
      quality,
    };
    return check.ok ? { ...base, ready: true, hint: null } : { ...base, ready: false, hint: check.error };
  }

  async function analyze(req) {
    const ocr = await engine.recognize(Buffer.from(req.imageBase64, "base64"));
    const draft = extractContext(ocr, { language: req.language, mode: req.mode, note: req.note, history: req.history, index });
    const note = NOTES[req.language] ?? NOTES.es;
    const modelName = `tesseract (${langs})`;

    if (!enricher || !draft.text) {
      return { refused: false, result: normalizeResult(draft), model: modelName, usage: { input_tokens: 0, output_tokens: 0 } };
    }
    try {
      const { parsed, model, usage } = await enricher.refine({ draft, req });
      const refined = normalizeResult({ ...parsed, text: draft.text });
      refined.uncertain = [note.enriched, ...refined.uncertain].slice(0, 6);
      return { refused: false, result: refined, model: `${modelName} + ${model}`, usage };
    } catch (err) {
      // La IA externa es un extra: si falla (cuota, red...) no se pierde el análisis local.
      const result = normalizeResult(draft);
      result.uncertain = [...result.uncertain, note.failed(err.message)].slice(0, 6);
      return { refused: false, result, model: modelName, usage: { input_tokens: 0, output_tokens: 0 } };
    }
  }

  return { name: "ocr", cost: enricher ? "hybrid" : "free-local", local: !enricher, profile: "lite", maxSide, minSide, quality, info, analyze, close: () => engine.close() };
}
