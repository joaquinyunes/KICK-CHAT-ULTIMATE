// El visor: interfaz web, vigilancia de pantalla y overlay de OBS.
// El análisis lo hace un motor local o, si hay PANTALLA_ANALYZER_URL, otro proceso (analyzer.js).
// La lógica vive en src/index.js (también se usa como biblioteca); aquí solo se arranca y se cuenta por consola.
import { startPantallaContexto } from "./src/index.js";

let screen;
try {
  screen = await startPantallaContexto({ env: process.env });
} catch (err) {
  console.error(err.code === "EADDRINUSE" ? `El puerto ya está en uso (${err.port}). Usa otro con PORT=3001 o --port 3001.` : err.message);
  process.exit(1);
}

const { config, url } = screen;
const { exportMode, minCertainty, stableFrames } = config.tracking;

console.log(`Pantalla Contexto (visor) en ${url}`);
console.log(`Overlay para OBS:           ${url}/overlay`);
console.log(`Contexto para otra IA:      ${url}/api/context?format=prompt`);
console.log(`Actividad (qué haces):      ${url}/api/session?format=text`);
console.log(`Exportación: ${exportMode === "verified" ? `solo lo verificado (certeza ≥ ${Math.round(minCertainty * 100)} % y ${stableFrames} lecturas seguidas)` : "todo, marcando lo no verificado"}${config.apiToken ? " · protegida con token" : ""}`);
if (config.webhook) console.log(`Webhook: cada contexto nuevo se envía a ${config.webhook.url}`);

const info = await screen.info();
if (info.ready) {
  console.log(`Analizador: ${info.name} · ${info.model} · ${info.cost}`);
} else {
  console.warn(`AVISO: ${info.hint}`);
}
if (!config.loopbackOnly) {
  console.warn("AVISO: escuchando fuera de localhost. Cualquiera con acceso podrá usar tu analizador.");
}

// Cierre limpio: libera el OCR (memoria) y las conexiones abiertas.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => screen.close().finally(() => process.exit(0)));
}
