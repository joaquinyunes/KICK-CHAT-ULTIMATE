import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { createMcpHandler, PROTOCOL_VERSIONS, TOOLS } from "../src/mcp.js";
import { startMock } from "./helpers.js";

const make = (fetchContext = async () => "CONTEXTO") => createMcpHandler({ fetchContext });
const rpc = (method, params, id = 1) => ({ jsonrpc: "2.0", id, method, params });

test("initialize negocia la versión del protocolo y anuncia solo herramientas", async () => {
  const handle = make();
  for (const version of PROTOCOL_VERSIONS) {
    const res = await handle(rpc("initialize", { protocolVersion: version, capabilities: {}, clientInfo: { name: "t", version: "1" } }));
    assert.equal(res.result.protocolVersion, version, "si el cliente pide una versión que conocemos, se la devolvemos");
  }
  const unknown = await handle(rpc("initialize", { protocolVersion: "1999-01-01" }));
  assert.equal(unknown.result.protocolVersion, PROTOCOL_VERSIONS[0]);
  assert.deepEqual(unknown.result.capabilities, { tools: {} });
  assert.equal(unknown.result.serverInfo.name, "pantalla-contexto");
  assert.equal(unknown.id, 1);
});

test("ping y tools/list: dos herramientas de solo lectura", async () => {
  const handle = make();
  assert.deepEqual((await handle(rpc("ping"))).result, {});
  const { tools } = (await handle(rpc("tools/list"))).result;
  assert.deepEqual(tools, TOOLS);
  assert.deepEqual(tools.map((t) => t.name), ["get_screen_context", "get_screen_activity"]);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.annotations.readOnlyHint, true);
  }
  assert.match(tools[0].description, /VERIFIED/);
  assert.deepEqual(tools[0].inputSchema.properties.verified.enum, ["only", "any"]);
  assert.ok(!("verified" in tools[1].inputSchema.properties), "la actividad no tiene modo «any»");
});

test("tools/call pasa herramienta, formato, idioma y verificación (con valores por defecto) y devuelve el texto", async () => {
  const calls = [];
  const handle = make(async (args) => (calls.push(args), "EL CONTEXTO"));
  const byDefault = await handle(rpc("tools/call", { name: "get_screen_context" }));
  assert.deepEqual(byDefault.result, { content: [{ type: "text", text: "EL CONTEXTO" }], isError: false });
  await handle(rpc("tools/call", { name: "get_screen_context", arguments: { format: "json", language: "en", verified: "any" } }));
  await handle(rpc("tools/call", { name: "get_screen_activity", arguments: { language: "en" } }));
  assert.deepEqual(calls, [
    { tool: "get_screen_context", format: "text", language: "es", verified: "only" },
    { tool: "get_screen_context", format: "json", language: "en", verified: "any" },
    { tool: "get_screen_activity", format: "text", language: "en", verified: "only" },
  ]);
});

test("herramienta desconocida y argumentos inválidos son errores de parámetros (-32602)", async () => {
  const handle = make(async () => assert.fail("no debe llamarse"));
  assert.equal((await handle(rpc("tools/call", { name: "borrar_todo" }))).error.code, -32602);
  assert.equal((await handle(rpc("tools/call", { name: "get_screen_context", arguments: { format: "xml" } }))).error.code, -32602);
  assert.equal((await handle(rpc("tools/call", { name: "get_screen_context", arguments: { language: "fr" } }))).error.code, -32602);
  assert.equal((await handle(rpc("tools/call", { name: "get_screen_context", arguments: { verified: "quizas" } }))).error.code, -32602);
  assert.equal((await handle(rpc("tools/call", { name: "get_screen_activity", arguments: { verified: "any" } }))).error.code, -32602, "la actividad no admite verified");
});

test("si no se puede obtener el contexto, el fallo llega al modelo como resultado con isError", async () => {
  const res = await make(async () => {
    throw new Error("No se pudo conectar con Pantalla Contexto");
  })(rpc("tools/call", { name: "get_screen_context" }));
  assert.deepEqual(res.result, { content: [{ type: "text", text: "No se pudo conectar con Pantalla Contexto" }], isError: true });
  assert.ok(!("error" in res));
});

test("las notificaciones no se responden; los métodos desconocidos con id dan -32601", async () => {
  const handle = make();
  assert.equal(await handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  assert.equal(await handle({ jsonrpc: "2.0", method: "algo/raro" }), null);
  assert.equal((await handle(rpc("algo/raro", {}, 7))).error.code, -32601);
});

test("mensajes que no son JSON-RPC 2.0 válidos dan -32600", async () => {
  const handle = make();
  for (const bad of [null, "texto", 5, [], { id: 1, method: "ping" }, { jsonrpc: "1.0", id: 1, method: "ping" }]) {
    assert.equal((await handle(bad)).error.code, -32600, JSON.stringify(bad));
  }
});

// Prueba con el ejecutable real: stdout solo puede llevar JSON-RPC, una línea por mensaje.
test("mcp.js por stdio: stdout solo lleva JSON-RPC y obtiene contexto y actividad del visor (con token si lo hay)", async () => {
  const viewer = await startMock((req) => {
    if (req.url.startsWith("/api/context")) return { text: "CONTEXTO DE PANTALLA\nTipo: Casino" };
    if (req.url.startsWith("/api/session")) return { text: "ACTIVIDAD\nAhora: Casino" };
    return { status: 404 };
  });
  const child = spawn(process.execPath, ["mcp.js"], { cwd: new URL("..", import.meta.url).pathname, env: { PATH: process.env.PATH, PANTALLA_URL: viewer.url, PANTALLA_API_TOKEN: "s3creto" } });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const lines = [];
  let buffer = "";
  const waiters = [];
  child.stdout.on("data", (d) => {
    buffer += d;
    for (let i = buffer.indexOf("\n"); i !== -1; i = buffer.indexOf("\n")) {
      lines.push(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      waiters.splice(0).forEach((w) => w());
    }
  });
  const send = (message) => child.stdin.write(`${typeof message === "string" ? message : JSON.stringify(message)}\n`);
  const reply = (count) => new Promise((ok, no) => {
    const check = () => (lines.length >= count ? ok(JSON.parse(lines[count - 1])) : waiters.push(check));
    setTimeout(() => no(new Error(`faltan respuestas (hay ${lines.length}, stderr: ${stderr})`)), 5000).unref();
    check();
  });

  try {
    send(rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }, 1));
    assert.equal((await reply(1)).result.serverInfo.name, "pantalla-contexto");
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send(rpc("tools/list", {}, 2));
    assert.deepEqual((await reply(2)).result.tools.map((t) => t.name), ["get_screen_context", "get_screen_activity"]);
    send(rpc("tools/call", { name: "get_screen_context", arguments: { language: "en" } }, 3));
    assert.equal((await reply(3)).result.content[0].text, "CONTEXTO DE PANTALLA\nTipo: Casino");
    assert.equal(viewer.requests.at(-1).path, "/api/context?format=text&lang=en&verified=true", "por defecto solo lo verificado");
    assert.equal(viewer.requests.at(-1).headers.authorization, "Bearer s3creto");
    send(rpc("tools/call", { name: "get_screen_context", arguments: { verified: "any" } }, 4));
    await reply(4);
    assert.match(viewer.requests.at(-1).path, /verified=all$/);
    send(rpc("tools/call", { name: "get_screen_activity" }, 5));
    assert.equal((await reply(5)).result.content[0].text, "ACTIVIDAD\nAhora: Casino");
    assert.equal(viewer.requests.at(-1).path, "/api/session?format=text&lang=es&verified=true");
    send("esto no es json");
    assert.equal((await reply(6)).error.code, -32700);
    assert.equal(lines.length, 6, "la notificación no produjo respuesta");
    assert.ok(lines.every((l) => JSON.parse(l).jsonrpc === "2.0"), "nada que no sea JSON-RPC en stdout");
    assert.match(stderr, /MCP listo/);
  } finally {
    child.kill();
    await viewer.close();
  }
});

test("mcp.js: sin nada verificado en formato json lo explica en texto, con el candidato", async () => {
  const viewer = await startMock(() => ({ json: { latest: null, verified: false, age_seconds: null, candidate: { title: "Casino: X", category: "casino", certainty: 0.62, confirmations: 1, needed: 2 } } }));
  const child = spawn(process.execPath, ["mcp.js"], { cwd: new URL("..", import.meta.url).pathname, env: { PATH: process.env.PATH, PANTALLA_URL: viewer.url } });
  try {
    const answer = await new Promise((resolve, reject) => {
      let out = "";
      child.stdout.on("data", (d) => {
        out += d;
        if (out.includes("\n")) resolve(JSON.parse(out));
      });
      setTimeout(() => reject(new Error("sin respuesta")), 8000).unref();
      child.stdin.write(`${JSON.stringify(rpc("tools/call", { name: "get_screen_context", arguments: { format: "json" } }))}\n`);
    });
    assert.match(answer.result.content[0].text, /^Todavía no hay contexto verificado\. Candidato: «Casino: X» \(certeza 62 %/);
  } finally {
    child.kill();
    await viewer.close();
  }
});

test("mcp.js: un 401 del visor explica que falta el token", async () => {
  const viewer = await startMock(() => ({ status: 401, json: { error: "unauthorized" } }));
  const child = spawn(process.execPath, ["mcp.js"], { cwd: new URL("..", import.meta.url).pathname, env: { PATH: process.env.PATH, PANTALLA_URL: viewer.url } });
  try {
    const answer = await new Promise((resolve, reject) => {
      let out = "";
      child.stdout.on("data", (d) => {
        out += d;
        if (out.includes("\n")) resolve(JSON.parse(out));
      });
      setTimeout(() => reject(new Error("sin respuesta")), 8000).unref();
      child.stdin.write(`${JSON.stringify(rpc("tools/call", { name: "get_screen_activity" }))}\n`);
    });
    assert.equal(answer.result.isError, true);
    assert.match(answer.result.content[0].text, /PANTALLA_API_TOKEN/);
  } finally {
    child.kill();
    await viewer.close();
  }
});

test("mcp.js: si el visor no está arrancado, la herramienta lo explica en vez de colgarse", async () => {
  const dead = await startMock(() => ({}));
  const deadUrl = dead.url;
  await dead.close();
  const child = spawn(process.execPath, ["mcp.js"], { cwd: new URL("..", import.meta.url).pathname, env: { PATH: process.env.PATH, PANTALLA_URL: deadUrl } });
  try {
    const answer = await new Promise((resolve, reject) => {
      let out = "";
      child.stdout.on("data", (d) => {
        out += d;
        if (out.includes("\n")) resolve(JSON.parse(out));
      });
      setTimeout(() => reject(new Error("sin respuesta")), 8000).unref();
      child.stdin.write(`${JSON.stringify(rpc("tools/call", { name: "get_screen_context" }))}\n`);
    });
    assert.equal(answer.result.isError, true);
    assert.match(answer.result.content[0].text, /No se pudo conectar con Pantalla Contexto.*npm start/);
  } finally {
    child.kill();
  }
});
