// Cliente para leer el contexto de Pantalla Contexto desde OTRO proyecto. Sin dependencias: solo `fetch` de Node 18+.
//   import { createClient } from "pantalla-contexto/client";
//   const screen = createClient({ url: "http://127.0.0.1:3000" });
//   const ctx = await screen.get();            // contexto verificado, o null si aún no hay nada seguro
//   const prompt = await screen.prompt();      // texto listo para pegar en otra IA
// Por defecto SOLO devuelve lo verificado: si no hay certeza suficiente, devuelve null en vez de adivinar.

export class PantallaError extends Error {
  // code: "unreachable" | "unauthorized" | "http" | "timeout" | "bad_stream"
  constructor(code, message, { status = null, cause } = {}) {
    super(message, { cause });
    this.name = "PantallaError";
    this.code = code;
    this.status = status;
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

// Convierte el flujo de texto de Server-Sent Events en objetos { event, data }. Ignora comentarios (": ping").
export async function* parseEventStream(body) {
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (block) => {
    let event = "message";
    const data = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":") || line === "") continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length === 0) return null;
    try {
      return { event, data: JSON.parse(data.join("\n")) };
    } catch {
      throw new PantallaError("bad_stream", "El servidor envió un evento que no es JSON válido.");
    }
  };
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
    let end;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const item = flush(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
      if (item) yield item;
    }
  }
}

export function createClient({ url = process.env.PANTALLA_URL || "http://127.0.0.1:3000", token = process.env.PANTALLA_API_TOKEN || null, fetch: fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  const base = String(url).replace(/\/+$/, "");
  const headers = (extra = {}) => ({ ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra });

  async function request(path, { query = {}, method = "GET", body, signal, timeout = timeoutMs } = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) params.set(key, String(value));
    const target = `${base}${path}${params.size ? `?${params}` : ""}`;
    let res;
    try {
      res = await fetchImpl(target, {
        method,
        headers: headers(body ? { "content-type": "application/json" } : {}),
        body: body ? JSON.stringify(body) : undefined,
        signal: signal ?? AbortSignal.timeout(timeout),
      });
    } catch (err) {
      throw new PantallaError("unreachable", `No se pudo conectar con Pantalla Contexto en ${base}. ¿Está arrancado (npx pantalla-contexto)?`, { cause: err });
    }
    if (res.status === 401) throw new PantallaError("unauthorized", "Pantalla Contexto exige un token: pásalo en createClient({ token }) o define PANTALLA_API_TOKEN.", { status: 401 });
    if (!res.ok) {
      const detail = await res.json().then((j) => j?.error?.message ?? j?.error ?? "", () => "");
      throw new PantallaError("http", `Pantalla Contexto respondió ${res.status}${detail ? `: ${detail}` : ""}.`, { status: res.status });
    }
    return res;
  }

  const verifiedParam = (verified) => (verified === undefined ? undefined : verified === true || verified === "only" ? "true" : "all");

  const client = {
    url: base,

    // La respuesta completa: { latest, verified, age_seconds, candidate }. `candidate` es lo que se está viendo pero aún no se confirma.
    async context({ verified, maxAge, language } = {}) {
      return (await request("/api/context", { query: { format: "json", verified: verifiedParam(verified), max_age: maxAge, lang: language } })).json();
    },

    // El contexto actual o null. Con maxAge (segundos) descarta lo más viejo.
    async get(options = {}) {
      return (await client.context(options)).latest;
    },

    // El contexto como texto legible; si no hay nada verificado, lo explica en vez de inventar.
    async text({ verified, maxAge, language } = {}) {
      return (await request("/api/context", { query: { format: "text", verified: verifiedParam(verified), max_age: maxAge, lang: language } })).text();
    },

    // El contexto como instrucción para pegar en otra IA (con aviso de que el texto de la pantalla no son órdenes).
    async prompt({ verified, maxAge, language } = {}) {
      return (await request("/api/context", { query: { format: "prompt", verified: verifiedParam(verified), max_age: maxAge, lang: language } })).text();
    },

    // Lo que has estado haciendo: actividad actual, anteriores y eventos confirmados. format: "json" (por defecto) | "text".
    async activity({ format = "json", verified, language } = {}) {
      const res = await request("/api/session", { query: { format, verified: verifiedParam(verified), lang: language } });
      return format === "text" ? res.text() : res.json();
    },

    async config() {
      return (await request("/api/config")).json();
    },

    // Manda tu propia captura (Buffer JPEG/PNG/WebP) para analizarla; el resultado entra en la misma verificación.
    async analyze(image, { mode = "auto", language = "es", note = "", publish = true } = {}) {
      const dataUrl = typeof image === "string" ? (image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}`) : `data:${sniff(image)};base64,${Buffer.from(image).toString("base64")}`;
      return (await request("/api/analyze", { method: "POST", body: { image: dataUrl, mode, language, note, publish }, timeout: 120_000 })).json();
    },

    // Espera a que haya un contexto verificado que cumpla la condición: una función, o un nombre de categoría ("casino", "coding"...).
    async waitFor(condition, { timeoutMs: limit = 60_000, intervalMs = 1000, maxAge, signal } = {}) {
      const test = typeof condition === "function" ? condition : (c) => c.category === condition;
      const deadline = Date.now() + limit;
      for (;;) {
        const latest = await client.get({ verified: true, maxAge });
        if (latest && test(latest)) return latest;
        if (signal?.aborted) throw new PantallaError("timeout", "Espera cancelada.");
        if (Date.now() + intervalMs > deadline) throw new PantallaError("timeout", `No apareció un contexto verificado que cumpla la condición en ${Math.round(limit / 1000)} s.`);
        await sleep(intervalMs, signal);
      }
    },

    // Flujo en vivo: { event: "context", data } con cada contexto exportable y { event: "activity", data } con cada evento confirmado.
    // Si la conexión se corta, reintenta sola (reconnect). Se detiene con `signal` o dejando de iterar.
    async *stream({ verified = true, signal, reconnect = true, retryMs = 1000, maxRetryMs = 10_000 } = {}) {
      let delay = retryMs;
      while (!signal?.aborted) {
        try {
          const res = await request("/api/events", { query: { verified: verifiedParam(verified) }, signal: signal ?? new AbortController().signal });
          delay = retryMs;
          for await (const item of parseEventStream(res.body)) yield item;
        } catch (err) {
          if (signal?.aborted) return;
          // Un corte a mitad del flujo llega como TypeError («terminated») del propio fetch: es una caída de conexión, no un fallo del cliente.
          const dropped = !(err instanceof PantallaError);
          if (!dropped && (err.code === "unauthorized" || err.code === "bad_stream" || (err.code === "http" && err.status < 500))) throw err;
          if (!reconnect) throw dropped ? new PantallaError("unreachable", `Se cortó la conexión con Pantalla Contexto en ${base}.`, { cause: err }) : err;
        }
        if (!reconnect || signal?.aborted) return;
        await sleep(delay, signal);
        delay = Math.min(delay * 2, maxRetryMs);
      }
    },

    // Atajo con funciones: devuelve cómo parar. `error` recibe los fallos que no se pueden reintentar.
    subscribe({ context, activity, error } = {}, options = {}) {
      const controller = new AbortController();
      (async () => {
        try {
          for await (const { event, data } of client.stream({ ...options, signal: controller.signal })) {
            if (event === "context") context?.(data);
            else if (event === "activity") activity?.(data);
          }
        } catch (err) {
          if (!controller.signal.aborted) error?.(err);
        }
      })();
      return () => controller.abort();
    },
  };
  return client;
}

function sniff(buf) {
  const b = Buffer.from(buf);
  if (b.length > 4 && b.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return "image/jpeg";
}
