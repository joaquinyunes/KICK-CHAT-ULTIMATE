import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { PantallaError, createClient, parseEventStream } from "../src/client.js";
import { startMock } from "./helpers.js";

const servers = [];
after(() => servers.forEach((s) => s.closeAllConnections?.() ?? s.close()));

async function serve(handler) {
  const requests = [];
  const server = http.createServer((req, res) => (requests.push({ url: req.url, headers: req.headers }), handler(req, res)));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return { url: `http://127.0.0.1:${server.address().port}`, requests, server };
}

const json = (res, body, status = 200) => (res.writeHead(status, { "content-type": "application/json" }), res.end(JSON.stringify(body)));
const CTX = { category: "casino", title: "Jugando Sweet Bonanza", verified: true, at: "2026-01-01T12:00:00Z" };

async function collect(iterable, count) {
  const out = [];
  for await (const item of iterable) {
    out.push(item);
    if (out.length === count) break;
  }
  return out;
}

test("parseEventStream: junta trozos partidos, ignora comentarios y entiende CRLF", async () => {
  async function* chunks() {
    yield Buffer.from(": conectado\n\nevent: context\nda");
    yield Buffer.from('ta: {"a":1}\r\n\r\n: ping\n\nevent: activity\ndata: {"b"');
    yield Buffer.from(":2}\n\n");
  }
  const items = [];
  for await (const item of parseEventStream(chunks())) items.push(item);
  assert.deepEqual(items, [
    { event: "context", data: { a: 1 } },
    { event: "activity", data: { b: 2 } },
  ]);
});

test("parseEventStream: un JSON roto es un error claro, no una excepción rara", async () => {
  async function* chunks() {
    yield Buffer.from("event: context\ndata: {roto\n\n");
  }
  await assert.rejects(collect(parseEventStream(chunks()), 1), { code: "bad_stream" });
});

test("get / context / text / prompt / activity piden lo correcto y mandan el token como Bearer (nunca en la URL)", async () => {
  const api = await serve((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api/context" && url.searchParams.get("format") === "json") return json(res, { latest: CTX, verified: true, age_seconds: 3, candidate: null });
    if (url.pathname === "/api/context") return (res.writeHead(200, { "content-type": "text/plain" }), res.end(`texto ${url.searchParams.get("format")}`));
    if (url.pathname === "/api/session") return json(res, { current: { category: "casino" }, previous: [], events: [] });
    json(res, { error: { code: "not_found" } }, 404);
  });
  const screen = createClient({ url: `${api.url}/`, token: "tok" });
  assert.deepEqual(await screen.get(), CTX);
  assert.equal((await screen.context()).age_seconds, 3);
  assert.equal(await screen.text(), "texto text");
  assert.equal(await screen.prompt({ language: "en", maxAge: 30, verified: false }), "texto prompt");
  assert.equal((await screen.activity()).current.category, "casino");

  assert.ok(api.requests.every((r) => r.headers.authorization === "Bearer tok"));
  assert.ok(api.requests.every((r) => !r.url.includes("tok")), "el token no viaja en la URL");
  const prompt = new URL(api.requests[3].url, "http://x").searchParams;
  assert.deepEqual([prompt.get("lang"), prompt.get("max_age"), prompt.get("verified")], ["en", "30", "all"]);
  const defaults = new URL(api.requests[0].url, "http://x").searchParams;
  assert.equal(defaults.get("verified"), null, "sin pedirlo, manda la configuración del servidor (por defecto, solo verificado)");
});

test("get devuelve null (no inventa) si no hay nada verificado", async () => {
  const api = await serve((req, res) => json(res, { latest: null, verified: false, age_seconds: null, candidate: { title: "Jugando algo" } }));
  const screen = createClient({ url: api.url });
  assert.equal(await screen.get(), null);
  assert.equal((await screen.context()).candidate.title, "Jugando algo");
});

test("errores con código: servidor apagado, token faltante y respuesta de error", async () => {
  const dead = await serve((req, res) => res.end());
  const deadUrl = dead.url;
  dead.server.close();
  await assert.rejects(createClient({ url: deadUrl }).get(), (err) => err instanceof PantallaError && err.code === "unreachable" && /npx pantalla-contexto/.test(err.message));

  const locked = await serve((req, res) => json(res, { error: { code: "unauthorized" } }, 401));
  await assert.rejects(createClient({ url: locked.url }).get(), { code: "unauthorized", status: 401 });

  const broken = await serve((req, res) => json(res, { error: { code: "bad_format", message: "format debe ser json" } }, 400));
  await assert.rejects(createClient({ url: broken.url }).get(), (err) => err.code === "http" && err.status === 400 && /format debe ser json/.test(err.message));
});

test("waitFor: espera a que aparezca un contexto verificado de esa categoría; si no llega, error de timeout", async () => {
  let calls = 0;
  const api = await serve((req, res) => {
    calls += 1;
    json(res, { latest: calls < 3 ? null : calls < 5 ? { ...CTX, category: "coding" } : CTX, verified: true, age_seconds: 0, candidate: null });
  });
  const screen = createClient({ url: api.url });
  const found = await screen.waitFor("casino", { intervalMs: 10, timeoutMs: 2000 });
  assert.equal(found.category, "casino");
  assert.equal(calls, 5, "ignoró el contexto de otra categoría");
  assert.equal((await screen.waitFor((c) => c.title.includes("Sweet"), { intervalMs: 10 })).title, CTX.title);

  const never = await serve((req, res) => json(res, { latest: null, verified: false, age_seconds: null, candidate: null }));
  await assert.rejects(createClient({ url: never.url }).waitFor("casino", { intervalMs: 10, timeoutMs: 80 }), { code: "timeout" });
});

test("stream: entrega context y activity; si se corta la conexión, reconecta sola", async () => {
  let connections = 0;
  const api = await serve((req, res) => {
    connections += 1;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(": conectado\n\n");
    if (connections === 1) {
      res.write(`event: context\ndata: ${JSON.stringify(CTX)}\n\n`);
      return setTimeout(() => res.destroy(), 20); // se cae el servidor
    }
    res.write(`event: activity\ndata: ${JSON.stringify({ type: "goal" })}\n\n`);
  });
  const abort = new AbortController();
  const items = await collect(createClient({ url: api.url }).stream({ signal: abort.signal, retryMs: 10 }), 2);
  abort.abort();
  assert.deepEqual(items.map((i) => i.event), ["context", "activity"]);
  assert.ok(connections >= 2);
});

test("stream: un 401 no se reintenta; sin reconnect, el corte termina el flujo", async () => {
  const locked = await serve((req, res) => json(res, {}, 401));
  await assert.rejects(collect(createClient({ url: locked.url }).stream({ retryMs: 5 }), 1), { code: "unauthorized" });
  assert.equal(locked.requests.length, 1);

  const once = await serve((req, res) => (res.writeHead(200, { "content-type": "text/event-stream" }), res.end(`event: context\ndata: ${JSON.stringify(CTX)}\n\n`)));
  const items = [];
  for await (const item of createClient({ url: once.url }).stream({ reconnect: false })) items.push(item);
  assert.equal(items.length, 1);
  assert.equal(once.requests.length, 1);
});

test("subscribe: llama a los manejadores y devuelve cómo parar", async () => {
  const api = await serve((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`event: context\ndata: ${JSON.stringify(CTX)}\n\n`);
    res.write(`event: activity\ndata: ${JSON.stringify({ type: "win" })}\n\n`);
  });
  const got = [];
  const stop = createClient({ url: api.url }).subscribe({ context: (c) => got.push(["context", c.title]), activity: (e) => got.push(["activity", e.type]) }, { reconnect: false });
  const end = Date.now() + 2000;
  while (got.length < 2 && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  stop();
  assert.deepEqual(got, [["context", CTX.title], ["activity", "win"]]);
});

test("analyze: manda tu captura como data URL con el formato detectado", async () => {
  const mock = await startMock(() => ({ json: { refused: false, context: { title: "x" }, tracking: null } }));
  try {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from("resto")]);
    await createClient({ url: mock.url }).analyze(png, { mode: "coding", language: "en", note: "pista" });
    const sent = mock.requests[0];
    assert.equal(sent.path, "/api/analyze");
    assert.match(sent.body.image, /^data:image\/png;base64,/);
    assert.deepEqual([sent.body.mode, sent.body.language, sent.body.note, sent.body.publish], ["coding", "en", "pista", true]);
  } finally {
    await mock.close();
  }
});
