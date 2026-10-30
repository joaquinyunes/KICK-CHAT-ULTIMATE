import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { createTracker } from "../src/tracker.js";
import { normalizeResult } from "../src/validate.js";
import { GOOD_RESULT } from "./helpers.js";

const IMG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const servers = [];
after(() => servers.forEach((s) => s.close()));

// Un visor completo con un analizador falso. `outcome` fija qué «lee» en cada análisis.
async function start({ tracker, exportMode, apiToken, onContext } = {}) {
  let clock = new Date("2026-01-01T12:00:00Z");
  let reading = { title: "Jugando Sweet Bonanza", subject: "Sweet Bonanza", certainty: 0.9, category: "casino" };
  const backend = {
    info: async () => ({ ready: true, name: "ocr", model: "tesseract (eng)", cost: "free-local", local: true, maxSide: 1600 }),
    analyze: async () => ({
      refused: false,
      result: normalizeResult({ ...GOOD_RESULT, ...reading, text: "SWEET BONANZA\nBALANCE €10.00", entities: [{ label: "Saldo", value: "€10.00" }], reasons: ["Juego del catálogo: Sweet Bonanza"] }),
      model: "tesseract (eng)",
      usage: { input_tokens: 0, output_tokens: 0 },
    }),
  };
  const app = createApp({ backend, tracker: tracker ?? createTracker({ now: () => clock.getTime() }), exportMode, apiToken, onContext, now: () => clock });
  const server = http.createServer(app).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    read: (r) => (reading = { ...reading, ...r }),
    advance: (ms) => (clock = new Date(clock.getTime() + ms)),
    analyze: async (body = {}) => (await fetch(`${base}/api/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: IMG, ...body }) })).json(),
    get: (path, init) => fetch(`${base}${path}`, init),
    json: async (path) => (await fetch(`${base}${path}`)).json(),
    text: async (path) => (await fetch(`${base}${path}`)).text(),
  };
}

// Cliente mínimo de Server-Sent Events.
function listen(base, query = "") {
  return new Promise((resolve, reject) => {
    const events = [];
    let buffer = "";
    const waiters = [];
    const req = http.get(`${base}/api/events${query}`, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buffer += chunk;
        for (let i = buffer.indexOf("\n\n"); i !== -1; i = buffer.indexOf("\n\n")) {
          const block = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const name = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (name && data) {
            events.push({ name, data: JSON.parse(data) });
            waiters.splice(0).forEach((w) => w());
          }
        }
      });
      resolve({
        res,
        events,
        close: () => req.destroy(),
        named: (n) => events.filter((e) => e.name === n).map((e) => e.data),
        next: (count, n = "context") =>
          new Promise((ok, no) => {
            const check = () => (events.filter((e) => e.name === n).length >= count ? ok() : waiters.push(check));
            setTimeout(() => no(new Error(`solo llegaron ${events.filter((e) => e.name === n).length} eventos «${n}»`)), 3000).unref();
            check();
          }),
      });
    });
    req.on("error", reject);
  });
}

test("la primera lectura NO se exporta: hace falta confirmarla; el candidato se explica", async () => {
  const v = await start();
  const first = await v.analyze({ language: "es", mode: "casino" });
  assert.deepEqual([first.tracking.verified, first.tracking.state, first.tracking.confirmations, first.tracking.needed], [false, "confirming", 1, 2]);

  assert.deepEqual(await v.json("/api/context"), { latest: null, verified: false, age_seconds: null, candidate: { title: "Jugando Sweet Bonanza", category: "casino", certainty: 0.9, confirmations: 1, needed: 2 } });
  assert.match(await v.text("/api/context?format=text"), /^Todavía no hay contexto verificado\. Candidato: «Jugando Sweet Bonanza» \(certeza 90 %, 1 de 2 lecturas seguidas necesarias\)\.$/);
  assert.match(await v.text("/api/context?format=prompt"), /Candidato:/);
  assert.equal((await v.json("/api/latest")).latest, null, "el overlay tampoco muestra lo no verificado");
});

test("con la segunda lectura coincidente queda verificado y se exporta con su certeza y sus motivos", async () => {
  const v = await start();
  await v.analyze({ language: "es" });
  const second = await v.analyze({ language: "es" });
  assert.deepEqual([second.tracking.verified, second.tracking.state], [true, "verified"]);
  assert.deepEqual(second.tracking.events.map((e) => e.type), ["activity_started"]);

  const json = await v.json("/api/context");
  assert.deepEqual([json.verified, json.age_seconds, json.candidate], [true, 0, null]);
  assert.deepEqual([json.latest.verified, json.latest.confirmations, json.latest.certainty, json.latest.title], [true, 2, 0.9, "Jugando Sweet Bonanza"]);
  const text = await v.text("/api/context?format=text");
  assert.match(text, /Verificación: VERIFICADO · certeza 90 % · 2 lecturas seguidas/);
  assert.match(text, /Por qué: Juego del catálogo: Sweet Bonanza/);
  assert.match(await v.text("/api/context?format=prompt"), /^A continuación tienes el contexto[\s\S]*VERIFICADO/);
});

test("?verified=all deja ver la lectura sin verificar, marcada como tal; la configuración del servidor fija el valor por defecto", async () => {
  const v = await start();
  await v.analyze();
  const all = await v.json("/api/context?verified=all");
  assert.deepEqual([all.latest.title, all.latest.verified, all.verified], ["Jugando Sweet Bonanza", false, false]);
  assert.match(await v.text("/api/context?format=text&verified=all"), /SIN VERIFICAR · certeza 90 %/);

  const permissive = await start({ exportMode: "all" });
  await permissive.analyze();
  assert.equal((await permissive.json("/api/context")).latest.verified, false, "con exportMode=all sale todo por defecto");
  assert.equal((await permissive.json("/api/context?verified=true")).latest, null, "pero se puede pedir solo lo verificado");
});

test("un parpadeo de otra actividad no sustituye al contexto verificado; si se repite, sí", async () => {
  const v = await start();
  await v.analyze();
  await v.analyze();
  v.read({ title: "Viendo: OBS", subject: "obs", category: "video_media" });
  const blip = await v.analyze();
  assert.deepEqual([blip.tracking.state, blip.tracking.verified], ["switching", false]);
  assert.equal((await v.json("/api/context")).latest.title, "Jugando Sweet Bonanza", "sigue el último contexto verificado");
  const switched = await v.analyze();
  assert.equal(switched.tracking.verified, true);
  assert.equal((await v.json("/api/context")).latest.title, "Viendo: OBS");
});

test("lo verificado caduca: pasado el hueco de actividad ya no se da por actual; max_age lo acorta", async () => {
  const v = await start({ tracker: createTracker({ now: () => Date.now(), maxGapMs: 60_000 }) });
  await v.analyze();
  await v.analyze();
  v.advance(30_000);
  const aged = await v.json("/api/context");
  assert.equal(aged.age_seconds, 30);
  assert.equal(aged.latest.title, "Jugando Sweet Bonanza");
  assert.equal((await v.json("/api/context?max_age=10")).latest, null, "más viejo que 10 s");
  assert.notEqual((await v.json("/api/context?max_age=60")).latest, null);
  v.advance(40_000);
  assert.equal((await v.json("/api/context")).latest, null, "70 s sin lecturas: caducado");
});

test("parámetros inválidos son un 400", async () => {
  const v = await start();
  for (const [path, code] of [["/api/context?format=xml", "bad_format"], ["/api/context?verified=quizas", "bad_verified"], ["/api/context?max_age=-3", "bad_max_age"], ["/api/session?format=xml", "bad_format"]]) {
    const res = await v.get(path);
    assert.equal(res.status, 400, path);
    assert.equal((await res.json()).error, code);
  }
});

test("/api/session: la actividad actual, las anteriores y los eventos, en json y en texto", async () => {
  const v = await start();
  await v.analyze({ language: "es" });
  assert.equal((await v.json("/api/session")).current, null, "sin verificar no hay actividad");
  assert.equal((await v.json("/api/session")).candidate.title, "Jugando Sweet Bonanza");
  await v.analyze({ language: "es" });
  const session = await v.json("/api/session");
  assert.deepEqual([session.current.title, session.current.verified, session.current.readings], ["Jugando Sweet Bonanza", true, 2]);
  assert.ok(session.events.some((e) => e.type === "activity_started"));
  const text = await v.text("/api/session?format=text");
  assert.match(text, /^ACTIVIDAD\nAhora: Jugando Sweet Bonanza · desde hace \d+ s · verificado \(certeza 90 %\)/);
  assert.match(await v.text("/api/session?format=text&lang=en"), /^ACTIVITY\nNow: /);
  assert.equal((await v.json("/api/session?verified=all")).current.title, "Jugando Sweet Bonanza");
});

test("/api/events: lo verificado llega a los clientes por defecto; el cliente «all» recibe también lo no verificado; los eventos de actividad salen al verificarse", async () => {
  const v = await start();
  const strict = await listen(v.base);
  const permissive = await listen(v.base, "?verified=all");
  try {
    assert.match(strict.res.headers["content-type"], /text\/event-stream/);
    await v.analyze();
    await permissive.next(1);
    assert.equal(permissive.named("context")[0].verified, false);
    assert.equal(strict.named("context").length, 0, "el cliente estricto no recibe lo no verificado");
    await v.analyze();
    await strict.next(1);
    assert.equal(strict.named("context")[0].verified, true);
    await strict.next(1, "activity");
    assert.equal(strict.named("activity")[0].type, "activity_started");
    await permissive.next(2);
  } finally {
    strict.close();
    permissive.close();
  }
});

test("un cliente nuevo recibe el último contexto verificado nada más conectar", async () => {
  const v = await start();
  await v.analyze();
  await v.analyze();
  const late = await listen(v.base);
  try {
    await late.next(1);
    assert.equal(late.named("context")[0].title, "Jugando Sweet Bonanza");
  } finally {
    late.close();
  }
});

test("el webhook (onContext) solo recibe lo verificado, con los eventos y la sesión", async () => {
  const delivered = [];
  const v = await start({ onContext: (entry, extra) => delivered.push({ entry, ...extra }) });
  await v.analyze();
  assert.equal(delivered.length, 0, "una lectura sin verificar no sale");
  await v.analyze();
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].entry.verified, true);
  assert.deepEqual(delivered[0].events.map((e) => e.type), ["activity_started"]);
  assert.equal(delivered[0].session.current.title, "Jugando Sweet Bonanza");

  const all = [];
  const permissive = await start({ exportMode: "all", onContext: (entry) => all.push(entry) });
  await permissive.analyze();
  assert.equal(all.length, 1);
  assert.equal(all[0].verified, false);
});

test("los fallos del webhook nunca rompen el análisis", async () => {
  const v = await start({
    tracker: createTracker({ stableFrames: 1 }),
    onContext: () => {
      throw new Error("el webhook explotó");
    },
  });
  assert.equal((await v.analyze()).refused, false);
});

test("con publish:false no se sigue ni se exporta nada", async () => {
  const delivered = [];
  const v = await start({ tracker: createTracker({ stableFrames: 1 }), onContext: (e) => delivered.push(e) });
  const res = await v.analyze({ publish: false });
  assert.equal(res.tracking, null);
  assert.equal((await v.json("/api/context?verified=all")).latest, null);
  assert.equal(delivered.length, 0);
});

test("token de API: protege la exportación (cabecera o ?token=), no la interfaz ni el análisis", async () => {
  const v = await start({ apiToken: "secreto-largo", tracker: createTracker({ stableFrames: 1 }) });
  await v.analyze();
  for (const path of ["/api/context", "/api/latest", "/api/session", "/api/events"]) assert.equal((await v.get(path)).status, 401, path);
  assert.equal((await v.get("/api/context", { headers: { authorization: "Bearer otro" } })).status, 401);
  assert.equal((await v.get("/api/context", { headers: { authorization: "Bearer secreto-largo" } })).status, 200);
  assert.equal((await v.get("/api/context?token=secreto-largo")).status, 200);
  assert.equal((await v.get("/api/session?token=secreto-largo")).status, 200);
  assert.equal((await v.get("/api/context?token=")).status, 401);
  assert.equal((await v.get("/api/config")).status, 200);
  assert.equal((await v.get("/")).status, 200);
  assert.equal((await v.json("/api/config")).export.protected, true);
});

test("/api/config informa de la política de exportación", async () => {
  const v = await start({ tracker: createTracker({ minCertainty: 0.7, stableFrames: 3 }) });
  assert.deepEqual((await v.json("/api/config")).export, { mode: "verified", stableFrames: 3, minCertainty: 0.7, switchFrames: 2, maxGapMs: 300_000, activityGapSeconds: 300, protected: false });
});
