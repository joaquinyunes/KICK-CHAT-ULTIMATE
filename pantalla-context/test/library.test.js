import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { test } from "node:test";
import { createClient } from "../src/client.js";
import { buildConfig, startPantallaContexto } from "../src/index.js";

const casino = readFileSync(new URL("./fixtures/casino.jpg", import.meta.url));
const ENV = {}; // sin variables del entorno real: la prueba no depende de la máquina

const waitUntil = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timeout esperando la condición");
};

test("buildConfig: traduce las opciones y valida con las mismas reglas que las variables de entorno", () => {
  const config = buildConfig({ env: ENV, port: 3456, backend: "ocr", exportMode: "all", minCertainty: 0.7, stableFrames: 3, apiToken: "secreto", webhook: { url: "http://127.0.0.1:9/hook", secret: "s" } });
  assert.equal(config.port, 3456);
  assert.equal(config.backend, "ocr");
  assert.deepEqual([config.tracking.exportMode, config.tracking.minCertainty, config.tracking.stableFrames], ["all", 0.7, 3]);
  assert.equal(config.apiToken, "secreto");
  assert.deepEqual(config.webhook, { url: "http://127.0.0.1:9/hook", secret: "s" });

  assert.equal(buildConfig({ env: ENV, port: 0 }).port, 0); // puerto libre, solo en la biblioteca
  assert.throws(() => buildConfig({ env: ENV, exportMode: "casi" }), /PANTALLA_EXPORT inválido/);
  assert.throws(() => buildConfig({ env: ENV, minCertainty: 3 }), /PANTALLA_MIN_CERTAINTY/);
  assert.throws(() => buildConfig({ env: ENV, puerto: 1 }), /Opción desconocida: "puerto"/);
  // las opciones mandan sobre el entorno
  assert.equal(buildConfig({ env: { PORT: "4000" }, port: 5000 }).port, 5000);
});

test("startPantallaContexto: arranca en un puerto libre, responde y se cierra (dos veces seguidas sin error)", async () => {
  const screen = await startPantallaContexto({ env: ENV, port: 0, backend: "ocr" });
  assert.match(screen.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(screen.port > 0);
  const config = await (await fetch(`${screen.url}/api/config`)).json();
  assert.equal(config.export.mode, "verified");
  assert.equal(screen.context(), null); // nada verificado todavía
  await screen.close();
  await screen.close();
  await assert.rejects(fetch(`${screen.url}/api/config`));
});

test("startPantallaContexto: un puerto ocupado rechaza la promesa y no deja el OCR cargado", async () => {
  const blocker = http.createServer().listen(0, "127.0.0.1");
  await new Promise((r) => blocker.once("listening", r));
  try {
    await assert.rejects(startPantallaContexto({ env: ENV, port: blocker.address().port, backend: "ocr" }), { code: "EADDRINUSE" });
  } finally {
    blocker.close();
  }
});

test("de punta a punta con OCR real: nada sale hasta que se confirma; luego lo ven la API en proceso, HTTP y el cliente", async () => {
  const screen = await startPantallaContexto({ env: ENV, port: 0, backend: "ocr", stableFrames: 2 });
  try {
    const verified = [];
    const off = screen.on("context", (c) => verified.push(c));

    const first = await screen.analyzeImage(casino, { mode: "auto", language: "es" });
    assert.equal(first.refused, false);
    assert.equal(first.tracking.verified, false);
    assert.equal(first.context.category, "casino");
    assert.equal(screen.context(), null, "una sola lectura no se exporta");
    assert.equal(verified.length, 0);

    const second = await screen.analyzeImage(casino, { mode: "auto", language: "es" });
    assert.equal(second.tracking.verified, true);
    const latest = screen.context();
    assert.equal(latest.category, "casino");
    assert.equal(latest.verified, true);
    assert.equal(verified.length, 1);
    assert.ok(screen.activity().current, "hay una actividad en curso");
    off();

    const client = createClient({ url: screen.url });
    assert.deepEqual((await client.get()).title, latest.title);
    assert.match(await client.prompt(), /casino|Casino/i);
    assert.equal((await client.activity()).current.category, "casino");
  } finally {
    await screen.close();
  }
});

test("con token, la API HTTP lo exige y la API en proceso no", async () => {
  const screen = await startPantallaContexto({ env: ENV, port: 0, backend: "ocr", stableFrames: 1, apiToken: "token-largo-de-prueba" });
  try {
    await screen.analyzeImage(casino);
    assert.ok(screen.context());
    await assert.rejects(createClient({ url: screen.url }).get(), { code: "unauthorized" });
    assert.ok(await createClient({ url: screen.url, token: "token-largo-de-prueba" }).get());
  } finally {
    await screen.close();
  }
});

test("onContext: solo recibe lo verificado, y un fallo de quien lo recibe no rompe el análisis", async () => {
  const received = [];
  const screen = await startPantallaContexto({
    env: ENV,
    port: 0,
    backend: "ocr",
    stableFrames: 2,
    onContext: (entry) => {
      received.push(entry.title);
      throw new Error("el destino falló");
    },
  });
  try {
    await screen.analyzeImage(casino);
    assert.equal(received.length, 0);
    const second = await screen.analyzeImage(casino);
    assert.equal(second.tracking.verified, true);
    await waitUntil(() => received.length === 1);
  } finally {
    await screen.close();
  }
});
