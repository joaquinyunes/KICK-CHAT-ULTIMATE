import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { EXIT, main, readVersion } from "../src/cli.js";
import { startPantallaContexto } from "../src/index.js";
import { deadUrl } from "./helpers.js";

const BIN = new URL("../bin/pantalla-contexto.js", import.meta.url).pathname;
const casino = readFileSync(new URL("./fixtures/casino.jpg", import.meta.url));
const children = [];
after(() => children.forEach((c) => c.kill()));

function run(argv, env = {}) {
  let stdout = "";
  let stderr = "";
  const io = { stdout: { write: (t) => (stdout += t) }, stderr: { write: (t) => (stderr += t) }, env: { ...env }, skipDotEnv: true };
  return main(argv, io).then((code) => ({ code, stdout, stderr }));
}

const freePort = async () => {
  const s = http.createServer().listen(0, "127.0.0.1");
  await new Promise((r) => s.once("listening", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
};

test("--help, --version y comandos mal escritos", async () => {
  const help = await run(["--help"]);
  assert.equal(help.code, EXIT.ok);
  for (const word of ["start", "analyzer", "mcp", "context", "activity", "doctor", "--export", "verificado"]) assert.ok(help.stdout.includes(word), word);
  assert.equal((await run(["help"])).stdout, help.stdout);
  assert.equal((await run(["-v"])).stdout.trim(), readVersion());

  const unknown = await run(["empezar"]);
  assert.equal(unknown.code, EXIT.usage);
  assert.match(unknown.stderr, /Comando desconocido: "empezar"/);
  const badFlag = await run(["context", "--formato", "x"]);
  assert.equal(badFlag.code, EXIT.usage);
  assert.match(badFlag.stderr, /--help/);
  assert.equal((await run(["context", "extra"])).code, EXIT.usage);
});

test("context y activity: sin visor arrancado explican qué hacer; con visor, el código de salida dice si hay algo verificado", async () => {
  const down = await run(["context", "--url", await deadUrl()]);
  assert.equal(down.code, EXIT.error);
  assert.match(down.stderr, /No se pudo conectar/);

  const screen = await startPantallaContexto({ env: {}, port: 0, backend: "ocr", stableFrames: 2 });
  try {
    const empty = await run(["context", "--url", screen.url]);
    assert.equal(empty.code, EXIT.nothingVerified, "sin nada verificado, el código de salida lo dice");
    assert.ok(empty.stdout.length > 0, "y lo explica en texto en vez de quedarse mudo");

    await screen.analyzeImage(casino);
    assert.equal((await run(["context", "--url", screen.url])).code, EXIT.nothingVerified, "una sola lectura no basta");
    await screen.analyzeImage(casino);

    const text = await run(["context", "--url", screen.url]);
    assert.equal(text.code, EXIT.ok);
    assert.match(text.stdout, /[Cc]asino/);
    const prompt = await run(["context", "--url", screen.url, "--format", "prompt", "--lang", "en"]);
    assert.equal(prompt.code, EXIT.ok);
    assert.match(prompt.stdout, /untrusted|not instructions|instruction/i);
    const json = JSON.parse((await run(["context", "--url", screen.url, "--format", "json"])).stdout);
    assert.equal(json.latest.category, "casino");
    assert.equal(json.verified, true);
    for (const bad of ["--max-age=-1", "--max-age=abc"]) {
      const result = await run(["context", "--url", screen.url, bad]);
      assert.equal(result.code, EXIT.usage);
      assert.match(result.stderr, /--max-age debe ser un número/);
    }
    assert.equal((await run(["context", "--url", screen.url, "--format", "xml"])).code, EXIT.usage);

    const activity = await run(["activity", "--url", screen.url]);
    assert.equal(activity.code, EXIT.ok);
    assert.ok(activity.stdout.length > 0);
    assert.equal(JSON.parse((await run(["activity", "--url", screen.url, "--format", "json"])).stdout).current.category, "casino");
  } finally {
    await screen.close();
  }
});

test("context con token: sin token falla con un mensaje claro; con --token funciona", async () => {
  const screen = await startPantallaContexto({ env: {}, port: 0, backend: "ocr", stableFrames: 1, apiToken: "token-largo-de-prueba" });
  try {
    await screen.analyzeImage(casino);
    const denied = await run(["context", "--url", screen.url]);
    assert.equal(denied.code, EXIT.error);
    assert.match(denied.stderr, /token/);
    assert.equal((await run(["context", "--url", screen.url, "--token", "token-largo-de-prueba"])).code, EXIT.ok);
    assert.equal((await run(["context", "--url", screen.url], { PANTALLA_API_TOKEN: "token-largo-de-prueba" })).code, EXIT.ok);
  } finally {
    await screen.close();
  }
});

test("doctor: con el OCR integrado todo está listo sin Ollama ni claves; un puerto ocupado o una config inválida se avisan", async () => {
  const env = { OLLAMA_HOST: await deadUrl(), PORT: String(await freePort()) };
  const ok = await run(["doctor"], env);
  assert.equal(ok.code, EXIT.ok, ok.stdout);
  assert.match(ok.stdout, /✔ OCR integrado listo/);
  assert.match(ok.stdout, /• Ollama no responde/);
  assert.match(ok.stdout, /todo listo/);

  const blocker = http.createServer().listen(0, "127.0.0.1");
  await new Promise((r) => blocker.once("listening", r));
  try {
    const busy = await run(["doctor"], { ...env, PORT: String(blocker.address().port) });
    assert.match(busy.stdout, /Puerto \d+ ocupado/);
    assert.equal(busy.code, EXIT.ok, "un puerto ocupado avisa pero no impide el diagnóstico");
  } finally {
    blocker.close();
  }

  const bad = await run(["doctor"], { ...env, PANTALLA_EXPORT: "casi" });
  assert.equal(bad.code, EXIT.error);
  assert.match(bad.stdout, /✘ Configuración inválida.*PANTALLA_EXPORT/);
});

test("el ejecutable real: arranca desde OTRA carpeta, lee su .env, responde y context devuelve el código de salida correcto", async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "pantalla-proyecto-"));
  const port = await freePort();
  writeFileSync(path.join(project, ".env"), `PORT=${port}\nPANTALLA_BACKEND=ocr\n# comentario\n`);

  const child = spawn(process.execPath, [BIN], { cwd: project, env: { PATH: process.env.PATH } });
  children.push(child);
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const end = Date.now() + 10_000;
  while (!/Analizador:/.test(output) && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  assert.match(output, new RegExp(`Pantalla Contexto \\(visor\\) en http://127\\.0\\.0\\.1:${port}`), output);
  assert.match(output, /Analizador: ocr/);
  assert.match(output, /solo lo verificado/);

  const config = await (await fetch(`http://127.0.0.1:${port}/api/config`)).json();
  assert.equal(config.export.mode, "verified");

  const ask = spawnSync(process.execPath, [BIN, "context", "--url", `http://127.0.0.1:${port}`], { cwd: project, env: { PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(ask.status, EXIT.nothingVerified, ask.stderr);

  child.kill("SIGTERM");
  const code = await new Promise((r) => child.once("exit", r));
  assert.equal(code, 0, "SIGTERM cierra limpio");
});

test("--port y --export de la línea de comandos mandan sobre el entorno", async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [BIN, "start", "--port", String(port), "--export", "all", "--backend", "ocr"], { env: { PATH: process.env.PATH, PORT: "1" } });
  children.push(child);
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const end = Date.now() + 10_000;
  while (!/Analizador:/.test(output) && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  assert.match(output, new RegExp(`:${port}`));
  assert.match(output, /todo, marcando lo no verificado/);
  child.kill();
});
