import { readFileSync } from "node:fs";
import { extractContext } from "../src/ocr/extract.js";
import { normalizeText } from "../src/ocr/knowledge.js";

// Banco de precisión: pantallas SINTÉTICAS (test/fixtures/scenes) con la respuesta correcta de lo que se dibujó.
// Mide con el OCR real. Sirve para no empeorar; no promete lo mismo en webs reales, que son más sucias que estas.

const dir = new URL("./fixtures/", import.meta.url);
export const expected = JSON.parse(readFileSync(new URL("scenes.expected.json", dir), "utf8"));
export const sceneImage = (name) => readFileSync(new URL(`scenes/${name}.jpg`, dir));

const same = (got, want) => {
  const g = normalizeText(got);
  const w = normalizeText(want);
  return g === w || g.includes(w);
};

export async function runBenchmark(engine, { language = "es", names = Object.keys(expected) } = {}) {
  const rows = [];
  for (const name of names) {
    const want = expected[name];
    const ocr = await engine.recognize(sceneImage(name));
    const got = extractContext(ocr, { language });
    const facts = Object.entries(want.facts).map(([label, value]) => {
      const found = got.entities.find((e) => e.label === label);
      return { label, want: value, got: found?.value ?? null, status: !found ? "missing" : same(found.value, value) ? "ok" : "wrong" };
    });
    rows.push({
      name,
      want: want.category,
      got: got.category,
      categoryOk: got.category === want.category,
      titleOk: want.title ? same(got.title, want.title) : null,
      certainty: got.certainty,
      confidence: got.confidence,
      negative: Boolean(want.negative),
      facts,
      title: got.title,
      ms: ocr.ms,
      enhanced: ocr.enhanced,
    });
  }
  const real = rows.filter((r) => !r.negative);
  const negatives = rows.filter((r) => r.negative);
  const facts = rows.flatMap((r) => r.facts);
  return {
    rows,
    summary: {
      scenes: rows.length,
      categoryAccuracy: rows.filter((r) => r.categoryOk).length / rows.length,
      titleAccuracy: rows.filter((r) => r.titleOk === true).length / Math.max(1, rows.filter((r) => r.titleOk !== null).length),
      factRecall: facts.filter((f) => f.status === "ok").length / Math.max(1, facts.length),
      factWrong: facts.filter((f) => f.status === "wrong").length,
      factMissing: facts.filter((f) => f.status === "missing").length,
      facts: facts.length,
      // Calibración: lo que el sistema da por bastante seguro, ¿acierta?
      confidentWrong: rows.filter((r) => r.certainty >= 0.8 && !r.categoryOk).length,
      meanCertaintyReal: real.reduce((n, r) => n + r.certainty, 0) / Math.max(1, real.length),
      maxCertaintyNegative: Math.max(0, ...negatives.map((r) => r.certainty)),
    },
  };
}
