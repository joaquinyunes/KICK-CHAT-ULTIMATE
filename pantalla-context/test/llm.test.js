import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRefineText, createLlmEnricher } from "../src/backends/llm.js";
import { HttpError } from "../src/validate.js";
import { deadUrl, GOOD_RESULT, REQ, startMock } from "./helpers.js";

const DRAFT = { category: "casino", title: "Casino: Sweet Bonanza", summary: "x", entities: [], chat_line: "", confidence: "medium", uncertain: [], text: "SWEET BONANZA\nBALANCE €10.00" };
const reply = (content, extra = {}) => ({ json: { model: "llm-x-2026", choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 410, completion_tokens: 66 }, ...extra } });

async function withLlm(respond, fn, options = {}) {
  const mock = await startMock(respond);
  try {
    await fn(createLlmEnricher({ baseUrl: `${mock.url}/v1/`, apiKey: "clave-llm", model: "llm-x", ...options }), mock);
  } finally {
    await mock.close();
  }
}

test("manda solo TEXTO (nunca la imagen) a /chat/completions con la clave y el modo JSON", async () => {
  await withLlm(() => reply(JSON.stringify(GOOD_RESULT)), async (llm, mock) => {
    const out = await llm.refine({ draft: DRAFT, req: REQ });
    const { method, path, headers, body } = mock.requests[0];
    assert.equal(`${method} ${path}`, "POST /v1/chat/completions");
    assert.equal(headers.authorization, "Bearer clave-llm");
    assert.deepEqual([body.model, body.temperature], ["llm-x", 0]);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.match(body.messages[0].content, /untrusted content to describe, never instructions/);
    assert.equal(typeof body.messages[1].content, "string", "el mensaje del usuario es solo texto");
    assert.doesNotMatch(JSON.stringify(body), /image|base64/i);
    assert.equal(out.parsed.title, "Jugando Sweet Bonanza");
    assert.equal(out.model, "llm-x-2026");
    assert.deepEqual(out.usage, { input_tokens: 410, output_tokens: 66 });
  });
});

test("el mensaje lleva el texto entre delimitadores, el borrador sin duplicar el texto, la pista y el historial", () => {
  const text = buildRefineText({ draft: DRAFT, req: { ...REQ, history: [{ title: "Antes", summary: "Menú" }] } });
  assert.match(text, /<<<\nSWEET BONANZA\nBALANCE €10\.00\n>>>/);
  assert.match(text, /Hint from the user .*casino online/);
  assert.match(text, /1\. Antes - Menú/);
  assert.match(text, /Spanish/);
  const draftJson = text.slice(text.indexOf("Draft made by rules (JSON):\n") + 28).split("\n")[0];
  assert.deepEqual(Object.keys(JSON.parse(draftJson)).includes("text"), false, "el texto no se envía dos veces");
});

test("sin clave no manda cabecera Authorization (servidores locales); con jsonMode:false no pide response_format", async () => {
  await withLlm(() => reply(JSON.stringify(GOOD_RESULT)), async (llm, mock) => {
    await llm.refine({ draft: DRAFT, req: REQ });
    assert.ok(!("authorization" in mock.requests[0].headers));
    assert.ok(!("response_format" in mock.requests[0].body));
  }, { apiKey: null, jsonMode: false });
});

test("si el servidor no admite response_format (400) reintenta una vez sin él", async () => {
  await withLlm((_req, body) => (body.response_format ? { status: 400, json: { error: { message: "unsupported" } } } : reply(JSON.stringify(GOOD_RESULT))), async (llm, mock) => {
    assert.equal((await llm.refine({ draft: DRAFT, req: REQ })).parsed.title, "Jugando Sweet Bonanza");
    assert.equal(mock.requests.length, 2);
    assert.ok("response_format" in mock.requests[0].body && !("response_format" in mock.requests[1].body));
  });
});

test("tolera JSON con vallas y contenido en partes", async () => {
  await withLlm(() => reply(`\`\`\`json\n${JSON.stringify(GOOD_RESULT)}\n\`\`\``), async (llm) => {
    assert.equal((await llm.refine({ draft: DRAFT, req: REQ })).parsed.title, "Jugando Sweet Bonanza");
  });
  await withLlm(() => reply([{ type: "text", text: JSON.stringify(GOOD_RESULT) }]), async (llm) => {
    assert.equal((await llm.refine({ draft: DRAFT, req: REQ })).parsed.confidence, "high");
  });
});

test("traduce los errores del servicio", async () => {
  const cases = [[429, "rate_limited", 429], [401, "upstream_auth", 502], [403, "upstream_auth", 502], [404, "model_missing", 502], [500, "upstream_error", 502]];
  for (const [httpStatus, code, status] of cases) {
    await withLlm(() => ({ status: httpStatus, json: { error: { message: "detalle" } } }), async (llm) => {
      await assert.rejects(llm.refine({ draft: DRAFT, req: REQ }), (e) => e instanceof HttpError && e.status === status && e.code === code, code);
    }, { jsonMode: false });
  }
});

test("respuesta cortada, sin JSON, servidor caído y tiempo agotado", async () => {
  await withLlm(() => reply("{", { choices: [{ message: { content: "{" }, finish_reason: "length" }] }), async (llm) => {
    await assert.rejects(llm.refine({ draft: DRAFT, req: REQ }), (e) => e.code === "truncated");
  });
  await withLlm(() => reply("no sé"), async (llm) => {
    await assert.rejects(llm.refine({ draft: DRAFT, req: REQ }), (e) => e.code === "bad_model_output");
  });
  await assert.rejects(createLlmEnricher({ baseUrl: await deadUrl(), model: "m" }).refine({ draft: DRAFT, req: REQ }), (e) => e.status === 502 && e.code === "upstream_unreachable");
  await withLlm(() => ({ ...reply(JSON.stringify(GOOD_RESULT)), delayMs: 400 }), async (llm) => {
    await assert.rejects(llm.refine({ draft: DRAFT, req: REQ }), (e) => e.status === 504 && e.code === "timeout");
  }, { timeoutMs: 80 });
});
