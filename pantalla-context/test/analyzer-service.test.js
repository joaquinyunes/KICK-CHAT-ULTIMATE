import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { createAnalyzerService } from "../src/analyzer-service.js";
import { createRemoteBackend } from "../src/backends/remote.js";
import { singleFlight } from "../src/limit.js";
import { HttpError, normalizeResult } from "../src/validate.js";
import { deadUrl, GOOD_RESULT, REQ } from "./helpers.js";

const TOKEN = "secreto-largo-de-prueba";
let ready = true;
let outcome;
let seen = [];
let server;
let url;

const engine = {
  info: async () => ({ ready, name: "ollama", model: "qwen3-vl:2b", cost: "free-local", local: true, maxSide: 768, hint: ready ? null : "falta el modelo" }),
  analyze: async (req) => {
    seen.push(req);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  },
};

before(async () => {
  server = http.createServer(createAnalyzerService({ backend: engine, token: TOKEN })).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const reset = () => {
  ready = true;
  seen = [];
  outcome = { refused: false, result: normalizeResult(GOOD_RESULT), model: "qwen3-vl:2b", usage: { input_tokens: 5, output_tokens: 6 } };
};

const rawPost = (headers = {}, body = { image: "data:image/jpeg;base64,QUJD" }) =>
  fetch(`${url}/analyze`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("el visor remoto y el analizador se entienden de punta a punta", async () => {
  reset();
  const remote = createRemoteBackend({ url, token: TOKEN });
  const out = await remote.analyze(REQ);

  assert.equal(out.refused, false);
  assert.equal(out.result.title, "Jugando Sweet Bonanza");
  assert.equal(out.model, "qwen3-vl:2b");
  assert.deepEqual(out.usage, { input_tokens: 5, output_tokens: 6 });
  // El analizador recibe la misma petición ya validada, con la imagen intacta.
  assert.equal(seen[0].imageBase64, REQ.imageBase64);
  assert.equal(seen[0].mediaType, "image/jpeg");
  assert.equal(seen[0].mode, "casino");
  assert.equal(seen[0].note, "casino online");
  assert.deepEqual(seen[0].history, REQ.history);
});

test("una negativa del modelo atraviesa el analizador remoto", async () => {
  reset();
  outcome = { refused: true, reason: "SAFETY", model: "m" };
  assert.deepEqual(await createRemoteBackend({ url, token: TOKEN }).analyze(REQ), { refused: true, reason: "SAFETY", model: "m" });
});

test("sin token o con token incorrecto: 401, y el analizador no se llama", async () => {
  reset();
  for (const headers of [{}, { authorization: "Bearer otro" }, { authorization: `Bearer ${TOKEN}x` }, { authorization: TOKEN }]) {
    const res = await rawPost(headers);
    assert.equal(res.status, 401, JSON.stringify(headers));
  }
  assert.equal(seen.length, 0);
  assert.equal((await rawPost({ authorization: `Bearer ${TOKEN}` })).status, 200);
});

test("el visor con token equivocado recibe un error de configuración claro", async () => {
  reset();
  await assert.rejects(createRemoteBackend({ url, token: "mal" }).analyze(REQ), (e) => e instanceof HttpError && e.status === 502 && e.code === "upstream_auth" && /PANTALLA_ANALYZER_TOKEN/.test(e.message));
});

test("/health es público, no filtra el token y refleja el estado del motor", async () => {
  reset();
  const body = await (await fetch(`${url}/health`)).json();
  assert.deepEqual([body.ok, body.ready, body.name, body.model, body.cost], [true, true, "ollama", "qwen3-vl:2b", "free-local"]);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(TOKEN));
});

test("si el motor no está listo responde 503 con la pista", async () => {
  reset();
  ready = false;
  const res = await rawPost({ authorization: `Bearer ${TOKEN}` });
  assert.equal(res.status, 503);
  assert.match((await res.json()).message, /falta el modelo/);
});

test("los errores del motor (p. ej. 429 busy) llegan al visor con su código y estado", async () => {
  reset();
  outcome = new HttpError(429, "busy", "El analizador está ocupado");
  await assert.rejects(createRemoteBackend({ url, token: TOKEN }).analyze(REQ), (e) => e.status === 429 && e.code === "busy");
});

test("valida la entrada también en el analizador", async () => {
  reset();
  const res = await rawPost({ authorization: `Bearer ${TOKEN}` }, { image: "no-es-una-imagen" });
  assert.equal(res.status, 400);
  const wrongType = await fetch(`${url}/analyze`, { method: "POST", headers: { "content-type": "text/plain", authorization: `Bearer ${TOKEN}` }, body: "{}" });
  assert.equal(wrongType.status, 415);
});

test("rechaza un Host que no es localhost cuando solo escucha en local", async () => {
  const s = http.createServer(createAnalyzerService({ backend: engine, loopbackOnly: true })).listen(0, "127.0.0.1");
  await new Promise((r) => s.once("listening", r));
  try {
    const status = await new Promise((resolve, reject) => {
      http.get({ host: "127.0.0.1", port: s.address().port, path: "/health", headers: { host: "evil.example" } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      }).on("error", reject);
    });
    assert.equal(status, 403);
  } finally {
    s.close();
  }
});

test("remote.info(): refleja el motor remoto o avisa de que no se alcanza", async () => {
  reset();
  const info = await createRemoteBackend({ url, token: TOKEN }).info();
  assert.deepEqual([info.ready, info.name, info.model, info.maxSide, info.local], [true, "ollama (remoto)", "qwen3-vl:2b", 768, false]);

  const dead = await deadUrl();
  const down = await createRemoteBackend({ url: dead }).info();
  assert.equal(down.ready, false);
  assert.match(down.hint, /npm run analyzer/);
  await assert.rejects(createRemoteBackend({ url: dead }).analyze(REQ), (e) => e.status === 502 && e.code === "upstream_unreachable");
});

test("singleFlight: una captura a la vez, las demás reciben 429 busy", async () => {
  let release;
  const slow = singleFlight(() => new Promise((resolve) => (release = () => resolve("listo"))));
  const first = slow({});
  await assert.rejects(slow({}), (e) => e.status === 429 && e.code === "busy");
  release();
  assert.equal(await first, "listo");
  const again = slow({});
  release();
  assert.equal(await again, "listo", "tras terminar vuelve a aceptar peticiones");

  const failing = singleFlight(async () => {
    throw new Error("boom");
  });
  await assert.rejects(failing({}), /boom/);
  await assert.rejects(failing({}), /boom/, "un fallo no deja el limitador bloqueado");
});
