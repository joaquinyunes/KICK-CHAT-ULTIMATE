import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { imageSize } from "../src/ocr/image.js";
import { enhanceLightText } from "../src/ocr/preprocess.js";
import { mergeReadings, readsPoorly } from "../src/ocr/engine.js";

const scene = (name) => readFileSync(new URL(`./fixtures/scenes/${name}.jpg`, import.meta.url));

test("imageSize lee JPEG y PNG solo con la cabecera", () => {
  assert.deepEqual(imageSize(scene("casino")), { width: 1280, height: 720, format: "jpeg" });
  assert.deepEqual(imageSize(scene("small_text")), { width: 1920, height: 1080, format: "jpeg" });
  const png = Buffer.alloc(32);
  png.writeUInt32BE(0x89504e47, 0);
  png.writeUInt32BE(640, 16);
  png.writeUInt32BE(480, 20);
  assert.deepEqual(imageSize(png), { width: 640, height: 480, format: "png" });
  for (const bad of [Buffer.from("hola"), Buffer.alloc(0), Buffer.from([0xff, 0xd8, 0xff])]) assert.equal(imageSize(bad), null);
});

test("enhanceLightText devuelve un BMP de 8 bits con las dimensiones de la imagen", () => {
  const out = enhanceLightText(scene("casino_hard"));
  assert.equal(out.image.toString("latin1", 0, 2), "BM");
  assert.equal(out.image.readInt32LE(18), 1280);
  assert.equal(Math.abs(out.image.readInt32LE(22)), 720);
  assert.equal(out.image.readUInt16LE(28), 8);
  assert.equal(out.image.length, 54 + 1024 + 1280 * 720);
  assert.ok(out.ms >= 0);
  // El texto claro pasa a negro sobre blanco: hay píxeles de ambos tipos.
  const pixels = out.image.subarray(54 + 1024);
  assert.ok(pixels.includes(0) && pixels.includes(255));
});

test("enhanceLightText devuelve null si no es un JPEG decodificable", () => {
  assert.equal(enhanceLightText(Buffer.from("no soy una imagen")), null);
  assert.equal(enhanceLightText(Buffer.alloc(0)), null);
});

test("readsPoorly: solo cuentan las líneas con texto; los iconos no disparan el segundo paso", () => {
  const good = { lines: [{ text: "SWEET BONANZA", confidence: 92 }, { text: "BALANCE €148.30", confidence: 95 }] };
  const icons = { lines: [...good.lines, ...Array.from({ length: 20 }, () => ({ text: "@ ®", confidence: 12 }))] };
  assert.equal(readsPoorly(good), false);
  assert.equal(readsPoorly(icons), false, "el ruido de dibujos no cuenta");
  assert.equal(readsPoorly({ lines: [{ text: "GANESIOROLEYIVIRUS", confidence: 18 }] }), true);
  assert.equal(readsPoorly({ lines: [] }), false, "pantalla vacía: nada que rescatar");
  assert.equal(readsPoorly({ lines: [{ text: "HP 87", confidence: 90 }] }), true, "muy poco texto útil");
});

test("mergeReadings: gana la línea más segura donde ambas leen y se añade lo que solo vio una", () => {
  const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
  const first = [{ text: "GANESIOROLEYIVIRUS", confidence: 18, bbox: box(300, 85, 980, 125) }, { text: "BALANCE", confidence: 90, bbox: box(40, 650, 300, 690) }];
  const second = [{ text: "GATES OF OLYMPUS", confidence: 95, bbox: box(310, 88, 975, 122) }, { text: "Pragmatic Play", confidence: 90, bbox: box(500, 140, 800, 170) }];
  const merged = mergeReadings(first, second);
  assert.deepEqual(merged.map((l) => l.text), ["GATES OF OLYMPUS", "Pragmatic Play", "BALANCE"], "ordenadas de arriba abajo");
  assert.ok(!merged.some((l) => l.text === "GANESIOROLEYIVIRUS"));
});
