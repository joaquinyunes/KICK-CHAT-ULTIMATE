import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createOcrEngine } from "../src/ocr/engine.js";
import { HttpError } from "../src/validate.js";

const image = (name) => readFileSync(new URL(`./fixtures/${name}.jpg`, import.meta.url));

// Cuenta cuántos trabajadores se crean y se destruyen, usando Tesseract de verdad.
function countingLoader() {
  const counts = { created: 0, terminated: 0 };
  return {
    counts,
    loadTesseract: async () => {
      const real = await import("tesseract.js");
      const createWorker = real.createWorker ?? real.default.createWorker;
      return {
        createWorker: async (...args) => {
          counts.created++;
          const worker = await createWorker(...args);
          const terminate = worker.terminate.bind(worker);
          worker.terminate = async () => {
            counts.terminated++;
            return terminate();
          };
          return worker;
        },
      };
    },
  };
}

test("lee de verdad el texto de una captura y devuelve las líneas con su posición", async () => {
  const engine = createOcrEngine({ langs: ["eng"] });
  try {
    const r = await engine.recognize(image("casino"));
    assert.match(r.text, /SWEET BONANZA/);
    assert.match(r.text, /BALANCE €148\.30/);
    assert.match(r.text, /MULTIPLIER x25/);
    assert.ok(r.confidence > 60);
    assert.ok(r.ms > 0);
    const balance = r.lines.find((l) => /BALANCE/.test(l.text));
    assert.ok(balance.bbox.x1 > balance.bbox.x0 && balance.bbox.y1 > balance.bbox.y0);
    assert.ok(balance.bbox.y0 > 600, "el pie de la pantalla está en la parte baja de la imagen");
    // El mismo trabajador sirve para más capturas.
    assert.match((await engine.recognize(image("trading"))).text, /BTC\/USDT/);
  } finally {
    await engine.close();
  }
});

test("con inglés + español junta los idiomas y lee los acentos", async () => {
  const engine = createOcrEngine({ langs: ["eng", "spa"] });
  try {
    assert.deepEqual(engine.langs, ["eng", "spa"]);
    const { text } = await engine.recognize(image("sports"));
    assert.match(text, /Fútbol/);
    assert.match(text, /Próximo gol/);
  } finally {
    await engine.close();
  }
});

test("el trabajador (≈160 MB) se libera tras la inactividad y se recrea al volver a usarlo", async () => {
  const { counts, loadTesseract } = countingLoader();
  const engine = createOcrEngine({ langs: ["eng"], keepAliveMs: 150, loadTesseract });
  try {
    await engine.recognize(image("game"));
    assert.deepEqual(counts, { created: 1, terminated: 0 });
    await engine.recognize(image("game")); // dentro del plazo: reutiliza el mismo trabajador
    assert.equal(counts.created, 1);
    await new Promise((r) => setTimeout(r, 500));
    assert.deepEqual(counts, { created: 1, terminated: 1 }, "liberado por inactividad");
    assert.match((await engine.recognize(image("game"))).text, /VALORANT/);
    assert.equal(counts.created, 2, "recreado al volver a usarlo");
  } finally {
    await engine.close();
  }
  assert.equal(counts.terminated, 2);
});

test("un fallo de Tesseract es un 502 ocr_failed y la siguiente captura lo intenta de nuevo", async () => {
  let attempts = 0;
  const engine = createOcrEngine({
    langs: ["eng"],
    loadTesseract: async () => ({
      createWorker: async () => {
        attempts++;
        throw new Error("sin memoria");
      },
    }),
  });
  await assert.rejects(engine.recognize(Buffer.from("x")), (e) => e instanceof HttpError && e.status === 502 && e.code === "ocr_failed" && /sin memoria/.test(e.message));
  await assert.rejects(engine.recognize(Buffer.from("x")), (e) => e.code === "ocr_failed");
  assert.equal(attempts, 2, "no se queda con el trabajador roto");
  await engine.close();
});

test("available() distingue instalado, idioma ausente y Tesseract ausente, sin arrancar el trabajador", async () => {
  const { counts, loadTesseract } = countingLoader();
  assert.deepEqual(await createOcrEngine({ langs: ["eng"], loadTesseract }).available(), { ok: true });
  assert.equal(counts.created, 0);

  const missingLang = await createOcrEngine({ langs: ["eng", "xxx"] }).available();
  assert.equal(missingLang.ok, false);
  assert.match(missingLang.error, /npm install @tesseract\.js-data\/xxx/);

  const noTesseract = await createOcrEngine({
    langs: ["eng"],
    loadTesseract: async () => {
      throw new Error("Cannot find module");
    },
  }).available();
  assert.deepEqual(noTesseract, { ok: false, error: "Cannot find module" });
});
