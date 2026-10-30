import { timingSafeEqual } from "node:crypto";
import { assertAllowedHost, readJsonBody, sendJson, withErrorHandling } from "./http.js";
import { HttpError, parseAnalyzeRequest } from "./validate.js";

function tokenMatches(header, token) {
  const given = Buffer.from(/^Bearer (.+)$/.exec(header ?? "")?.[1] ?? "");
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// El "otro" programa: recibe capturas del visor y devuelve el contexto. No sirve ninguna página.
//   GET  /health   estado del motor (sin autenticación, no incluye secretos)
//   POST /analyze  misma petición que /api/analyze del visor; exige Bearer token si hay token
export function createAnalyzerService({ backend, token = null, loopbackOnly = true }) {
  async function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");
    assertAllowedHost(req, loopbackOnly);

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true, ...(await backend.info()) });
    }

    if (req.method === "POST" && url.pathname === "/analyze") {
      if (token && !tokenMatches(req.headers.authorization, token)) {
        throw new HttpError(401, "unauthorized", "Token inválido o ausente.");
      }
      const info = await backend.info();
      if (!info.ready) throw new HttpError(503, "no_backend", info.hint ?? "No hay motor de análisis disponible.");
      const outcome = await backend.analyze(parseAnalyzeRequest(await readJsonBody(req)));
      if (outcome.refused) return sendJson(res, 200, { refused: true, reason: outcome.reason, model: outcome.model });
      return sendJson(res, 200, { refused: false, context: outcome.result, meta: { model: outcome.model, usage: outcome.usage } });
    }

    throw new HttpError(404, "not_found", "No encontrado.");
  }

  return withErrorHandling(handle);
}
