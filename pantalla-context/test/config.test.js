import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig, normalizeOllamaHost } from "../src/config.js";

test("valores por defecto: auto, Ollama local, Gemini Flash-Lite y Claude con esfuerzo bajo", () => {
  const c = loadConfig({});
  assert.equal(c.port, 3000);
  assert.equal(c.loopbackOnly, true);
  assert.equal(c.backend, "auto");
  assert.equal(c.analyzerUrl, null);
  assert.equal(c.maxSide, null);
  assert.deepEqual(c.ollama, { host: "http://127.0.0.1:11434", model: "qwen3-vl:2b", keepAlive: "60s", threads: null, think: null, timeoutMs: 180_000 });
  assert.equal(c.gemini.model, "gemini-flash-lite-latest");
  assert.deepEqual([c.claude.model, c.claude.effort, c.claude.fallbacks, c.claude.configured], ["claude-opus-5-5", "low", true, false]);
  assert.deepEqual([c.analyzer.port, c.analyzer.host, c.analyzer.token], [4000, "127.0.0.1", null]);
  assert.deepEqual(c.ocr, { langs: ["eng"], langPath: null, keepAliveMs: 60_000 });
  assert.deepEqual([c.llm, c.webhook, c.knowledgeFile], [null, null, null]);
});

test("OCR: idiomas en varios formatos, tiempo de liberación y carpeta propia", () => {
  assert.deepEqual(loadConfig({ PANTALLA_OCR_LANGS: "eng+spa" }).ocr.langs, ["eng", "spa"]);
  assert.deepEqual(loadConfig({ PANTALLA_OCR_LANGS: "eng, spa ,eng" }).ocr.langs, ["eng", "spa"], "sin repetidos");
  const c = loadConfig({ PANTALLA_OCR_KEEP_ALIVE_S: "5", PANTALLA_OCR_LANG_PATH: "/datos/tessdata", PANTALLA_KNOWLEDGE_FILE: "/datos/mio.json" });
  assert.deepEqual([c.ocr.keepAliveMs, c.ocr.langPath, c.knowledgeFile], [5000, "/datos/tessdata", "/datos/mio.json"]);
});

test("IA externa: URL y modelo juntos, clave opcional, modo JSON y tiempo máximo", () => {
  const c = loadConfig({ PANTALLA_LLM_URL: "https://api.groq.com/openai/v1/", PANTALLA_LLM_MODEL: "un-modelo" });
  assert.deepEqual(c.llm, { baseUrl: "https://api.groq.com/openai/v1", model: "un-modelo", apiKey: null, jsonMode: true, timeoutMs: 60_000 });
  const full = loadConfig({ PANTALLA_LLM_URL: "http://localhost:1234/v1", PANTALLA_LLM_MODEL: "m", PANTALLA_LLM_KEY: "k", PANTALLA_LLM_JSON_MODE: "0", PANTALLA_LLM_TIMEOUT_S: "20" });
  assert.deepEqual(full.llm, { baseUrl: "http://localhost:1234/v1", model: "m", apiKey: "k", jsonMode: false, timeoutMs: 20_000 });
});

test("webhook: URL y secreto opcional", () => {
  assert.deepEqual(loadConfig({ PANTALLA_WEBHOOK_URL: "https://hooks.example/abc", PANTALLA_WEBHOOK_SECRET: "s" }).webhook, { url: "https://hooks.example/abc", secret: "s" });
  assert.equal(loadConfig({ PANTALLA_WEBHOOK_URL: "https://hooks.example/abc" }).webhook.secret, null);
});

test("verificación y exportación: por defecto solo lo verificado, certeza ≥ 0,5 y 2 lecturas seguidas", () => {
  const c = loadConfig({});
  assert.deepEqual(c.tracking, { exportMode: "verified", minCertainty: 0.5, stableFrames: 2, switchFrames: 2, maxGapMs: 300_000 });
  assert.equal(c.apiToken, null);
  const strict = loadConfig({ PANTALLA_EXPORT: "all", PANTALLA_MIN_CERTAINTY: "0.8", PANTALLA_STABLE_FRAMES: "3", PANTALLA_SWITCH_FRAMES: "1", PANTALLA_ACTIVITY_GAP_S: "60", PANTALLA_API_TOKEN: "t" });
  assert.deepEqual(strict.tracking, { exportMode: "all", minCertainty: 0.8, stableFrames: 3, switchFrames: 1, maxGapMs: 60_000 });
  assert.equal(strict.apiToken, "t");
});

test("lee las claves estándar de cada proveedor", () => {
  assert.equal(loadConfig({ ANTHROPIC_API_KEY: "a" }).claude.configured, true);
  assert.equal(loadConfig({ ANTHROPIC_PROFILE: "p" }).claude.configured, true);
  assert.equal(loadConfig({ GEMINI_API_KEY: "g" }).gemini.apiKey, "g");
  assert.equal(loadConfig({ GOOGLE_API_KEY: "g2" }).gemini.apiKey, "g2");
});

test("normalizeOllamaHost acepta los formatos habituales de OLLAMA_HOST", () => {
  assert.equal(normalizeOllamaHost(undefined), "http://127.0.0.1:11434");
  assert.equal(normalizeOllamaHost(""), "http://127.0.0.1:11434");
  assert.equal(normalizeOllamaHost("0.0.0.0"), "http://127.0.0.1:11434");
  assert.equal(normalizeOllamaHost("0.0.0.0:11500"), "http://127.0.0.1:11500");
  assert.equal(normalizeOllamaHost("192.168.1.5:11434"), "http://192.168.1.5:11434");
  assert.equal(normalizeOllamaHost("gpu-box"), "http://gpu-box:11434");
  assert.equal(normalizeOllamaHost("http://gpu-box"), "http://gpu-box");
  assert.equal(normalizeOllamaHost("https://ollama.example:8443/"), "https://ollama.example:8443");
});

test("opciones de Ollama: hilos, keep_alive, think y tiempo máximo", () => {
  const c = loadConfig({ PANTALLA_OLLAMA_THREADS: "4", PANTALLA_OLLAMA_KEEP_ALIVE: "5m", PANTALLA_OLLAMA_THINK: "0", PANTALLA_OLLAMA_TIMEOUT_S: "30", PANTALLA_OLLAMA_MODEL: "gemma3:4b" });
  assert.deepEqual(c.ollama, { host: "http://127.0.0.1:11434", model: "gemma3:4b", keepAlive: "5m", threads: 4, think: false, timeoutMs: 30_000 });
  assert.equal(loadConfig({ PANTALLA_OLLAMA_THINK: "1" }).ollama.think, null, "solo '0' desactiva el razonamiento");
});

test("la URL del analizador remoto se reduce a su origen", () => {
  assert.equal(loadConfig({ PANTALLA_ANALYZER_URL: "http://192.168.1.50:4000/analyze/" }).analyzerUrl, "http://192.168.1.50:4000");
});

test("el analizador solo se considera local si escucha en loopback", () => {
  assert.equal(loadConfig({ PANTALLA_ANALYZER_HOST: "0.0.0.0" }).analyzer.loopbackOnly, false);
  assert.equal(loadConfig({ PANTALLA_ANALYZER_HOST: "localhost" }).analyzer.loopbackOnly, true);
  assert.equal(loadConfig({ HOST: "0.0.0.0" }).loopbackOnly, false);
});

test("rechaza valores inválidos con un mensaje que nombra la variable", () => {
  const bad = [
    [{ PANTALLA_BACKEND: "gpt" }, /PANTALLA_BACKEND/],
    [{ PANTALLA_CLAUDE_EFFORT: "ultra" }, /PANTALLA_CLAUDE_EFFORT/],
    [{ PORT: "abc" }, /PORT/],
    [{ PORT: "70000" }, /PORT/],
    [{ PANTALLA_OLLAMA_THREADS: "0" }, /PANTALLA_OLLAMA_THREADS/],
    [{ PANTALLA_MAX_SIDE: "100" }, /PANTALLA_MAX_SIDE/],
    [{ PANTALLA_ANALYZER_URL: "no es url" }, /PANTALLA_ANALYZER_URL/],
    [{ PANTALLA_ANALYZER_URL: "ftp://x" }, /PANTALLA_ANALYZER_URL/],
    [{ PANTALLA_LLM_URL: "https://x" }, /PANTALLA_LLM_MODEL/],
    [{ PANTALLA_LLM_MODEL: "m" }, /PANTALLA_LLM_URL/],
    [{ PANTALLA_LLM_URL: "no es url", PANTALLA_LLM_MODEL: "m" }, /PANTALLA_LLM_URL no es una URL/],
    [{ PANTALLA_WEBHOOK_URL: "javascript:alert(1)" }, /PANTALLA_WEBHOOK_URL/],
    [{ PANTALLA_OCR_LANGS: "../etc" }, /PANTALLA_OCR_LANGS/],
    [{ PANTALLA_OCR_LANGS: "  " }, /PANTALLA_OCR_LANGS/],
    [{ PANTALLA_OCR_KEEP_ALIVE_S: "0" }, /PANTALLA_OCR_KEEP_ALIVE_S/],
    [{ PANTALLA_EXPORT: "casi" }, /PANTALLA_EXPORT/],
    [{ PANTALLA_MIN_CERTAINTY: "2" }, /PANTALLA_MIN_CERTAINTY/],
    [{ PANTALLA_MIN_CERTAINTY: "mucha" }, /PANTALLA_MIN_CERTAINTY/],
    [{ PANTALLA_STABLE_FRAMES: "0" }, /PANTALLA_STABLE_FRAMES/],
    [{ PANTALLA_STABLE_FRAMES: "11" }, /PANTALLA_STABLE_FRAMES/],
    [{ PANTALLA_ACTIVITY_GAP_S: "5" }, /PANTALLA_ACTIVITY_GAP_S/],
  ];
  for (const [env, pattern] of bad) assert.throws(() => loadConfig(env), pattern, JSON.stringify(env));
});
