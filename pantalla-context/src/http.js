import { HttpError } from "./validate.js";

export const MAX_BODY_BYTES = 6 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; frame-ancestors 'none'",
};

export function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", ...extraHeaders });
  res.end(JSON.stringify(body));
}

// Se corta la lectura de un cuerpo demasiado grande: hay que cerrar la conexión tras responder,
// porque el cliente aún puede estar enviando y ese socket no se puede reutilizar.
function bodyTooLarge() {
  const err = new HttpError(413, "body_too_large", "La petición es demasiado grande.");
  err.closeConnection = true;
  return err;
}

export async function readJsonBody(req) {
  const type = req.headers["content-type"] ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Content-Type debe ser application/json.");
  }
  if (Number(req.headers["content-length"]) > MAX_BODY_BYTES) throw bodyTooLarge();
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw bodyTooLarge();
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "bad_json", "El cuerpo no es JSON válido.");
  }
}

// Con el servidor ligado a localhost solo se acepta un Host de localhost (evita DNS rebinding).
export function assertAllowedHost(req, loopbackOnly) {
  if (!loopbackOnly) return;
  const hostname = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
  if (!LOOPBACK_HOSTS.has(hostname)) throw new HttpError(403, "bad_host", "Host no permitido.");
}

// Envuelve un manejador async: los HttpError salen como JSON y el resto como 500 sin detalles.
export function withErrorHandling(handle) {
  return async (req, res) => {
    try {
      await handle(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        const headers = err.closeConnection ? { connection: "close" } : {};
        return sendJson(res, err.status, { error: err.code, message: err.message }, headers);
      }
      console.error("Error inesperado:", err);
      sendJson(res, 500, { error: "internal", message: "Error interno del servidor." });
    }
  };
}
