import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createOcrEngine } from "../src/ocr/engine.js";
import { runBenchmark } from "./bench.js";

// Banco de precisión con el OCR REAL sobre 23 pantallas sintéticas (casos felices, difíciles, adversos y vacíos).
// Los umbrales son lo medido hoy: sirven para detectar que algo empeora, no para prometer lo mismo en webs reales.
const engine = createOcrEngine({ langs: ["eng"], keepAliveMs: 500 });
after(() => engine.close());

test("banco de precisión: categorías, datos clave y calibración", async () => {
  const { rows, summary } = await runBenchmark(engine);
  const detail = rows.filter((r) => !r.categoryOk).map((r) => `${r.name}: esperado ${r.want}, dio ${r.got}`).join("; ");

  assert.equal(summary.categoryAccuracy, 1, `categorías incorrectas: ${detail}`);
  assert.equal(summary.titleAccuracy, 1, `titulares: ${rows.filter((r) => r.titleOk === false).map((r) => `${r.name} -> ${r.title}`).join("; ")}`);
  assert.equal(summary.factWrong, 0, `datos con valor distinto: ${rows.flatMap((r) => r.facts.filter((f) => f.status === "wrong").map((f) => `${r.name}.${f.label}`)).join(", ")}`);
  assert.ok(summary.factRecall >= 0.9, `datos clave acertados: ${summary.factRecall}`);
  assert.equal(summary.confidentWrong, 0, "nada equivocado puede tener certeza alta");

  // Lo que no hay que leer no se inventa.
  for (const name of ["blank", "noise", "lorem"]) assert.equal(rows.find((r) => r.name === name).got, "other", name);
  assert.ok(rows.find((r) => r.name === "blank").certainty === 0);
});

test("el segundo paso solo se usa donde hace falta (pantalla con texto claro sobre fondo claro)", async () => {
  const { rows } = await runBenchmark(engine);
  assert.deepEqual(rows.filter((r) => r.enhanced).map((r) => r.name), ["casino_hard"]);
});
