// La línea de comandos: `npx pantalla-contexto [start|analyzer|mcp|context|activity|doctor]`.
// Los comandos que se quedan corriendo (start, analyzer, mcp) reutilizan server.js, analyzer.js y mcp.js;
// los que solo consultan (context, activity, doctor) devuelven un código de salida.
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { contextToPrompt, contextToText } from "../public/context-format.js";
import { createBackend } from "./backends/index.js";
import { createClient, PantallaError } from "./client.js";
import { loadConfig } from "./config.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const EXIT = { ok: 0, error: 1, usage: 2, nothingVerified: 3 };

const HELP = `Pantalla Contexto: mira tu pantalla, entiende qué haces y exporta SOLO el contexto verificado.

Uso: pantalla-contexto [comando] [opciones]

Comandos
  start (por defecto)  Arranca el visor: elige pantalla, ventana o pestaña y empieza a analizar.
  analyzer             Arranca solo el analizador (para otro equipo; el visor lo usa con PANTALLA_ANALYZER_URL).
  mcp                  Servidor MCP por stdio, para Claude Desktop, Claude Code, Cursor...
  context              Muestra el contexto verificado de un visor ya arrancado.
  activity             Muestra lo que has estado haciendo (actividad y eventos confirmados).
  doctor               Comprueba tu instalación: Node, OCR, Ollama, claves y puerto.

Opciones
  --port N             Puerto del visor (también PORT; por defecto 3000).
  --host H             Dirección en la que escucha (por defecto 127.0.0.1; no la cambies sin PANTALLA_API_TOKEN).
  --backend B          auto | ocr | ollama | gemini | claude (también PANTALLA_BACKEND).
  --export M           verified (por defecto: solo lo seguro) | all (también lo no verificado, marcado).
  --token T            Token de la API de exportación (también PANTALLA_API_TOKEN).
  --url U              Visor al que consultar o conectar (context, activity, mcp; también PANTALLA_URL).
  --open               Abre el visor en el navegador al arrancar.
  --format F           context: text (por defecto) | prompt | json.   activity: text | json.
  --all                context/activity: incluye también lo no verificado.
  --max-age S          context: descarta lo más viejo de S segundos.
  --lang es|en         Idioma de los textos.
  -h, --help           Esta ayuda.      -v, --version  Versión.

Códigos de salida de «context»: 0 hay contexto verificado, 3 no hay nada verificado todavía, 1 error.

Ejemplos
  npx pantalla-contexto --open                       Arranca el visor y lo abre.
  npx pantalla-contexto context --format prompt      Texto listo para pegar en otra IA.
  npx pantalla-contexto mcp                          Para añadirlo como servidor MCP.

Se lee un archivo .env de la carpeta actual si existe. Documentación: README.md.`;

const OPTIONS = {
  port: { type: "string" },
  host: { type: "string" },
  backend: { type: "string" },
  export: { type: "string" },
  token: { type: "string" },
  url: { type: "string" },
  open: { type: "boolean" },
  format: { type: "string" },
  all: { type: "boolean" },
  "max-age": { type: "string" },
  lang: { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
};

const COMMANDS = ["start", "analyzer", "mcp", "context", "activity", "doctor", "help"];

export function readVersion() {
  return JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
}

// Las opciones de la línea de comandos mandan sobre el entorno y el .env.
function applyFlags(values, env) {
  const map = { port: "PORT", host: "HOST", backend: "PANTALLA_BACKEND", export: "PANTALLA_EXPORT", token: "PANTALLA_API_TOKEN", url: "PANTALLA_URL" };
  for (const [flag, name] of Object.entries(map)) if (values[flag] !== undefined) env[name] = values[flag];
}

// `.env` de la carpeta actual: no pisa lo que ya esté definido en el entorno.
function loadDotEnv(cwd, env) {
  const file = path.join(cwd, ".env");
  if (!existsSync(file)) return;
  try {
    for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) if (!(key in env)) env[key] = value;
  } catch {
    // un .env ilegible no impide arrancar
  }
}

const out = (io, text) => io.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
const err = (io, text) => io.stderr.write(text.endsWith("\n") ? text : `${text}\n`);

async function commandContext(values, io) {
  const format = values.format ?? "text";
  if (!["text", "prompt", "json"].includes(format)) {
    err(io, `--format debe ser text, prompt o json (recibido: "${format}").`);
    return EXIT.usage;
  }
  const maxAge = values["max-age"] === undefined ? undefined : Number(values["max-age"]);
  if (maxAge !== undefined && !(maxAge >= 0)) {
    err(io, "--max-age debe ser un número de segundos.");
    return EXIT.usage;
  }
  const screen = createClient({ url: io.env.PANTALLA_URL, token: io.env.PANTALLA_API_TOKEN, ...(io.fetch ? { fetch: io.fetch } : {}) });
  const response = await screen.context({ verified: values.all ? false : undefined, maxAge, language: values.lang });
  const language = values.lang ?? response.latest?.language ?? "es";
  if (format === "json") out(io, JSON.stringify(response, null, 2));
  else out(io, (format === "prompt" ? contextToPrompt : contextToText)(response.latest, { language, ageSeconds: response.age_seconds, candidate: response.candidate }));
  return response.latest ? EXIT.ok : EXIT.nothingVerified;
}

async function commandActivity(values, io) {
  const format = values.format ?? "text";
  if (!["text", "json"].includes(format)) {
    err(io, `--format debe ser text o json (recibido: "${format}").`);
    return EXIT.usage;
  }
  const screen = createClient({ url: io.env.PANTALLA_URL, token: io.env.PANTALLA_API_TOKEN, ...(io.fetch ? { fetch: io.fetch } : {}) });
  const result = await screen.activity({ format, verified: values.all ? false : undefined, language: values.lang });
  out(io, format === "json" ? JSON.stringify(result, null, 2) : result);
  return EXIT.ok;
}

const portIsFree = (port, host) =>
  new Promise((resolve) => {
    const probe = net.createServer().once("error", () => resolve(false)).once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });

// Un diagnóstico que dice qué falta y cómo arreglarlo. Devuelve 0 si hay al menos un analizador listo.
export async function commandDoctor(io) {
  const lines = [];
  const mark = { ok: "✔", warn: "•", bad: "✘" };
  const add = (kind, text) => lines.push(`${mark[kind]} ${text}`);
  let failed = false;

  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major > 22 || (major === 22 && minor >= 9)) add("ok", `Node ${process.versions.node}`);
  else (add("bad", `Node ${process.versions.node}: hace falta 22.9 o superior (nodejs.org).`), (failed = true));

  let config;
  try {
    config = loadConfig(io.env);
    add("ok", "Configuración válida");
  } catch (e) {
    add("bad", `Configuración inválida: ${e.message}`);
    out(io, lines.join("\n"));
    return EXIT.error;
  }

  // OCR: es el motor que no necesita nada más; si falla, normalmente falta `npm install`.
  const backend = createBackend({ ...config, backend: "ocr", analyzerUrl: null });
  const ocr = await backend.info();
  await backend.close?.();
  if (ocr.ready) add("ok", `OCR integrado listo (${ocr.model}): funciona sin Ollama ni claves`);
  else add("bad", `OCR integrado no disponible: ${ocr.hint}`);

  // Ollama (opcional): solo se mira si responde; no se exige.
  let ollamaReady = false;
  try {
    const res = await (io.fetch ?? fetch)(`${config.ollama.host}/api/tags`, { signal: AbortSignal.timeout(1500) });
    const body = res.ok ? await res.json() : null;
    const has = body?.models?.some((m) => m.name === config.ollama.model || m.name.startsWith(`${config.ollama.model}:`));
    ollamaReady = Boolean(has);
    if (has) add("ok", `Ollama responde y tiene ${config.ollama.model}`);
    else if (body) add("warn", `Ollama responde pero falta el modelo: ollama pull ${config.ollama.model} (opcional)`);
    else add("warn", `Ollama respondió ${res.status} (opcional)`);
  } catch {
    add("warn", `Ollama no responde en ${config.ollama.host} (opcional: el OCR ya analiza sin él)`);
  }

  add(config.gemini.apiKey ? "ok" : "warn", config.gemini.apiKey ? "GEMINI_API_KEY definida" : "GEMINI_API_KEY sin definir (opcional)");
  add(config.claude.configured ? "ok" : "warn", config.claude.configured ? "Credenciales de Anthropic definidas" : "ANTHROPIC_API_KEY sin definir (opcional)");

  const free = await portIsFree(config.port, config.host);
  add(free ? "ok" : "warn", free ? `Puerto ${config.port} libre` : `Puerto ${config.port} ocupado: usa --port (o ya hay un visor arrancado)`);

  const ready = ocr.ready || ollamaReady || config.gemini.apiKey || config.claude.configured;
  lines.push("");
  if (!ready || failed) {
    lines.push("Resultado: NO hay ningún analizador listo. Ejecuta npm install y vuelve a probar.");
    out(io, lines.join("\n"));
    return EXIT.error;
  }
  lines.push(`Resultado: todo listo. Con PANTALLA_BACKEND=${config.backend} se usará ${config.backend === "auto" ? (ollamaReady ? "Ollama" : config.gemini.apiKey ? "Gemini" : config.claude.configured ? "Claude" : "el OCR integrado") : config.backend}.`);
  out(io, lines.join("\n"));
  return EXIT.ok;
}

// Abre el visor en el navegador del sistema (si falla, no pasa nada: la dirección ya está en pantalla).
async function openBrowser(url) {
  const { spawn } = await import("node:child_process");
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // sin navegador disponible
  }
}

// `argv` sin node ni el script. `io` permite sustituir stdout/stderr/env/cwd/fetch en las pruebas.
// Devuelve el código de salida; start, analyzer y mcp se quedan corriendo y devuelven null (el proceso sigue vivo).
export async function main(argv, io = {}) {
  io = { stdout: process.stdout, stderr: process.stderr, env: process.env, cwd: process.cwd(), ...io };
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (e) {
    err(io, `${e.message}\nEjecuta «pantalla-contexto --help» para ver las opciones.`);
    return EXIT.usage;
  }
  const { values, positionals } = parsed;
  if (values.help) return (out(io, HELP), EXIT.ok);
  if (values.version) return (out(io, readVersion()), EXIT.ok);

  const command = positionals[0] ?? "start";
  if (positionals.length > 1 || !COMMANDS.includes(command)) {
    err(io, `Comando desconocido: "${positionals.join(" ")}". Comandos: ${COMMANDS.filter((c) => c !== "help").join(", ")}.`);
    return EXIT.usage;
  }
  if (command === "help") return (out(io, HELP), EXIT.ok);

  if (!io.skipDotEnv) loadDotEnv(io.cwd, io.env);
  applyFlags(values, io.env);

  try {
    if (command === "context") return await commandContext(values, io);
    if (command === "activity") return await commandActivity(values, io);
    if (command === "doctor") return await commandDoctor(io);
  } catch (e) {
    err(io, e instanceof PantallaError ? e.message : `Error: ${e.message}`);
    return EXIT.error;
  }

  // Comandos que se quedan corriendo: usan el entorno real del proceso.
  if (io.env !== process.env) Object.assign(process.env, io.env);
  if (command === "analyzer") await import("../analyzer.js");
  else if (command === "mcp") await import("../mcp.js");
  else {
    await import("../server.js");
    if (values.open) {
      const host = process.env.HOST && process.env.HOST !== "0.0.0.0" ? process.env.HOST : "127.0.0.1";
      await openBrowser(`http://${host === "::1" ? "[::1]" : host}:${process.env.PORT || 3000}`);
    }
  }
  return null;
}
