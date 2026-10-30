import assert from "node:assert/strict";
import { test } from "node:test";
import { createBackend, createLocalBackend } from "../src/backends/index.js";
import { loadConfig } from "../src/config.js";
import { readFileSync } from "node:fs";
import { deadUrl, GOOD_RESULT, REQ, startMock } from "./helpers.js";

const config = (env) => loadConfig({ ...env });

test("auto: prefiere Ollama si está listo y analiza con él", async () => {
  const mock = await startMock((req) =>
    req.url === "/api/tags"
      ? { json: { models: [{ name: "qwen3-vl:2b" }] } }
      : { json: { message: { content: JSON.stringify(GOOD_RESULT) }, done: true, done_reason: "stop" } },
  );
  try {
    const backend = createLocalBackend(config({ OLLAMA_HOST: mock.url, GEMINI_API_KEY: "k", ANTHROPIC_API_KEY: "k" }));
    const info = await backend.info();
    assert.deepEqual([info.ready, info.name, info.cost], [true, "ollama", "free-local"]);
    const out = await backend.analyze(REQ);
    assert.equal(out.result.title, "Jugando Sweet Bonanza");
    assert.ok(mock.requests.some((r) => r.path === "/api/chat"));
  } finally {
    await mock.close();
  }
});

test("auto: sin Ollama usa Gemini si hay clave, y si no Claude, siempre gratis antes que de pago (y todo antes que el OCR)", async () => {
  const host = await deadUrl();
  const withGemini = await createLocalBackend(config({ OLLAMA_HOST: host, GEMINI_API_KEY: "k", ANTHROPIC_API_KEY: "k" })).info();
  assert.deepEqual([withGemini.ready, withGemini.name, withGemini.cost], [true, "gemini", "free-tier"]);

  const onlyClaude = await createLocalBackend(config({ OLLAMA_HOST: host, ANTHROPIC_API_KEY: "k" })).info();
  assert.deepEqual([onlyClaude.ready, onlyClaude.name, onlyClaude.cost], [true, "claude", "paid"]);
});

test("auto: sin Ollama ni claves cae al OCR integrado, que no necesita nada y ya está listo", async () => {
  const info = await createLocalBackend(config({ OLLAMA_HOST: await deadUrl() })).info();
  assert.deepEqual([info.ready, info.name, info.cost, info.local], [true, "ocr", "free-local", true]);
  assert.deepEqual([info.maxSide, info.minSide, info.quality], [1600, 1280, 0.9]);
});

test("auto: si ni el OCR se puede cargar, explica las alternativas con lo gratuito primero", async () => {
  const info = await createLocalBackend(config({ OLLAMA_HOST: await deadUrl(), PANTALLA_OCR_LANGS: "zzz" })).info();
  assert.equal(info.ready, false);
  const { hint } = info;
  assert.ok(hint.includes("npm install") && hint.indexOf("Ollama") < hint.indexOf("GEMINI_API_KEY") && hint.indexOf("GEMINI_API_KEY") < hint.indexOf("ANTHROPIC_API_KEY"));
});

test("OCR + IA externa: se activa con PANTALLA_BACKEND=ocr y las variables PANTALLA_LLM_*", async () => {
  const info = await createLocalBackend(config({ PANTALLA_BACKEND: "ocr", PANTALLA_LLM_URL: "http://localhost:1234/v1", PANTALLA_LLM_MODEL: "mi-modelo" })).info();
  assert.deepEqual([info.name, info.cost, info.local, info.model], ["ocr + IA", "hybrid", false, "tesseract (eng) + mi-modelo"]);
});

test("de punta a punta con Tesseract real: una captura de verdad pasa por el selector y devuelve el contexto", async () => {
  const backend = createLocalBackend(config({ PANTALLA_BACKEND: "ocr", PANTALLA_OCR_KEEP_ALIVE_S: "1" }));
  const image = readFileSync(new URL("./fixtures/casino.jpg", import.meta.url)).toString("base64");
  const out = await backend.analyze({ ...REQ, imageBase64: image, history: [] });
  assert.equal(out.result.title, "Casino: Sweet Bonanza (Pragmatic Play)");
  assert.match(out.result.text, /BALANCE €148\.30/);
  assert.equal(out.model, "tesseract (eng)");
});

test("un motor fijado manualmente no cae a otro aunque no esté listo", async () => {
  const backend = createLocalBackend(config({ PANTALLA_BACKEND: "gemini", OLLAMA_HOST: await deadUrl(), ANTHROPIC_API_KEY: "k" }));
  const info = await backend.info();
  assert.deepEqual([info.name, info.ready], ["gemini", false]);
});

test("el tamaño de imagen por defecto depende del motor y se puede forzar", async () => {
  const mock = await startMock(() => ({ json: { models: [{ name: "qwen3-vl:2b" }] } }));
  try {
    assert.equal((await createLocalBackend(config({ PANTALLA_BACKEND: "ollama", OLLAMA_HOST: mock.url })).info()).maxSide, 768);
    assert.equal((await createLocalBackend(config({ PANTALLA_BACKEND: "gemini", GEMINI_API_KEY: "k" })).info()).maxSide, 1024);
    assert.equal((await createLocalBackend(config({ PANTALLA_BACKEND: "claude", ANTHROPIC_API_KEY: "k" })).info()).maxSide, 1568);
    assert.equal((await createLocalBackend(config({ PANTALLA_BACKEND: "ollama", OLLAMA_HOST: mock.url, PANTALLA_MAX_SIDE: "640" })).info()).maxSide, 640);
  } finally {
    await mock.close();
  }
});

test("createBackend usa el analizador remoto cuando hay PANTALLA_ANALYZER_URL", async () => {
  const mock = await startMock(() => ({ json: { ok: true, ready: true, name: "gemini", model: "m", cost: "free-tier", maxSide: 900 } }));
  try {
    const info = await createBackend(config({ PANTALLA_ANALYZER_URL: `${mock.url}/ruta/ignorada` })).info();
    assert.deepEqual([info.ready, info.name, info.maxSide], [true, "gemini (remoto)", 900]);
    assert.equal(mock.requests[0].path, "/health");
  } finally {
    await mock.close();
  }
});
