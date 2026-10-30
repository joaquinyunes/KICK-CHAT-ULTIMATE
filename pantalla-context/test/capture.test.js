import assert from "node:assert/strict";
import { test } from "node:test";
import { changeRatio, decideWatch, fitSize, isRegionTooSmall, luminance, normalizeRect, toSourceRect } from "../public/capture.js";

test("normalizeRect ordena las esquinas y recorta a 0..1", () => {
  assert.deepEqual(normalizeRect({ x: 0.8, y: 0.9 }, { x: 0.2, y: 0.1 }), { x: 0.2, y: 0.1, w: 0.6000000000000001, h: 0.8 });
  assert.deepEqual(normalizeRect({ x: -1, y: 0.5 }, { x: 2, y: 0.5 }), { x: 0, y: 0.5, w: 1, h: 0 });
});

test("toSourceRect: null equivale a pantalla completa", () => {
  assert.deepEqual(toSourceRect(null, 1920, 1080), { x: 0, y: 0, w: 1920, h: 1080 });
});

test("toSourceRect convierte a píxeles y nunca se sale del vídeo", () => {
  assert.deepEqual(toSourceRect({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 1920, 1080), { x: 480, y: 540, w: 960, h: 270 });
  const r = toSourceRect({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, 1000, 1000);
  assert.ok(r.x + r.w <= 1000 && r.y + r.h <= 1000);
});

test("isRegionTooSmall", () => {
  assert.equal(isRegionTooSmall({ w: 31, h: 500 }), true);
  assert.equal(isRegionTooSmall({ w: 500, h: 31 }), true);
  assert.equal(isRegionTooSmall({ w: 32, h: 32 }), false);
});

test("fitSize amplía zonas pequeñas solo si se pide minSide, hasta un máximo de 3x", () => {
  assert.deepEqual(fitSize(400, 300), { width: 400, height: 300 }, "por defecto nunca amplía");
  assert.deepEqual(fitSize(800, 600, 1600, 1280), { width: 1280, height: 960 }, "800 -> 1280 de lado largo");
  assert.deepEqual(fitSize(400, 300, 1600, 1280), { width: 1200, height: 900 }, "3.2x se limita a 3x");
  assert.deepEqual(fitSize(1280, 720, 1600, 1280), { width: 1280, height: 720 }, "ya es suficiente");
  assert.deepEqual(fitSize(2000, 1000, 1600, 1280), { width: 1600, height: 800 }, "una captura grande se reduce, no se amplía");
});

test("fitSize reduce conservando proporción y nunca amplía", () => {
  assert.deepEqual(fitSize(3136, 1568), { width: 1568, height: 784 });
  assert.deepEqual(fitSize(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitSize(1000, 1, 100), { width: 100, height: 1 });
});

test("changeRatio: fracción de celdas que cambian más que el umbral", () => {
  const base = new Uint8Array(100).fill(100);
  assert.equal(changeRatio(base, base), 0);
  const tenCells = base.map((v, i) => (i < 10 ? v + 50 : v));
  assert.equal(changeRatio(base, tenCells), 0.1);
  const noise = base.map((v, i) => v + (i % 2 ? 10 : -10)); // ruido de compresión: no cuenta
  assert.equal(changeRatio(base, noise), 0);
  assert.equal(changeRatio(base, new Uint8Array(50)), 1, "tamaños distintos = todo cambió");
  assert.equal(changeRatio(null, base), 1);
});

const WATCH = { busy: false, now: 100_000, notBefore: 0, lastEnd: 80_000, minGapMs: 10_000, heartbeatMs: 0, hasBaseline: true, changed: false, settled: true, changedSince: null };
const decide = (over) => decideWatch({ ...WATCH, ...over });

test("decideWatch: sin cambios no hace nada", () => {
  assert.equal(decide({}), "idle");
});

test("decideWatch: primer análisis inmediato, salvo ocupado o en respiro tras un error", () => {
  assert.equal(decide({ hasBaseline: false }), "analyze");
  assert.equal(decide({ hasBaseline: false, busy: true }), "wait");
  assert.equal(decide({ hasBaseline: false, notBefore: 100_001 }), "wait");
});

test("decideWatch: un cambio se analiza cuando la imagen se estabiliza y pasó la separación mínima", () => {
  assert.equal(decide({ changed: true, settled: true }), "analyze");
  assert.equal(decide({ changed: true, settled: false, changedSince: 99_000 }), "wait", "sigue moviéndose: esperar");
  assert.equal(decide({ changed: true, settled: true, lastEnd: 95_000 }), "wait", "demasiado pronto desde el último");
  assert.equal(decide({ changed: true, busy: true }), "wait");
});

test("decideWatch: si la imagen nunca se estabiliza se analiza pasado el tiempo máximo", () => {
  assert.equal(decide({ changed: true, settled: false, changedSince: 91_999 }), "analyze");
  assert.equal(decide({ changed: true, settled: false, changedSince: 92_001 }), "wait");
  assert.equal(decide({ changed: true, settled: false, changedSince: 50_000, maxSettleMs: 1000 }), "analyze");
});

test("decideWatch: el refresco periódico solo actúa si está activado y venció", () => {
  assert.equal(decide({ heartbeatMs: 60_000 }), "idle");
  assert.equal(decide({ heartbeatMs: 60_000, lastEnd: 30_000 }), "analyze");
  assert.equal(decide({ heartbeatMs: 0, lastEnd: 0 }), "idle");
});

test("luminance pondera los canales RGB", () => {
  const out = luminance(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 255, 255, 255, 255]));
  assert.deepEqual([...out], [76, 150, 255]);
});
