import { parseModelJson } from "../parse.js";
import { buildUserText, PROFILES } from "../prompt.js";
import { HttpError, normalizeResult } from "../validate.js";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
const REFUSAL_FINISH = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY"]);

// La API de Gemini acepta un subconjunto de OpenAPI: tipos en mayúsculas y sin additionalProperties.
export function toGeminiSchema(node) {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (node === null || typeof node !== "object") return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "additionalProperties") continue;
    if (key === "type") out.type = String(value).toUpperCase();
    else if (key === "properties") out.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toGeminiSchema(v)]));
    else out[key] = toGeminiSchema(value);
  }
  return out;
}

// Motor gratuito en la nube (nivel gratuito de Gemini): no carga tu CPU ni tu RAM.
// Ojo: el nivel gratuito tiene límites de uso y, según los términos de Google, el contenido
// enviado puede usarse para mejorar sus productos. No lo uses con pantallas privadas.
export function createGeminiBackend({ apiKey, model, timeoutMs = 60_000, maxSide = 1024, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch }) {
  const { system, schema } = PROFILES.full;
  const responseSchema = toGeminiSchema(schema);

  async function analyze(req) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [
            {
              role: "user",
              parts: [
                { inline_data: { mime_type: req.mediaType, data: req.imageBase64 } },
                { text: buildUserText(req, "full") },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 2048, // incluye los tokens de razonamiento de los modelos que piensan
            responseMimeType: "application/json",
            responseSchema,
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err?.name === "TimeoutError") throw new HttpError(504, "timeout", "Gemini tardó demasiado en responder.");
      throw new HttpError(502, "upstream_unreachable", "No se pudo conectar con la API de Gemini.");
    }

    if (!res.ok) {
      const detail = (await res.json().catch(() => ({})))?.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 429) {
        throw new HttpError(429, "rate_limited", "Límite del nivel gratuito de Gemini alcanzado. Espera un poco o aumenta el intervalo entre análisis.");
      }
      if (res.status === 401 || res.status === 403) {
        throw new HttpError(502, "upstream_auth", `Gemini rechazó la clave: ${detail}`);
      }
      if (res.status === 404) {
        throw new HttpError(502, "model_missing", `Gemini no encuentra el modelo "${model}". Cámbialo con PANTALLA_GEMINI_MODEL.`);
      }
      throw new HttpError(502, res.status === 400 ? "upstream_bad_request" : "upstream_error", `Error de Gemini (${res.status}): ${detail}`);
    }

    const data = await res.json().catch(() => null);
    if (data?.promptFeedback?.blockReason) {
      return { refused: true, reason: data.promptFeedback.blockReason, model };
    }
    const candidate = data?.candidates?.[0];
    if (REFUSAL_FINISH.has(candidate?.finishReason)) return { refused: true, reason: candidate.finishReason, model };
    if (candidate?.finishReason === "MAX_TOKENS") {
      throw new HttpError(502, "truncated", "La respuesta del modelo se cortó antes de terminar. Inténtalo de nuevo.");
    }

    const text = (candidate?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
    const parsed = parseModelJson(text);
    if (!parsed) throw new HttpError(502, "bad_model_output", "El modelo no devolvió un JSON válido.");

    return {
      refused: false,
      result: normalizeResult(parsed),
      model: data.modelVersion ?? model,
      usage: { input_tokens: data.usageMetadata?.promptTokenCount ?? 0, output_tokens: data.usageMetadata?.candidatesTokenCount ?? 0 },
    };
  }

  return {
    name: "gemini",
    cost: "free-tier",
    local: false,
    profile: "full",
    maxSide,
    async info() {
      const ready = Boolean(apiKey);
      return { ready, name: "gemini", model, cost: "free-tier", local: false, maxSide, hint: ready ? null : "Define GEMINI_API_KEY (clave gratuita de Google AI Studio)." };
    },
    analyze,
  };
}
