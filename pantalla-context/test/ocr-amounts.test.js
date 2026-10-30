import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDelta, parseAmount } from "../src/ocr/amounts.js";

test("símbolos y códigos de moneda", () => {
  assert.deepEqual(parseAmount("€148.30"), { value: 148.3, currency: "EUR" });
  assert.deepEqual(parseAmount("$1,200.50"), { value: 1200.5, currency: "USD" });
  assert.deepEqual(parseAmount("£9.99"), { value: 9.99, currency: "GBP" });
  assert.deepEqual(parseAmount("R$ 12,00"), { value: 12, currency: "BRL" }, "«R$» no es un dólar");
  assert.deepEqual(parseAmount("USD 45"), { value: 45, currency: "USD" });
  assert.deepEqual(parseAmount("1,245.8 BTC"), { value: 1245.8, currency: "BTC" });
  assert.deepEqual(parseAmount("148,30"), { value: 148.3, currency: null });
});

test("separadores de miles y decimales en los dos formatos", () => {
  assert.equal(parseAmount("1.200,50 €").value, 1200.5);
  assert.equal(parseAmount("1,200.50").value, 1200.5);
  assert.equal(parseAmount("1.200").value, 1200, "tres cifras tras el separador son miles");
  assert.equal(parseAmount("1,200,000").value, 1200000);
  assert.equal(parseAmount("0,5").value, 0.5);
  assert.equal(parseAmount("148.30").value, 148.3);
  assert.equal(parseAmount("12.").value, 12, "punto final de frase");
});

test("el signo solo cuenta si va pegado a la cifra, no cualquier guion", () => {
  assert.equal(parseAmount("-€3.50").value, -3.5);
  assert.equal(parseAmount("€-3.50").value, -3.5);
  assert.equal(parseAmount("−$1,200.50").value, -1200.5);
  assert.equal(parseAmount("WIN -5.00").value, -5);
  assert.equal(parseAmount("2 - 1").value, 2, "un marcador no es una cifra negativa");
});

test("sin número devuelve null", () => {
  for (const text of ["sin numero", "", null, undefined, "€"]) assert.equal(parseAmount(text), null, String(text));
});

test("formatDelta pone el signo y el símbolo", () => {
  assert.equal(formatDelta(-40.5, "EUR"), "−€40.50");
  assert.equal(formatDelta(12.3, "USD"), "+$12.30");
  assert.equal(formatDelta(0, "EUR"), "€0.00");
  assert.equal(formatDelta(5, null), "+5.00");
  assert.equal(formatDelta(-2, "MXN"), "−2.00 MXN");
});
