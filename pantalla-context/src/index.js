// Pantalla Contexto como biblioteca: arranca el visor y devuelve el contexto verificado a tu código.
//   import { startPantallaContexto } from "pantalla-contexto";
//   const screen = await startPantallaContexto({ port: 3000 });
//   screen.on("context", (c) => console.log(c.title));
// Mismas reglas que `npm start`: solo se exporta lo verificado, salvo que pidas exportMode: "all".
import http from "node:http";
import { createApp } from "./app.js";
import { createBackend } from "./backends/index.js";
import { loadConfig } from "./config.js";
import { createTracker } from "./tracker.js";
import { createWebhook } from "./webhook.js";

// Opciones propias -> variables de entorno, para que haya UN solo sitio que valide la configuración (config.js).
const OPTION_TO_ENV = {
  port: "PORT",
  host: "HOST",
  backend: "PANTALLA_BACKEND",
  exportMode: "PANTALLA_EXPORT",
  apiToken: "PANTALLA_API_TOKEN",
  minCertainty: "PANTALLA_MIN_CERTAINTY",
  stableFrames: "PANTALLA_STABLE_FRAMES",
  switchFrames: "PANTALLA_SWITCH_FRAMES",
  activityGapSeconds: "PANTALLA_ACTIVITY_GAP_S",
  ocrLangs: "PANTALLA_OCR_LANGS",
  knowledgeFile: "PANTALLA_KNOWLEDGE_FILE",
  analyzerUrl: "PANTALLA_ANALYZER_URL",
};

const UNKNOWN_OPTION = (name) => `Opción desconocida: "${name}". Opciones válidas: ${[...Object.keys(OPTION_TO_ENV), "env", "webhook", "onContext", "log"].join(", ")}.`;

export function buildConfig(options = {}) {
  const { env = process.env, webhook, onContext, log, ...rest } = options;
  const overrides = {};
  for (const [name, value] of Object.entries(rest)) {
    if (!(name in OPTION_TO_ENV)) throw new Error(UNKNOWN_OPTION(name));
    if (value === undefined || value === null) continue;
    if (name === "port" && value === 0) continue; // puerto libre: lo valida después, no es un valor de PORT
    overrides[OPTION_TO_ENV[name]] = String(value);
  }
  if (webhook) {
    overrides.PANTALLA_WEBHOOK_URL = webhook.url;
    if (webhook.secret) overrides.PANTALLA_WEBHOOK_SECRET = webhook.secret;
  }
  const config = loadConfig({ ...env, ...overrides });
  if (rest.port === 0) config.port = 0;
  return config;
}

// Arranca el visor. Devuelve { url, port, host, config, info(), context(), activity(), analyzeImage(), on(), close() }.
// Falla (promesa rechazada) si la configuración es inválida o el puerto está ocupado.
export async function startPantallaContexto(options = {}) {
  const config = buildConfig(options);
  const log = options.log ?? (() => {});
  const backend = createBackend(config);

  const sinks = [];
  if (config.webhook) sinks.push(createWebhook(config.webhook));
  if (options.onContext) sinks.push(options.onContext);
  const onContext = sinks.length ? (entry, extra) => sinks.forEach((sink) => Promise.resolve(sink(entry, extra)).catch(() => {})) : undefined;

  const { exportMode, ...trackerOptions } = config.tracking;
  const tracker = createTracker(trackerOptions);
  const app = createApp({ backend, tracker, exportMode, apiToken: config.apiToken, loopbackOnly: config.loopbackOnly, onContext });
  const server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  }).catch(async (err) => {
    await backend.close?.();
    throw err;
  });

  const { port } = server.address();
  const shown = config.host === "::1" ? "[::1]" : config.host;
  const url = `http://${shown}:${port}`;
  log(`Pantalla Contexto en ${url}`);

  let closing = null;
  return {
    url,
    port,
    host: config.host,
    config,
    info: () => backend.info(),
    // Mismas reglas que /api/context y /api/session; por defecto solo lo verificado (según exportMode).
    context: (opts) => app.api.context(opts),
    activity: (opts) => app.api.activity(opts),
    // Analiza una captura propia (Buffer JPEG/PNG/WebP o base64) sin pasar por el navegador.
    analyzeImage: (image, opts) => app.api.analyzeImage(image, opts),
    // "context" (contexto verificado nuevo), "activity" (evento confirmado), "reading" (cada lectura). Devuelve cómo darse de baja.
    on: (event, listener) => app.api.on(event, listener),
    close() {
      closing ??= (async () => {
        server.close();
        server.closeAllConnections?.();
        await new Promise((resolve) => (server.listening ? server.once("close", resolve) : resolve()));
        await backend.close?.();
      })();
      return closing;
    },
  };
}

export { createClient, PantallaError } from "./client.js";
