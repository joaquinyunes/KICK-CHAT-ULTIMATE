import assert from "node:assert/strict";
import { test } from "node:test";
import { createOllamaBackend } from "../src/backends/ollama.js";
import { LITE_SCHEMA, LITE_SYSTEM_PROMPT } from "../src/prompt.js";
import { HttpError } from "../src/validate.js";
import { deadUrl, GOOD_RESULT, REQ, startMock } from "./helpers.js";

const chatReply = (content, extra = {}) => ({ json: { message: { role: "assistant", content }, done: true, done_reason: "stop", prompt_eval_count: 700, eval_count: 90, ...extra } });

async function withOllama(respond, fn, options = {}) {
  const mock = await startMock(respond);
  try {
    await fn(createOllamaBackend({ host: mock.url, model: "qwen3-vl:2b", ...options }), mock);
  } finally {
    await mock.close();
  }
}

test("manda imagen, esquema ligero, keep_alive y límites a /api/chat", async () => {
  await withOllama(() => chatReply(JSON.stringify(GOOD_RESULT)), async (backend, mock) => {
    const out = await backend.analyze(REQ);
    const { method, path, body } = mock.requests[0];
    assert.equal(`${method} ${path}`, "POST /api/chat");
    assert.equal(body.model, "qwen3-vl:2b");
    assert.equal(body.stream, false);
    assert.deepEqual(body.format, LITE_SCHEMA);
    assert.equal(body.keep_alive, "60s");
    assert.deepEqual(body.options, { temperature: 0, num_ctx: 4096, num_predict: 600 });
    assert.ok(!("think" in body));

    const [system, user] = body.messages;
    assert.deepEqual(system, { role: "system", content: LITE_SYSTEM_PROMPT });
    assert.deepEqual(user.images, ["QUJDRA=="], "la imagen va en base64 sin prefijo data:");
    assert.match(user.content, /Casino/);
    assert.match(user.content, /casino online/);
    assert.doesNotMatch(user.content, /Previous analyses/, "el perfil ligero no gasta tokens en historial");

    assert.equal(out.refused, false);
    assert.equal(out.result.title, "Jugando Sweet Bonanza");
    assert.equal(out.result.activity, "", "los campos que el perfil ligero no pide quedan vacíos");
    assert.deepEqual(out.usage, { input_tokens: 700, output_tokens: 90 });
  });
});

test("num_thread solo se envía si se configura, y think:false solo si se pide", async () => {
  await withOllama(() => chatReply(JSON.stringify(GOOD_RESULT)), async (backend, mock) => {
    await backend.analyze(REQ);
    assert.equal(mock.requests[0].body.options.num_thread, 2);
    assert.equal(mock.requests[0].body.think, false);
  }, { threads: 2, think: false, keepAlive: "10s" });
});

test("tolera JSON envuelto en ```json``` o con texto alrededor", async () => {
  const wrapped = `Claro:\n\`\`\`json\n${JSON.stringify(GOOD_RESULT)}\n\`\`\``;
  await withOllama(() => chatReply(wrapped), async (backend) => {
    assert.equal((await backend.analyze(REQ)).result.title, "Jugando Sweet Bonanza");
  });
});

test("done_reason length y salida no JSON dan 502 con código propio", async () => {
  await withOllama(() => chatReply("{", { done_reason: "length" }), async (backend) => {
    await assert.rejects(backend.analyze(REQ), (e) => e instanceof HttpError && e.status === 502 && e.code === "truncated");
  });
  await withOllama(() => chatReply("no sé qué decir"), async (backend) => {
    await assert.rejects(backend.analyze(REQ), (e) => e.code === "bad_model_output");
  });
});

test("modelo no instalado (404) explica cómo descargarlo", async () => {
  await withOllama(() => ({ status: 404, json: { error: "model 'qwen3-vl:2b' not found" } }), async (backend) => {
    await assert.rejects(backend.analyze(REQ), (e) => e.code === "model_missing" && /ollama pull qwen3-vl:2b/.test(e.message));
  });
});

test("otros errores de Ollama conservan su mensaje", async () => {
  await withOllama(() => ({ status: 500, json: { error: "out of memory" } }), async (backend) => {
    await assert.rejects(backend.analyze(REQ), (e) => e.code === "upstream_error" && /out of memory/.test(e.message));
  });
});

test("sin Ollama arrancado devuelve upstream_unreachable", async () => {
  const backend = createOllamaBackend({ host: await deadUrl(), model: "m" });
  await assert.rejects(backend.analyze(REQ), (e) => e.status === 502 && e.code === "upstream_unreachable");
});

test("si Ollama tarda más que el límite devuelve 504", async () => {
  await withOllama(() => ({ ...chatReply(JSON.stringify(GOOD_RESULT)), delayMs: 400 }), async (backend) => {
    await assert.rejects(backend.analyze(REQ), (e) => e.status === 504 && e.code === "timeout");
  }, { timeoutMs: 80 });
});

test("info(): detecta Ollama caído, modelo ausente y listo; el modelo sin etiqueta equivale a :latest", async () => {
  const down = await createOllamaBackend({ host: await deadUrl(), model: "m" }).info();
  assert.equal(down.ready, false);
  assert.match(down.hint, /ollama serve/);

  await withOllama(() => ({ json: { models: [{ name: "otro:1b" }] } }), async (backend) => {
    const info = await backend.info();
    assert.equal(info.ready, false);
    assert.match(info.hint, /ollama pull qwen3-vl:2b/);
  });

  await withOllama(() => ({ json: { models: [{ name: "qwen3-vl:2b" }] } }), async (backend) => {
    const info = await backend.info();
    assert.deepEqual([info.ready, info.cost, info.local, info.maxSide], [true, "free-local", true, 768]);
  });

  await withOllama(() => ({ json: { models: [{ name: "moondream:latest" }] } }), async (backend) => {
    assert.equal((await backend.info()).ready, true);
  }, { model: "moondream" });
});

test("info() se cachea unos segundos para no preguntar a Ollama en cada petición", async () => {
  await withOllama(() => ({ json: { models: [{ name: "qwen3-vl:2b" }] } }), async (backend, mock) => {
    await backend.info();
    await backend.info();
    await backend.info();
    assert.equal(mock.requests.filter((r) => r.path === "/api/tags").length, 1);
  });
});
