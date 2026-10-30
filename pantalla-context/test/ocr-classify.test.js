import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { extractContext } from "../src/ocr/extract.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.ocr.json`, import.meta.url), "utf8"));
// Línea con posición: y en píxeles sobre una pantalla de 720 de alto.
const ln = (text, y, h = 20, conf = 90) => ({ text, confidence: conf, bbox: { x0: 40, y0: y, x1: 700, y1: y + h } });
const screen = (...lines) => ({ lines, confidence: 90, height: 720 });
const facts = (r) => Object.fromEntries(r.entities.map((e) => [e.label, e.value]));

test("una app en la barra superior pesa; la misma mencionada en el cuerpo, casi nada", () => {
  const inTitleBar = extractContext(screen(ln("OBS Studio", 8, 16), ln("Escenas y fuentes", 300)));
  const inBody = extractContext(screen(ln("Escenas y fuentes", 8, 16), ln("OBS Studio", 300, 16)));
  assert.equal(inTitleBar.category, "streaming");
  assert.equal(inBody.category, "other");
});

test("un titular grande cerca del borde no cuenta como barra superior (la barra tiene letra pequeña)", () => {
  const r = extractContext(screen(ln("Titular grande de la noticia de hoy", 60, 40), ln("Discord", 300, 16)));
  assert.equal(r.category, "other", "Discord solo aparece en el cuerpo");
});

test("la reseña de un slot NO es jugar: los mismos nombres pesan menos en un artículo", () => {
  const article = extractContext(
    screen(
      ln("https://www.casinoreviews.com/slots/sweet-bonanza-review", 10, 16),
      ln("Sweet Bonanza: reseña completa del slot de Pragmatic Play", 90, 40),
      ln("Por Redacción · 5 oct 2026 · Leer más", 150, 16),
      ln("Sweet Bonanza es una de las tragaperras más populares del proveedor y destaca por su mecánica de cascadas", 230),
      ln("En esta reseña analizamos su volatilidad y las rondas de giros gratis que ofrece el juego a los jugadores", 270),
    ),
  );
  assert.equal(article.category, "browsing");
  assert.ok(article.reasons.some((r) => /artículo/.test(r)));
});

test("…pero con la interfaz propia del juego (saldo y apuesta) sigue siendo jugar, aunque haya texto largo", () => {
  const playing = extractContext(
    screen(
      ln("https://www.stake.com/casino/games/sweet-bonanza", 10, 16),
      ln("SWEET BONANZA", 90, 50),
      ln("Sweet Bonanza es una de las tragaperras más populares del proveedor y destaca por su mecánica de cascadas", 230),
      ln("En esta descripción se explican las reglas del juego y las rondas de giros gratis que ofrece a los jugadores", 270),
      ln("BALANCE €148.30", 660),
      ln("BET €2.00", 660),
    ),
  );
  assert.equal(playing.category, "casino");
});

test("el partido con cuotas en pantalla sigue siendo apuestas; la crónica del mismo partido, navegación", () => {
  const board = extractContext({ ...fixture("sports"), height: 720 });
  assert.equal(board.category, "sports_betting");
  const report = extractContext(
    screen(
      ln("https://www.marca.com/futbol/champions-league/cronica-madrid-city.html", 10, 16),
      ln("Real Madrid 2 - 1 Manchester City", 90, 44),
      ln("Madrid · 5 oct 2026 · Suscríbete para seguir leyendo", 150, 16),
      ln("El conjunto blanco se impuso en el Santiago Bernabéu con un gol en el minuto 67 que decidió un partido muy disputado", 230),
      ln("El técnico destacó la intensidad de la segunda parte y la solidez defensiva durante todo el encuentro disputado en casa", 270),
    ),
  );
  assert.equal(report.category, "browsing");
});

test("la certeza crece con evidencias independientes y nunca llega a 1 con una sola", () => {
  const onlyName = extractContext(screen(ln("SWEET BONANZA", 90, 50)), { mode: "auto" });
  const full = extractContext({ ...fixture("casino"), height: 720 });
  assert.ok(onlyName.certainty < 0.7, `solo el nombre: ${onlyName.certainty}`);
  assert.ok(full.certainty >= 0.85, `con juego, proveedor, saldo y apuesta: ${full.certainty}`);
  assert.ok(full.certainty < 1);
});

test("si hay otra actividad igual de probable, la certeza baja", () => {
  const clear = extractContext(screen(ln("Gmail", 8, 16), ln("Bandeja de entrada", 100)));
  const ambiguous = extractContext(screen(ln("Gmail", 8, 16), ln("Discord", 30, 16), ln("Bandeja de entrada", 100)));
  assert.ok(ambiguous.certainty < clear.certainty, `${ambiguous.certainty} < ${clear.certainty}`);
});

test("explica por qué: motivos legibles y la línea de pantalla de cada dato", () => {
  const r = extractContext({ ...fixture("casino"), height: 720 });
  assert.ok(r.reasons.includes("Juego del catálogo: Sweet Bonanza"));
  assert.ok(r.reasons.includes("Saldo y apuesta visibles"));
  assert.ok(r.reasons.length <= 8);
  const saldo = r.evidence.find((e) => e.label === "Saldo");
  assert.match(saldo.text, /BALANCE €148\.30/);
  assert.ok(saldo.confidence > 50);
  assert.ok(r.evidence.every((e) => e.text.length <= 100));
});

test("el «sujeto» es una identidad estable de lo que se hace", () => {
  assert.equal(extractContext({ ...fixture("casino"), height: 720 }).subject, "Sweet Bonanza");
  assert.equal(extractContext({ ...fixture("sports"), height: 720 }).subject, "real madrid vs manchester city");
  assert.equal(extractContext({ ...fixture("trading"), height: 720 }).subject, "BTC/USDT");
  assert.equal(extractContext({ ...fixture("game"), height: 720 }).subject, "Valorant");
});

test("correo, chat y reunión: no se exporta el texto leído, solo lo que haces", () => {
  const chatScreen = screen(ln("Discord", 8, 16), ln("# general", 60), ln("maria hoy 18:02 ¿alguien probó el OCR?", 120), ln("luis hoy 18:03 sí, va muy bien", 160), ln("maria hoy 18:04 genial, gracias", 200));
  const hidden = extractContext(chatScreen);
  assert.equal(hidden.category, "chat");
  assert.equal(hidden.text, "");
  assert.ok(hidden.uncertain.some((u) => /omite por privacidad/.test(u)));
  assert.doesNotMatch(JSON.stringify(hidden), /OCR\?|va muy bien|maria|luis/, "ni en el texto ni en los datos");
  const kept = extractContext(chatScreen, { keepPrivateText: true });
  assert.match(kept.text, /va muy bien/);
});

test("el tipo elegido por el usuario desempata entre varias actividades", () => {
  const ambiguous = screen(ln("Roulette", 100), ln("Balance 20.00", 200), ln("Open High Low Close", 300));
  assert.equal(extractContext(ambiguous, { mode: "casino" }).category, "casino");
  assert.equal(extractContext(ambiguous, { mode: "trading" }).category, "trading");
});

test("el dominio orienta: una casa de apuestas con partido y sin cuotas legibles", () => {
  const r = extractContext(screen(ln("https://www.bet365.com/#/IP/EV15", 10, 16), ln("Boca Juniors 1 - 0 River Plate", 100, 40), ln("Copa Libertadores · 55'", 160)));
  assert.equal(r.category, "sports_betting");
});

test("un nombre deducido del texto más grande rebaja la certeza (es una suposición, no una coincidencia)", () => {
  const known = extractContext(screen(ln("SWEET BONANZA", 90, 50), ln("BALANCE 100.00", 660), ln("BET 1.00", 660)));
  const guessed = extractContext(screen(ln("MEGA FORTUNE TREE", 90, 50), ln("BALANCE 100.00", 660), ln("BET 1.00", 660)));
  assert.equal(known.category, "casino");
  assert.equal(guessed.category, "casino");
  assert.ok(guessed.certainty < known.certainty * 0.75, `${guessed.certainty} vs ${known.certainty}`);
  assert.ok(guessed.uncertain.some((u) => /deduj/.test(u)));
});
