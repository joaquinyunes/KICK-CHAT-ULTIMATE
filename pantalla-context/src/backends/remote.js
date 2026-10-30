import { HttpError } from "../validate.js";

const INFO_TTL_MS = 15_000;

// Cliente del analizador que corre en otro proceso o en otro equipo (analyzer.js).
// Así el PC del stream solo hace la captura y el trabajo pesado va a otra máquina.
export function createRemoteBackend({ url, token, timeoutMs = 200_000, maxSide = 1024, fetchImpl = fetch }) {
  let cached = null;

  async function readInfo() {
    const unreachable = {
      ready: false,
      name: "remoto",
      model: url,
      cost: "free-local",
      local: false,
      maxSide,
      hint: `No se alcanza el analizador en ${url}. ¿Está arrancado (npm run analyzer)?`,
    };
    let res;
    try {
      res = await fetchImpl(`${url}/health`, { signal: AbortSignal.timeout(2000) });
    } catch {
      return unreachable;
    }
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) return unreachable;
    return {
      ready: Boolean(body.ready),
      name: `${body.name} (remoto)`,
      model: body.model,
      cost: body.cost,
      local: false,
      maxSide: body.maxSide ?? maxSide,
      hint: body.hint ?? null,
    };
  }

  async function info() {
    if (!cached || Date.now() - cached.at > INFO_TTL_MS) cached = { at: Date.now(), value: await readInfo() };
    return cached.value;
  }

  async function analyze(req) {
    let res;
    try {
      res = await fetchImpl(`${url}/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          image: `data:${req.mediaType};base64,${req.imageBase64}`,
          mode: req.mode,
          language: req.language,
          note: req.note,
          history: req.history,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err?.name === "TimeoutError") throw new HttpError(504, "timeout", "El analizador remoto tardó demasiado en responder.");
      cached = null;
      throw new HttpError(502, "upstream_unreachable", `No se pudo conectar con el analizador en ${url}.`);
    }

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      // Un 401 del analizador es un problema de configuración del visor, no del usuario del navegador.
      if (res.status === 401) throw new HttpError(502, "upstream_auth", "El analizador rechazó el token (PANTALLA_ANALYZER_TOKEN).");
      throw new HttpError(res.status, body?.error ?? "upstream_error", body?.message ?? `El analizador respondió ${res.status}.`);
    }
    if (body?.refused) return { refused: true, reason: body.reason ?? null, model: body.model ?? null };
    if (!body?.context) throw new HttpError(502, "bad_model_output", "Respuesta inesperada del analizador.");
    return { refused: false, result: body.context, model: body.meta?.model, usage: body.meta?.usage };
  }

  return { name: "remote", cost: "free-local", local: false, profile: "full", maxSide, info, analyze };
}
