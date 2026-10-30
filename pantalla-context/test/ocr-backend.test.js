import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createOcrBackend } from "../src/backends/ocr.js";
import { buildIndex } from "../src/ocr/knowledge.js";
import { mergeKnowledge } from "../src/ocr/knowledge.js";
import { HttpError } from "../src/validate.js";
import { REQ } from "./helpers.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.ocr.json`, import.meta.url), "utf8"));
const index = buildIndex(mergeKnowledge());

function stubEngine(ocr = fixture("casino"), check = { ok: true }) {
  const seen = [];
  return { seen, langs: ["eng"], available: async () => check, recognize: async (buffer) => (seen.push(buffer), ocr), close: async () => {} };
}

function stubEnricher(behavior) {
  const calls = [];
  return {
    calls,
    model: "llm-x",
    refine: async (args) => {
      calls.push(args);
      return behavior(args);
    },
  };
}

test("info: listo, gratis y local, con tamaños pensados para el OCR (ampliar lo pequeño)", async () => {
  const info = await createOcrBackend({ engine: stubEngine(), index }).info();
  assert.deepEqual(info, { name: "ocr", model: "tesseract (eng)", cost: "free-local", local: true, maxSide: 1600, minSide: 1280, quality: 0.9, ready: true, hint: null });
});

test("info: si el OCR no se puede cargar, no está listo y explica por qué", async () => {
  const info = await createOcrBackend({ engine: stubEngine(fixture("casino"), { ok: false, error: "Falta el idioma" }), index }).info();
  assert.deepEqual([info.ready, info.hint], [false, "Falta el idioma"]);
});

test("sin IA externa: lee, interpreta con reglas y no gasta tokens", async () => {
  const engine = stubEngine();
  const out = await createOcrBackend({ engine, index }).analyze({ ...REQ, imageBase64: Buffer.from("IMAGEN").toString("base64") });
  assert.equal(engine.seen[0].toString(), "IMAGEN", "el OCR recibe los bytes de la imagen");
  assert.equal(out.refused, false);
  assert.equal(out.result.title, "Casino: Sweet Bonanza (Pragmatic Play)");
  assert.match(out.result.text, /BALANCE €148\.30/);
  assert.equal(out.model, "tesseract (eng)");
  assert.deepEqual(out.usage, { input_tokens: 0, output_tokens: 0 });
});

test("con IA externa: recibe el borrador y el texto, y su respuesta se fusiona con el texto leído", async () => {
  const enricher = stubEnricher(() => ({
    parsed: { category: "casino", title: "Sweet Bonanza (Pragmatic Play)", summary: "Giros gratis con x25.", activity: "", entities: [{ label: "Juego", value: "Sweet Bonanza" }], chat_line: "Sweet Bonanza x25", changes: "", confidence: "high", uncertain: ["No se ve el nombre de la mesa"] },
    model: "llm-x-2026",
    usage: { input_tokens: 420, output_tokens: 70 },
  }));
  const out = await createOcrBackend({ engine: stubEngine(), index, enricher }).analyze(REQ);
  assert.match(enricher.calls[0].draft.text, /SWEET BONANZA/);
  assert.equal(enricher.calls[0].req.mode, "casino");
  assert.equal(out.result.title, "Sweet Bonanza (Pragmatic Play)");
  assert.match(out.result.text, /BALANCE €148\.30/, "el texto leído se conserva para quien lo consuma");
  assert.match(out.result.uncertain[0], /interpretado por una IA externa \(no ve la imagen\)/);
  assert.equal(out.result.uncertain[1], "No se ve el nombre de la mesa");
  assert.equal(out.model, "tesseract (eng) + llm-x-2026");
  assert.deepEqual(out.usage, { input_tokens: 420, output_tokens: 70 });
});

test("si la IA externa falla, no se pierde el análisis local y se avisa del motivo", async () => {
  const enricher = stubEnricher(() => {
    throw new HttpError(429, "rate_limited", "Límite de la IA externa alcanzado.");
  });
  const out = await createOcrBackend({ engine: stubEngine(), index, enricher }).analyze(REQ);
  assert.equal(out.result.title, "Casino: Sweet Bonanza (Pragmatic Play)");
  assert.equal(out.model, "tesseract (eng)");
  assert.match(out.result.uncertain.at(-1), /La IA externa no respondió \(Límite de la IA externa alcanzado\.\)/);
});

test("sin texto legible no se molesta a la IA externa", async () => {
  const enricher = stubEnricher(() => assert.fail("no debe llamarse"));
  const out = await createOcrBackend({ engine: stubEngine({ lines: [], confidence: 0, text: "" }), index, enricher }).analyze(REQ);
  assert.equal(out.result.category, "other");
  assert.equal(enricher.calls.length, 0);
});

test("con IA externa cambia el nombre, el coste y deja de ser 100 % local", async () => {
  const info = await createOcrBackend({ engine: stubEngine(), index, enricher: stubEnricher(() => ({})) }).info();
  assert.deepEqual([info.name, info.cost, info.local, info.model], ["ocr + IA", "hybrid", false, "tesseract (eng) + llm-x"]);
});

test("los avisos salen en el idioma pedido", async () => {
  const enricher = stubEnricher(() => {
    throw new HttpError(502, "x", "boom");
  });
  const out = await createOcrBackend({ engine: stubEngine(), index, enricher }).analyze({ ...REQ, language: "en" });
  assert.match(out.result.uncertain.at(-1), /The external AI did not respond \(boom\)/);
});

test("la pista del usuario llega al extractor a través del motor", async () => {
  const out = await createOcrBackend({ engine: stubEngine({ lines: [{ text: "BALANCE €10.00", confidence: 90 }, { text: "BET €1.00", confidence: 90 }], confidence: 90 }), index }).analyze({ ...REQ, note: "Gates of Olympus de Pragmatic Play" });
  assert.equal(out.result.title, "Casino: Gates of Olympus (Pragmatic Play)");
  assert.ok(out.result.entities.some((e) => e.label === "Pista"));
});
