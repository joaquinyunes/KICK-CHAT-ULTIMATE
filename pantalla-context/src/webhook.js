import { createHmac } from "node:crypto";
import { contextToPrompt, contextToText } from "../public/context-format.js";

// Envía cada contexto exportable (por defecto, solo el verificado) a una URL (n8n, Make, Zapier, un bot de Discord/Twitch, tu propio servidor...).
// Si hay secreto, firma el cuerpo con HMAC-SHA256 en `x-pantalla-signature: sha256=<hex>` para que el receptor verifique el origen.
export function createWebhook({ url, secret = null, fetchImpl = fetch, timeoutMs = 5000, warn = console.warn }) {
  let failing = false;

  return async function send(entry, { events = [], session = null } = {}) {
    const language = entry.language ?? "es";
    const body = JSON.stringify({
      event: "context",
      context: entry,
      text: contextToText(entry, { language }),
      prompt: contextToPrompt(entry, { language }),
      events,
      session,
    });
    const headers = { "content-type": "application/json", "user-agent": "pantalla-contexto" };
    if (secret) headers["x-pantalla-signature"] = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

    try {
      const res = await fetchImpl(url, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`respondió ${res.status}`);
      failing = false;
    } catch (err) {
      // Solo se avisa en el primer fallo seguido, para no llenar el registro si el destino está caído.
      if (!failing) warn(`Webhook: no se pudo entregar el contexto a ${url} (${err.message}).`);
      failing = true;
    }
  };
}
