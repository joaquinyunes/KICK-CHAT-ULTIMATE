import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError, normalizeResult, parseAnalyzeRequest } from "../src/validate.js";

const IMG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

test("acepta una petición mínima y aplica valores por defecto", () => {
  const r = parseAnalyzeRequest({ image: IMG });
  assert.equal(r.mediaType, "image/jpeg");
  assert.equal(r.imageBase64, "/9j/4AAQSkZJRg==");
  assert.equal(r.mode, "auto");
  assert.equal(r.language, "es");
  assert.deepEqual(r.history, []);
  assert.equal(r.publish, true);
});

test("rechaza cuerpos que no son objetos", () => {
  for (const body of [null, "x", 5, []]) {
    assert.throws(() => parseAnalyzeRequest(body), (e) => e instanceof HttpError && e.status === 400);
  }
});

test("rechaza imágenes inválidas", () => {
  for (const image of [undefined, 5, "hola", "data:text/html;base64,AAAA", "data:image/gif;base64,AAAA", "data:image/jpeg;base64,@@@"]) {
    assert.throws(() => parseAnalyzeRequest({ image }), (e) => e.code === "bad_image", String(image));
  }
});

test("rechaza imágenes demasiado grandes con 413", () => {
  const big = `data:image/png;base64,${"A".repeat(4_500_001)}`;
  assert.throws(() => parseAnalyzeRequest({ image: big }), (e) => e.status === 413);
});

test("rechaza modo e idioma desconocidos", () => {
  assert.throws(() => parseAnalyzeRequest({ image: IMG, mode: "hack" }), (e) => e.code === "bad_mode");
  assert.throws(() => parseAnalyzeRequest({ image: IMG, mode: "__proto__" }), (e) => e.code === "bad_mode");
  assert.throws(() => parseAnalyzeRequest({ image: IMG, language: "fr" }), (e) => e.code === "bad_language");
  assert.throws(() => parseAnalyzeRequest({ image: IMG, language: "constructor" }), (e) => e.code === "bad_language");
});

test("recorta nota e historial (máx. 3) y descarta entradas vacías", () => {
  const history = [1, 2, 3, 4, 5].map((n) => ({ title: `t${n}`, summary: "s".repeat(1000) }));
  history.push({ title: "", summary: "" }, "basura", null);
  const r = parseAnalyzeRequest({ image: IMG, note: ` ${"n".repeat(500)} `, history });
  assert.equal(r.note.length, 200);
  assert.ok(r.history.length <= 3);
  assert.ok(r.history.every((h) => h.summary.length <= 300));
});

test("publish solo se desactiva con false explícito", () => {
  assert.equal(parseAnalyzeRequest({ image: IMG, publish: false }).publish, false);
  assert.equal(parseAnalyzeRequest({ image: IMG, publish: 0 }).publish, true);
});

test("normalizeResult limpia entradas inesperadas del modelo", () => {
  const r = normalizeResult({
    category: "casino",
    title: "  Sweet Bonanza  ",
    summary: "x".repeat(900),
    activity: 5,
    entities: [{ label: "Juego", value: "Sweet Bonanza" }, { label: "", value: "x" }, null, { label: "A", value: "B" }],
    chat_line: "hola",
    changes: undefined,
    confidence: "enorme",
    uncertain: ["a", "", 3],
  });
  assert.equal(r.title, "Sweet Bonanza");
  assert.equal(r.summary.length, 500);
  assert.equal(r.activity, "");
  assert.deepEqual(r.entities, [{ label: "Juego", value: "Sweet Bonanza" }, { label: "A", value: "B" }]);
  assert.equal(r.changes, "");
  assert.equal(r.confidence, "low");
  assert.deepEqual(r.uncertain, ["a"]);
});
