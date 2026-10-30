import { parseModelJson } from "../parse.js";
import { buildUserText, PROFILES } from "../prompt.js";
import { HttpError, normalizeResult } from "../validate.js";

const INFO_TTL_MS = 5000;

// Motor gratuito y local con Ollama. Pensado para gastar poco:
//   - perfil "lite" (prompt y salida cortos) e imágenes pequeñas (maxSide),
//   - keep_alive: Ollama descarga el modelo de la RAM cuando pasa ese tiempo sin usarse,
//   - threads: permite dejar libres núcleos para el stream.
export function createOllamaBackend({
  host,
  model,
  keepAlive = "60s",
  threads = null,
  think = null,
  timeoutMs = 180_000,
  maxSide = 768,
  fetchImpl = fetch,
}) {
  const { system, schema } = PROFILES.lite;
  const wanted = model.includes(":") ? model : `${model}:latest`;
  let cached = null;

  async function readInfo() {
    const base = { name: "ollama", model, cost: "free-local", local: true, maxSide };
    let res;
    try {
      res = await fetchImpl(`${host}/api/tags`, { signal: AbortSignal.timeout(1500) });
    } catch {
      return { ...base, ready: false, hint: `No se encuentra Ollama en ${host}. Instálalo desde ollama.com y arráncalo (ollama serve).` };
    }
    if (!res.ok) return { ...base, ready: false, hint: `Ollama respondió ${res.status} en ${host}.` };
    const { models = [] } = await res.json().catch(() => ({}));
    if (!models.some((m) => m.name === wanted || m.model === wanted)) {
      return { ...base, ready: false, hint: `Falta el modelo. Descárgalo con: ollama pull ${model}` };
    }
    return { ...base, ready: true, hint: null };
  }

  async function info() {
    if (!cached || Date.now() - cached.at > INFO_TTL_MS) cached = { at: Date.now(), value: await readInfo() };
    return cached.value;
  }

  async function analyze(req) {
    const body = {
      model,
      stream: false,
      format: schema,
      keep_alive: keepAlive,
      options: {
        temperature: 0,
        num_ctx: 4096,
        num_predict: 600,
        ...(threads ? { num_thread: threads } : {}),
      },
      ...(think === false ? { think: false } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: buildUserText(req, "lite"), images: [req.imageBase64] },
      ],
    };

    let res;
    try {
      res = await fetchImpl(`${host}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err?.name === "TimeoutError") {
        throw new HttpError(504, "timeout", `Ollama tardó más de ${Math.round(timeoutMs / 1000)} s. Prueba un modelo más pequeño, una zona menor o un intervalo mayor.`);
      }
      throw new HttpError(502, "upstream_unreachable", `No se pudo conectar con Ollama en ${host}. ¿Está arrancado?`);
    }

    if (!res.ok) {
      const detail = (await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`;
      if (res.status === 404) {
        throw new HttpError(502, "model_missing", `Ollama no tiene el modelo "${model}". Descárgalo con: ollama pull ${model}`);
      }
      throw new HttpError(502, "upstream_error", `Error de Ollama: ${detail}`);
    }

    const data = await res.json().catch(() => null);
    if (data?.done_reason === "length") {
      throw new HttpError(502, "truncated", "La respuesta del modelo se cortó antes de terminar. Si es un modelo con razonamiento, usa una variante sin él o PANTALLA_OLLAMA_THINK=0.");
    }
    const parsed = parseModelJson(data?.message?.content);
    if (!parsed) throw new HttpError(502, "bad_model_output", "El modelo no devolvió un JSON válido.");

    return {
      refused: false,
      result: normalizeResult(parsed),
      model,
      usage: { input_tokens: data.prompt_eval_count ?? 0, output_tokens: data.eval_count ?? 0 },
    };
  }

  return { name: "ollama", cost: "free-local", local: true, profile: "lite", maxSide, info, analyze };
}
