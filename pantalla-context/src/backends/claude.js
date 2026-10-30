import Anthropic from "@anthropic-ai/sdk";
import { buildUserText, PROFILES } from "../prompt.js";
import { HttpError, normalizeResult } from "../validate.js";

// Traduce los errores del SDK a errores HTTP propios, de lo más específico a lo más general.
function toHttpError(err) {
  if (err instanceof HttpError) return err;
  if (err instanceof Anthropic.RateLimitError) {
    return new HttpError(429, "rate_limited", "Límite de peticiones de la API alcanzado. Espera un momento o aumenta el intervalo.");
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new HttpError(502, "upstream_auth", "La API rechazó las credenciales. Revisa ANTHROPIC_API_KEY.");
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new HttpError(502, "upstream_bad_request", `La API rechazó la petición: ${err.message}`);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new HttpError(502, "upstream_unreachable", "No se pudo conectar con la API de Anthropic.");
  }
  if (err instanceof Anthropic.APIError) {
    return new HttpError(502, "upstream_error", `Error de la API (${err.status ?? "?"}): ${err.message}`);
  }
  if (err instanceof Anthropic.AnthropicError) {
    // Otros fallos propios del SDK (configuración, cuerpo de petición inválido...).
    return new HttpError(503, "upstream_config", err.message);
  }
  return err;
}

// Motor de pago: mejor calidad de lectura y razonamiento, sin carga local.
//   fallbacks: si Claude rechaza la petición por política, la API la reintenta en otro modelo.
export function createClaudeBackend({ client, model, effort = "low", fallbacks = true, configured = true, maxSide = 1568 }) {
  const { system, schema } = PROFILES.full;

  async function analyze(req) {
    const params = {
      model,
      max_tokens: 4096, // incluye los tokens de razonamiento
      system,
      output_config: { effort, format: { type: "json_schema", schema } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: req.mediaType, data: req.imageBase64 } },
            { type: "text", text: buildUserText(req) },
          ],
        },
      ],
    };

    let response;
    try {
      response = fallbacks
        ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
        : await client.messages.create(params);
    } catch (err) {
      throw toHttpError(err);
    }

    if (response.stop_reason === "refusal") {
      return { refused: true, reason: response.stop_details?.category ?? null, model: response.model };
    }
    if (response.stop_reason === "max_tokens") {
      throw new HttpError(502, "truncated", "La respuesta del modelo se cortó antes de terminar. Inténtalo de nuevo.");
    }

    const textBlock = response.content.find((b) => b.type === "text");
    let parsed;
    try {
      parsed = JSON.parse(textBlock?.text ?? "");
    } catch {
      throw new HttpError(502, "bad_model_output", "El modelo no devolvió un JSON válido.");
    }

    return {
      refused: false,
      result: normalizeResult(parsed),
      model: response.model,
      usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
    };
  }

  return {
    name: "claude",
    cost: "paid",
    local: false,
    profile: "full",
    maxSide,
    async info() {
      return {
        ready: configured,
        name: "claude",
        model,
        cost: "paid",
        local: false,
        maxSide,
        hint: configured ? null : "Define ANTHROPIC_API_KEY para usar Claude.",
      };
    },
    analyze,
  };
}
