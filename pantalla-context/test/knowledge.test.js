import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildIndex, DEFAULT_KNOWLEDGE, domainCategories, editDistanceWithin, findNamesInLine, KNOWLEDGE_KEYS, loadKnowledge, mergeKnowledge, normalizeText } from "../src/ocr/knowledge.js";

const index = buildIndex(mergeKnowledge());
const names = (line) => findNamesInLine(index, line).map((m) => `${m.type}:${m.name}${m.exact ? "" : "~"}`);

test("normalizeText quita acentos, mayúsculas, apóstrofos y símbolos", () => {
  assert.equal(normalizeText("  Gonzo's QUEST!! "), "gonzos quest");
  assert.equal(normalizeText("Próximo gol · 1X2"), "proximo gol 1x2");
  assert.equal(normalizeText("Play'n GO"), "playn go");
});

test("editDistanceWithin acierta y corta pronto cuando se pasa del máximo", () => {
  assert.equal(editDistanceWithin("sweet bonanza", "sweet bonanz4", 2), 1);
  assert.equal(editDistanceWithin("abc", "abc", 1), 0);
  assert.ok(editDistanceWithin("abcdef", "uvwxyz", 2) > 2);
  assert.ok(editDistanceWithin("a", "abcdef", 2) > 2);
});

test("reconoce nombres exactos y con errores típicos de OCR", () => {
  assert.deepEqual(names("SWEET BONANZA"), ["slots:Sweet Bonanza"]);
  assert.deepEqual(names("SWEET BONANZ4"), ["slots:Sweet Bonanza~"]);
  assert.deepEqual(names("Slots > Pragmatic Play"), ["providers:Pragmatic Play"]);
  assert.deepEqual(names("Real Madrid 2 - 1 Manchester City").sort(), ["teams:Manchester City", "teams:Real Madrid"]);
});

test("entre «Champions League» y «UEFA Champions League» se queda con la más larga", () => {
  assert.deepEqual(names("UEFA Champions League"), ["leagues:UEFA Champions League"]);
});

test("exige palabras completas: no hay falsos positivos por subcadenas", () => {
  assert.deepEqual(names("indices determines undercover"), []);
  assert.deepEqual(names("Stakeholders meeting"), []);
});

test("mergeKnowledge añade lo del usuario, filtra basura y no toca el catálogo base", () => {
  const before = DEFAULT_KNOWLEDGE.slots.length;
  const merged = mergeKnowledge({ slots: ["Mi Tragaperras Local", 5, "", " x ", null], inventada: ["nada"], teams: "no es lista" });
  assert.ok(merged.slots.includes("Mi Tragaperras Local"));
  assert.ok(!merged.slots.includes("x") && !merged.slots.includes(5));
  assert.deepEqual(Object.keys(merged), [...KNOWLEDGE_KEYS, "domains"]);
  assert.equal(DEFAULT_KNOWLEDGE.slots.length, before);
  assert.deepEqual(findNamesInLine(buildIndex(merged), "MI TRAGAPERRAS LOCAL").map((m) => m.name), ["Mi Tragaperras Local"]);
});

test("loadKnowledge lee un JSON del usuario y explica los errores", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kn-"));
  const good = path.join(dir, "good.json");
  writeFileSync(good, JSON.stringify({ games: ["Mi Juego Indie"] }));
  assert.ok(loadKnowledge(good).games.includes("Mi Juego Indie"));
  assert.ok(loadKnowledge(null).slots.includes("Sweet Bonanza"));

  const bad = path.join(dir, "bad.json");
  writeFileSync(bad, "{no es json");
  assert.throws(() => loadKnowledge(bad), /PANTALLA_KNOWLEDGE_FILE/);
  assert.throws(() => loadKnowledge(path.join(dir, "no-existe.json")), /PANTALLA_KNOWLEDGE_FILE/);
});

test("apps del usuario: cadena suelta = documents, objeto con categoría válida, categoría inventada se ignora", () => {
  const merged = mergeKnowledge({ apps: ["Mi Hoja", { name: "Mi IDE", category: "coding" }, { name: "Mala", category: "inventada" }, { name: "x", category: "coding" }, 5] });
  const added = merged.apps.slice(DEFAULT_KNOWLEDGE.apps.length);
  assert.deepEqual(added, [{ name: "Mi Hoja", category: "documents" }, { name: "Mi IDE", category: "coding" }]);
  assert.equal(buildIndex(merged).find((e) => e.name === "Mi IDE").category, "coding");
});

test("domains del usuario: solo categorías válidas, y mandan sobre el catálogo", () => {
  const merged = mergeKnowledge({ domains: { "Mi-Casino.com": "casino", "malo.com": "inventada", "github.com": "documents" }, });
  assert.deepEqual(merged.domains, { "mi-casino.com": "casino", "github.com": "documents" });
  assert.deepEqual(domainCategories("www.mi-casino.com", merged.domains), ["casino"]);
  assert.deepEqual(domainCategories("github.com", merged.domains), ["documents"]);
  assert.deepEqual(domainCategories("github.com"), ["coding"]);
});

test("domainCategories reconoce subdominios, dominios con país y desconocidos", () => {
  assert.deepEqual(domainCategories("www.stake.com"), ["casino", "sports_betting"]);
  assert.deepEqual(domainCategories("stake.com.mx"), ["casino", "sports_betting"]);
  assert.deepEqual(domainCategories("mail.google.com"), ["email"]);
  assert.deepEqual(domainCategories("sub.github.com"), ["coding"]);
  assert.deepEqual(domainCategories("bc.game"), ["casino"]);
  assert.deepEqual(domainCategories("www.elpais.com"), []);
});
