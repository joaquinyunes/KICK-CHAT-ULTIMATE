import { timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contextToPrompt, contextToText, sessionToText } from "../public/context-format.js";
import { assertAllowedHost, readJsonBody, SECURITY_HEADERS, sendJson, withErrorHandling } from "./http.js";
import { LANGUAGES, MODES } from "./modes.js";
import { createTracker } from "./tracker.js";
import { HttpError, parseAnalyzeRequest } from "./validate.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

const PAGES = { "/": "index.html", "/overlay": "overlay.html" };
const HEARTBEAT_MS = 25_000;
const PROTECTED = new Set(["/api/context", "/api/latest", "/api/session", "/api/events"]);

// El formato de la imagen por su cabecera (la API la exige en el data URL).
function sniffMediaType(buf) {
  if (buf.length > 4 && buf.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (buf.length > 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return "image/jpeg";
}

function tokenMatches(header, queryToken, token) {
  const given = Buffer.from(/^Bearer (.+)$/.exec(header ?? "")?.[1] ?? queryToken ?? "");
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Servidor del visor: sirve la interfaz y el overlay, reenvía las capturas al analizador, sigue la actividad en el tiempo
// y exporta SOLO lo verificado (según `exportMode`) por la API, el flujo en vivo, el webhook y el MCP.
//   backend      { info() -> {ready, name, model, cost, local, maxSide, hint}, analyze(req) }
//   tracker      seguimiento de la actividad (verificación, eventos, línea de tiempo); ver tracker.js
//   exportMode   "verified" (por defecto): lo no verificado no sale; "all": sale todo, con su marca de verificado
//   apiToken     si se define, la API de exportación exige «Authorization: Bearer <token>» (o ?token=)
//   loopbackOnly true -> solo acepta Host de localhost (evita DNS rebinding)
//   onContext    se llama con cada contexto exportable (el webhook se engancha aquí); sus fallos no afectan al visor
export function createApp({ backend, tracker = createTracker(), exportMode = "verified", apiToken = null, loopbackOnly = true, now = () => new Date(), onContext = () => {} }) {
  let latestAny = null; // última lectura publicada, verificada o no
  let latestVerified = null; // última lectura verificada
  const clients = new Set(); // clientes de /api/events: { res, onlyVerified }
  const bus = new EventEmitter(); // lo mismo que sale por /api/events, para quien usa esto como biblioteca dentro de su proceso
  let heartbeat = null;
  const recent = []; // últimos análisis (título y resumen) de la API en proceso, para el campo «changes»
  const staleMs = tracker.config.maxGapMs;

  const sseEvent = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  const ageSeconds = (entry) => (entry ? Math.max(0, Math.round((now().getTime() - Date.parse(entry.at)) / 1000)) : null);

  // La lectura que se exporta: la última verificada (si no ha caducado) o, en modo «todo», la última sea cual sea.
  function pick(onlyVerified, maxAge = null) {
    const entry = onlyVerified ? latestVerified : latestAny;
    if (!entry) return null;
    const age = ageSeconds(entry);
    if (age * 1000 > staleMs || (maxAge !== null && age > maxAge)) return null;
    return entry;
  }

  function publish(entry, tracked) {
    latestAny = entry;
    if (entry.verified) latestVerified = entry;
    bus.emit("reading", entry); // toda lectura, verificada o no
    if (entry.verified) bus.emit("context", entry);
    for (const ev of tracked.events) bus.emit("activity", ev);
    for (const { res, onlyVerified } of clients) {
      if (!onlyVerified || entry.verified) res.write(sseEvent("context", entry));
      for (const ev of tracked.events) res.write(sseEvent("activity", ev));
    }
    if (exportMode === "all" || entry.verified) {
      try {
        Promise.resolve(onContext(entry, { events: tracked.events, session: tracker.snapshot({ onlyVerified: exportMode !== "all" }) })).catch(() => {});
      } catch {
        // un fallo del webhook nunca debe romper un análisis
      }
    }
  }

  // Analizar una captura, seguir la actividad y publicar el resultado. Lo usan POST /api/analyze y la API en proceso.
  async function analyzeAndTrack(request) {
    const started = Date.now();
    const outcome = await backend.analyze(request);
    const elapsed_ms = Date.now() - started;
    if (outcome.refused) return { refused: true, reason: outcome.reason, elapsed_ms };
    let tracking = null;
    if (request.publish) {
      const base = { ...outcome.result, mode: request.mode, language: request.language, at: now().toISOString() };
      const tracked = tracker.ingest(base);
      const entry = { ...base, verified: tracked.verified, confirmations: tracked.confirmations, state: tracked.state };
      publish(entry, tracked);
      tracking = { verified: tracked.verified, state: tracked.state, confirmations: tracked.confirmations, needed: tracked.needed, minCertainty: tracked.minCertainty, certainty: tracked.certainty, events: tracked.events, activity: tracked.segment };
    }
    return { refused: false, context: outcome.result, meta: { model: outcome.model, usage: outcome.usage, elapsed_ms }, tracking };
  }

  function subscribe(req, res, onlyVerified) {
    res.writeHead(200, { ...SECURITY_HEADERS, "content-type": "text/event-stream; charset=utf-8", connection: "keep-alive" });
    res.write(": conectado\n\n");
    const current = pick(onlyVerified);
    if (current) res.write(sseEvent("context", current));
    const client = { res, onlyVerified };
    clients.add(client);
    // Un único temporizador mientras haya clientes: mantiene viva la conexión y se apaga solo al quedarse sin ellos.
    heartbeat ??= setInterval(() => clients.forEach((c) => c.res.write(": ping\n\n")), HEARTBEAT_MS);
    heartbeat.unref();
    req.on("close", () => {
      clients.delete(client);
      if (clients.size === 0) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    });
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");
    assertAllowedHost(req, loopbackOnly);

    // App de escritorio: solo responde a la ventana de Electron, que manda el token de este arranque.
    const desktopToken = process.env.PANTALLA_DESKTOP_TOKEN;
    if (desktopToken && !tokenMatches(`Bearer ${req.headers["x-desktop-token"] ?? ""}`, null, desktopToken)) {
      throw new HttpError(403, "forbidden", "Acceso solo desde la aplicación de escritorio.");
    }

    if (apiToken && PROTECTED.has(url.pathname) && !tokenMatches(req.headers.authorization, url.searchParams.get("token"), apiToken)) {
      throw new HttpError(401, "unauthorized", "Token inválido o ausente (Authorization: Bearer <token>).");
    }

    // ?verified=true|only (solo verificado) o all|any (todo). Sin parámetro manda la configuración del servidor.
    const verifiedOnly = () => {
      const raw = url.searchParams.get("verified");
      if (raw === null) return exportMode !== "all";
      if (["true", "only", "1"].includes(raw)) return true;
      if (["all", "any", "false", "0"].includes(raw)) return false;
      throw new HttpError(400, "bad_verified", "verified debe ser true (solo verificado) o all (todo).");
    };

    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, 200, {
        backend: await backend.info(),
        modes: Object.entries(MODES).map(([id, m]) => ({ id, label: m.label })),
        languages: Object.keys(LANGUAGES),
        export: { mode: exportMode, ...tracker.config, activityGapSeconds: Math.round(staleMs / 1000), protected: Boolean(apiToken) },
      });
    }

    // Contexto actual. Por defecto SOLO verificado; ?max_age=60 descarta lo más viejo de 60 s.
    if (req.method === "GET" && (url.pathname === "/api/context" || url.pathname === "/api/latest")) {
      const format = url.searchParams.get("format") ?? "json";
      if (!["json", "text", "prompt"].includes(format)) throw new HttpError(400, "bad_format", "format debe ser json, text o prompt.");
      const maxAgeRaw = url.searchParams.get("max_age");
      const maxAge = maxAgeRaw === null ? null : Number(maxAgeRaw);
      if (maxAge !== null && !(maxAge >= 0)) throw new HttpError(400, "bad_max_age", "max_age debe ser un número de segundos.");
      const onlyVerified = verifiedOnly();
      const entry = pick(onlyVerified, maxAge);
      const candidate = tracker.snapshot({ onlyVerified: true }).candidate;
      const age = ageSeconds(entry);
      if (format === "json") {
        return sendJson(res, 200, { latest: entry, verified: Boolean(entry?.verified), age_seconds: age, candidate: entry ? null : candidate });
      }
      const language = url.searchParams.get("lang") ?? entry?.language ?? latestAny?.language ?? "es";
      const body = (format === "prompt" ? contextToPrompt : contextToText)(entry, { language, ageSeconds: age, candidate: entry ? null : candidate });
      res.writeHead(200, { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" });
      return res.end(body);
    }

    // Lo que estás haciendo y desde cuándo: actividad actual, las últimas y los eventos recientes.
    if (req.method === "GET" && url.pathname === "/api/session") {
      const format = url.searchParams.get("format") ?? "json";
      if (!["json", "text"].includes(format)) throw new HttpError(400, "bad_format", "format debe ser json o text.");
      const snapshot = tracker.snapshot({ onlyVerified: verifiedOnly() });
      if (format === "json") return sendJson(res, 200, snapshot);
      res.writeHead(200, { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" });
      return res.end(sessionToText(snapshot, { language: url.searchParams.get("lang") ?? latestAny?.language ?? "es" }));
    }

    // Flujo en vivo (Server-Sent Events): «context» con cada lectura exportable y «activity» con cada evento.
    if (req.method === "GET" && url.pathname === "/api/events") {
      return subscribe(req, res, verifiedOnly());
    }

    if (req.method === "POST" && url.pathname === "/api/analyze") {
      const info = await backend.info();
      if (!info.ready) throw new HttpError(503, "no_backend", info.hint ?? "No hay analizador disponible.");
      return sendJson(res, 200, await analyzeAndTrack(parseAnalyzeRequest(await readJsonBody(req))));
    }

    if (req.method === "GET" || req.method === "HEAD") {
      const file = PAGES[url.pathname] ?? (/^\/[\w-]+\.(?:js|css|svg)$/.test(url.pathname) ? url.pathname.slice(1) : null);
      if (file) {
        let data;
        try {
          data = await readFile(path.join(PUBLIC_DIR, file));
        } catch (err) {
          if (err.code === "ENOENT") throw new HttpError(404, "not_found", "No encontrado.");
          throw err;
        }
        res.writeHead(200, { ...SECURITY_HEADERS, "content-type": CONTENT_TYPES[path.extname(file)] });
        return res.end(req.method === "HEAD" ? undefined : data);
      }
    }

    throw new HttpError(404, "not_found", "No encontrado.");
  }

  const handler = withErrorHandling(handle);
  // API en proceso (sin HTTP) para quien integra esto como biblioteca; aplica las mismas reglas que la HTTP.
  handler.api = {
    context: ({ verified = exportMode !== "all", maxAge = null } = {}) => pick(verified, maxAge),
    activity: ({ verified = exportMode !== "all" } = {}) => tracker.snapshot({ onlyVerified: verified }),
    on(event, listener) {
      bus.on(event, listener);
      return () => bus.off(event, listener);
    },
    // Analiza una captura propia (JPEG/PNG/WebP como Buffer, base64 o data URL) con las mismas reglas que el visor.
    async analyzeImage(image, { mode = "auto", language = "es", note = "", publish = true } = {}) {
      const dataUrl = Buffer.isBuffer(image) ? `data:${sniffMediaType(image)};base64,${image.toString("base64")}` : String(image).startsWith("data:") ? String(image) : `data:image/jpeg;base64,${image}`;
      const request = parseAnalyzeRequest({ image: dataUrl, mode, language, note, history: recent.slice(-3), publish });
      const result = await analyzeAndTrack(request);
      if (!result.refused && publish) recent.push({ title: result.context.title, summary: result.context.summary });
      return result;
    },
    tracker,
  };
  return handler;
}
