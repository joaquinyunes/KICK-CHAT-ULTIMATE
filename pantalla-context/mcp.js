// Servidor MCP por stdio: conecta una app de IA con Pantalla Contexto.
// Las apps MCP lanzan este proceso y hablan con él por stdin/stdout, así que stdout SOLO lleva mensajes JSON-RPC:
// cualquier mensaje para humanos va a stderr.
import readline from "node:readline";
import { contextToText } from "./public/context-format.js";
import { createMcpHandler } from "./src/mcp.js";

const baseUrl = (process.env.PANTALLA_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const token = process.env.PANTALLA_API_TOKEN || null;

async function fetchContext({ tool, format, language, verified }) {
  const query = new URLSearchParams({ format, lang: language });
  if (tool === "get_screen_context") query.set("verified", verified === "any" ? "all" : "true");
  else query.set("verified", "true");
  const endpoint = tool === "get_screen_activity" ? "/api/session" : "/api/context";
  let res;
  try {
    res = await fetch(`${baseUrl}${endpoint}?${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(5000) });
  } catch {
    throw new Error(`No se pudo conectar con Pantalla Contexto en ${baseUrl}. ¿Está arrancado (npm start)? Si usa otro puerto, define PANTALLA_URL.`);
  }
  if (res.status === 401) throw new Error("Pantalla Contexto exige un token: define PANTALLA_API_TOKEN en la configuración de este servidor MCP.");
  if (!res.ok) throw new Error(`Pantalla Contexto respondió ${res.status}.`);
  const body = await res.text();
  // Con formato json y sin nada verificado, `latest` es null: se explica en texto, que es lo que el modelo aprovecha.
  if (format === "json" && tool === "get_screen_context") {
    const data = JSON.parse(body);
    if (data.latest === null) return contextToText(null, { language, candidate: data.candidate });
  }
  return body;
}

const handle = createMcpHandler({ fetchContext });
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido." } });
  }
  const response = await handle(message);
  if (response) send(response);
});

console.error(`Pantalla Contexto MCP listo (lee ${baseUrl}).`);
