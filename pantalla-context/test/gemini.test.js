import assert from "node:assert/strict";
import { test } from "node:test";
import { createGeminiBackend, toGeminiSchema } from "../src/backends/gemini.js";
import { PROFILES } from "../src/prompt.js";
import { GOOD_RESULT, REQ, startMock } from "./helpers.js";

const candidate = (over = {}) => ({
  json: {
    candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(GOOD_RESULT) }] }, ...over }],
    usageMetadata: { promptTokenCount: 420, candidatesTokenCount: 55 },
    modelVersion: "gemini-flash-lite-2.5",
  },
});

async function withGemini(respond, fn) {
  const mock = await startMock(respond);
  try {
    await fn(createGeminiBackend({ apiKey: "clave-secreta", model: "gemini-flash-lite-latest", baseUrl: mock.url }), mock);
  } finally {
    await mock.close();
  }
}

test("toGeminiSchema: tipos en mayúsculas, sin additionalProperties, conserva enum y required", () => {
  const out = toGeminiSchema(PROFILES.full.schema);
  assert.equal(out.type, "OBJECT");
  assert.equal(out.properties.entities.type, "ARRAY");
  assert.equal(out.properties.entities.items.properties.label.type, "STRING");
  assert.deepEqual(out.properties.confidence.enum, ["low", "medium", "high"]);
  assert.deepEqual(out.required, PROFILES.full.schema.required);
  assert.doesNotMatch(JSON.stringify(out), /additionalProperties/);
  assert.equal(PROFILES.full.schema.type, "object", "no debe mutar el esquema original");
});

test("manda la imagen inline, el esquema y la clave en cabecera (no en la URL)", async () => {
  await withGemini(() => candidate(), async (backend, mock) => {
    await backend.analyze(REQ);
    const { method, path, headers, body } = mock.requests[0];
    assert.equal(method, "POST");
    assert.equal(path, "/v1beta/models/gemini-flash-lite-latest:generateContent");
    assert.equal(headers["x-goog-api-key"], "clave-secreta");
    assert.doesNotMatch(path, /clave-secreta/);
    assert.equal(body.systemInstruction.parts[0].text, PROFILES.full.system);
    const [image, text] = body.contents[0].parts;
    assert.deepEqual(image, { inline_data: { mime_type: "image/jpeg", data: "QUJDRA==" } });
    assert.match(text.text, /Casino/);
    assert.match(text.text, /1\. Antes - Menú/, "el perfil completo sí manda el historial");
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.equal(body.generationConfig.responseSchema.type, "OBJECT");
  });
});

test("devuelve el resultado normalizado y el uso de tokens, ignorando partes de razonamiento", async () => {
  const parts = [{ thought: true, text: "pensando..." }, { text: JSON.stringify(GOOD_RESULT) }];
  await withGemini(() => candidate({ content: { parts } }), async (backend) => {
    const out = await backend.analyze(REQ);
    assert.equal(out.refused, false);
    assert.equal(out.result.title, "Jugando Sweet Bonanza");
    assert.equal(out.model, "gemini-flash-lite-2.5");
    assert.deepEqual(out.usage, { input_tokens: 420, output_tokens: 55 });
  });
});

test("bloqueos de seguridad se devuelven como refused; MAX_TOKENS como error", async () => {
  await withGemini(() => ({ json: { promptFeedback: { blockReason: "SAFETY" } } }), async (backend) => {
    assert.deepEqual(await backend.analyze(REQ), { refused: true, reason: "SAFETY", model: "gemini-flash-lite-latest" });
  });
  await withGemini(() => candidate({ finishReason: "PROHIBITED_CONTENT" }), async (backend) => {
    assert.equal((await backend.analyze(REQ)).refused, true);
  });
  await withGemini(() => candidate({ finishReason: "MAX_TOKENS" }), async (backend) => {
    await assert.rejects(backend.analyze(REQ), (e) => e.status === 502 && e.code === "truncated");
  });
});

test("traduce los errores HTTP de Gemini", async () => {
  const cases = [
    [429, "rate_limited", 429],
    [403, "upstream_auth", 502],
    [404, "model_missing", 502],
    [400, "upstream_bad_request", 502],
    [500, "upstream_error", 502],
  ];
  for (const [httpStatus, code, status] of cases) {
    await withGemini(() => ({ status: httpStatus, json: { error: { message: "detalle de Google" } } }), async (backend) => {
      await assert.rejects(backend.analyze(REQ), (e) => e.status === status && e.code === code, code);
    });
  }
  await withGemini(() => ({ status: 400, json: { error: { message: "API key not valid" } } }), async (backend) => {
    await assert.rejects(backend.analyze(REQ), (e) => /API key not valid/.test(e.message));
  });
});

test("info(): listo solo con clave y marcado como nivel gratuito", async () => {
  const ready = await createGeminiBackend({ apiKey: "k", model: "m" }).info();
  assert.deepEqual([ready.ready, ready.cost, ready.local, ready.maxSide], [true, "free-tier", false, 1024]);
  const missing = await createGeminiBackend({ apiKey: null, model: "m" }).info();
  assert.equal(missing.ready, false);
  assert.match(missing.hint, /GEMINI_API_KEY/);
});
