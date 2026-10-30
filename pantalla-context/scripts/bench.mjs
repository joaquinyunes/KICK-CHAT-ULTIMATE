// npm run bench -> ejecuta el banco de precisión con el OCR real y muestra el resultado por pantalla.
import { runBenchmark } from "../test/bench.js";
import { createOcrEngine } from "../src/ocr/engine.js";

const engine = createOcrEngine({ langs: ["eng"], keepAliveMs: 1000 });
const { rows, summary } = await runBenchmark(engine);
await engine.close();

const pct = (n) => `${Math.round(n * 100)}%`;
console.log("\nPantalla        Esperado          Detectado         Cert.  Datos");
for (const r of rows) {
  const ok = r.facts.filter((f) => f.status === "ok").length;
  console.log(`${r.categoryOk ? "✓" : "✗"} ${r.name.padEnd(13)} ${r.want.padEnd(17)} ${r.got.padEnd(17)} ${r.certainty.toFixed(2)}   ${r.facts.length ? `${ok}/${r.facts.length}` : "—"}${r.negative ? "  (caso negativo)" : ""}`);
  for (const f of r.facts.filter((f) => f.status !== "ok")) console.log(`    ${f.status === "wrong" ? "✗ distinto" : "· falta"}   ${f.label}: esperado «${f.want}»${f.got ? `, leído «${f.got}»` : ""}`);
}
console.log(`\nCategoría correcta: ${pct(summary.categoryAccuracy)} (${rows.filter((r) => r.categoryOk).length}/${summary.scenes})`);
console.log(`Titular correcto:   ${pct(summary.titleAccuracy)}`);
console.log(`Datos clave:        ${pct(summary.factRecall)} acertados · ${summary.factWrong} distintos · ${summary.factMissing} sin leer (de ${summary.facts})`);
console.log(`Calibración:        ${summary.confidentWrong} errores con certeza ≥ 0.80 · certeza media en pantallas reales ${summary.meanCertaintyReal.toFixed(2)} · máxima en negativos ${summary.maxCertaintyNegative.toFixed(2)}`);
