import { LANGUAGES, MODE_IDS } from "./modes.js";

// ~4.5 MB de base64: por debajo del límite de 5 MB por imagen de la API.
export const MAX_IMAGE_BASE64_CHARS = 4_500_000;
const IMAGE_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function clip(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// Valida y normaliza el cuerpo de POST /api/analyze.
export function parseAnalyzeRequest(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "bad_request", "El cuerpo debe ser un objeto JSON.");
  }

  const match = typeof body.image === "string" ? IMAGE_RE.exec(body.image) : null;
  if (!match) {
    throw new HttpError(400, "bad_image", "La imagen debe ser un data URL base64 (jpeg, png o webp).");
  }
  if (match[2].length > MAX_IMAGE_BASE64_CHARS) {
    throw new HttpError(413, "image_too_large", "La imagen es demasiado grande (máx. ~4.5 MB).");
  }

  const mode = body.mode ?? "auto";
  if (!MODE_IDS.includes(mode)) {
    throw new HttpError(400, "bad_mode", `Modo desconocido: ${String(mode).slice(0, 40)}`);
  }
  const language = body.language ?? "es";
  if (!Object.hasOwn(LANGUAGES, language)) {
    throw new HttpError(400, "bad_language", "Idioma no soportado (es, en).");
  }

  const history = Array.isArray(body.history)
    ? body.history
        .slice(-3)
        .map((h) => ({ title: clip(h?.title, 120), summary: clip(h?.summary, 300) }))
        .filter((h) => h.title || h.summary)
    : [];

  return {
    mediaType: match[1],
    imageBase64: match[2],
    mode,
    language,
    note: clip(body.note, 200),
    history,
    publish: body.publish !== false,
  };
}

const CONFIDENCE = new Set(["low", "medium", "high"]);
const CERTAINTY_OF = { low: 0.3, medium: 0.6, high: 0.85 }; // para motores que solo dan «baja/media/alta»

// Deja el resultado del modelo en una forma segura de mostrar y publicar.
export function normalizeResult(raw) {
  const text = (v, max) => clip(v, max);
  const list = (v, max, n) => (Array.isArray(v) ? v.slice(0, n).map((x) => clip(x, max)).filter(Boolean) : []);
  const confidence = CONFIDENCE.has(raw.confidence) ? raw.confidence : "low";
  const certainty = Number.isFinite(raw.certainty) ? Math.min(1, Math.max(0, Math.round(raw.certainty * 100) / 100)) : CERTAINTY_OF[confidence];
  return {
    category: text(raw.category, 40) || "other",
    title: text(raw.title, 120),
    summary: text(raw.summary, 500),
    activity: text(raw.activity, 80),
    entities: Array.isArray(raw.entities)
      ? raw.entities
          .slice(0, 12)
          .map((e) => ({ label: text(e?.label, 40), value: text(e?.value, 120) }))
          .filter((e) => e.label && e.value)
      : [],
    chat_line: text(raw.chat_line, 240),
    changes: text(raw.changes, 300),
    confidence,
    uncertain: list(raw.uncertain, 160, 8),
    text: text(raw.text, 2000),
    certainty,
    // En qué texto de la pantalla se basa cada dato, y por qué se eligió esta actividad.
    evidence: Array.isArray(raw.evidence)
      ? raw.evidence.slice(0, 12).map((e) => ({ label: text(e?.label, 40), value: text(e?.value, 120), text: text(e?.text, 100), confidence: Number.isFinite(e?.confidence) ? Math.round(e.confidence) : 0 })).filter((e) => e.label && e.text)
      : [],
    reasons: list(raw.reasons, 160, 8),
    subject: text(raw.subject, 100),
  };
}
