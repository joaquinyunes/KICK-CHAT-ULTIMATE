// El analizador: servicio aparte que recibe capturas y devuelve el contexto.
// Se puede ejecutar en otro equipo (p. ej. uno con más CPU/GPU) para no cargar el PC del stream.
import http from "node:http";
import { createAnalyzerService } from "./src/analyzer-service.js";
import { createLocalBackend } from "./src/backends/index.js";
import { loadConfig } from "./src/config.js";

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const { port, host, loopbackOnly, token } = config.analyzer;
if (!loopbackOnly && !token) {
  console.error("Para escuchar fuera de localhost define PANTALLA_ANALYZER_TOKEN (un secreto largo y aleatorio).");
  process.exit(1);
}

// Aquí se ignora PANTALLA_ANALYZER_URL a propósito: este proceso es el analizador, no un cliente.
let backend;
try {
  backend = createLocalBackend(config);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

http.createServer(createAnalyzerService({ backend, token, loopbackOnly })).listen(port, host, async () => {
  console.log(`Pantalla Contexto (analizador) en http://${host}:${port}`);
  const info = await backend.info();
  if (info.ready) {
    console.log(`Motor: ${info.name} · ${info.model} · ${info.cost}`);
  } else {
    console.warn(`AVISO: ${info.hint}`);
  }
  if (!loopbackOnly) {
    console.warn("Las capturas viajan sin cifrar por la red. Úsalo solo en una red de confianza (o con Tailscale/VPN/túnel SSH).");
  }
});
