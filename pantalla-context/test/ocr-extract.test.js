import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { extractContext, redactSensitive } from "../src/ocr/extract.js";

// Las cuatro pantallas son salidas REALES del OCR (Tesseract) sobre capturas de prueba: test/fixtures/*.ocr.json
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.ocr.json`, import.meta.url), "utf8"));
const run = (name, options = {}) => extractContext(fixture(name), { language: "es", mode: "auto", ...options });
const facts = (r) => Object.fromEntries(r.entities.map((e) => [e.label, e.value]));
const L = (text, h = 20, confidence = 90) => ({ text, confidence, bbox: { x0: 0, y0: 0, x1: 300, y1: h } });
const lines = (...items) => ({ lines: items.map((i) => (typeof i === "string" ? L(i) : i)), confidence: 85 });

test("casino: juego, proveedor, sitio, importes, giros y multiplicador", () => {
  const r = run("casino");
  assert.equal(r.category, "casino");
  assert.equal(r.confidence, "high");
  assert.equal(r.title, "Casino: Sweet Bonanza (Pragmatic Play)");
  assert.deepEqual(facts(r), { Juego: "Sweet Bonanza", Proveedor: "Pragmatic Play", Sitio: "Stake", Apuesta: "€2.00", Saldo: "€148.30", Ganancia: "€36.50", "Giros gratis": "8", Multiplicador: "x25" });
  assert.match(r.summary, /apuesta €2\.00, saldo €148\.30/);
});

test("casino: «FREE SPINS 8» no toma el 50 de «€36.50» de la línea anterior", () => {
  assert.equal(facts(run("casino"))["Giros gratis"], "8");
});

test("casino: descarta el ruido de los dibujos (líneas con símbolos y poca confianza)", () => {
  const r = run("casino");
  assert.doesNotMatch(r.text, /[@®]/);
  assert.match(r.text, /^STAKE CASINO/);
});

test("partido con cuotas -> apuestas deportivas, con las cuotas asociadas a su equipo por posición", () => {
  const r = run("sports");
  assert.equal(r.category, "sports_betting");
  assert.equal(r.title, "Real Madrid 2-1 Manchester City");
  assert.deepEqual(facts(r), {
    Partido: "Real Madrid vs Manchester City", Marcador: "2-1", Minuto: "67'", Competición: "UEFA Champions League", Sitio: "Bet365",
    Cuotas: "Real Madrid 1.45 · Empate 4.20 · Manchester City 6.75", Apuesta: "€10.00",
  });
  assert.equal(r.activity, "en directo");
});

test("videojuego: título, ronda y datos del HUD", () => {
  const r = run("game");
  assert.equal(r.category, "video_game");
  assert.equal(r.title, "Videojuego: Valorant");
  assert.deepEqual(facts(r), { Juego: "Valorant", HP: "100", Kills: "18", Deaths: "9", "K/D": "2.0", Ronda: "14" });
});

test("trading: par, temporalidad, precio e indicadores", () => {
  const r = run("trading");
  assert.equal(r.category, "trading");
  assert.equal(r.title, "Trading: BTC/USDT 1h");
  assert.deepEqual(facts(r), { Par: "BTC/USDT", Temporalidad: "1h", Precio: "67,420.50 (+2.35%)", RSI: "61.2", "MA(50)": "65,880" });
});

test("en inglés usa las etiquetas en inglés", () => {
  const r = run("casino", { language: "en" });
  assert.equal(r.title, "Casino: Sweet Bonanza (Pragmatic Play)");
  assert.deepEqual(Object.keys(facts(r)).slice(0, 4), ["Game", "Provider", "Site", "Bet"]);
  assert.match(r.uncertain[0], /Text-only analysis/);
});

test("siempre avisa de que es un análisis solo por texto", () => {
  for (const name of ["casino", "sports", "game", "trading"]) assert.match(run(name).uncertain[0], /solo por texto/);
});

test("juego fuera del catálogo: usa el texto más grande y lo marca como deducido con menos confianza", () => {
  const r = extractContext(lines(L("MEGA FORTUNE TREE", 64, 92), "BALANCE 1,200.00", "BET 5.00", "WIN 0.00", "AUTOPLAY", "SPIN"), { language: "es" });
  assert.equal(r.title, "Casino: MEGA FORTUNE TREE");
  assert.equal(facts(r).Saldo, "1,200.00");
  assert.ok(r.uncertain.some((u) => /deduj/.test(u)));
  assert.notEqual(r.confidence, "high");
});

test("tolera errores del OCR en el nombre del juego", () => {
  const r = extractContext(lines("SWEET BONANZ4", "Balance: $48.10", "Total Bet: $1.00", "Free Spins: 10"));
  assert.equal(r.title, "Casino: Sweet Bonanza");
  assert.equal(facts(r).Apuesta, "$1.00");
});

test("partido sin cuotas -> deporte en directo", () => {
  const r = extractContext(lines(L("Boca Juniors 0 - 0 River Plate", 50), "Copa Libertadores · 1T 23'", "EN DIRECTO"));
  assert.equal(r.category, "sports_live");
  assert.equal(r.title, "Boca Juniors 0-0 River Plate");
});

test("editor de código -> programación; página genérica -> otro con la cabecera como título", () => {
  const code = extractContext(lines("function analyze(req) {", "const result = await run(req)", "Visual Studio Code", "error: undefined is not a function"));
  assert.equal(code.category, "coding");
  assert.equal(facts(code).App, "Visual Studio Code");

  const shop = extractContext(lines(L("Bienvenido a la tienda", 40), "Ofertas de la semana", "Carrito (2)"));
  assert.equal(shop.category, "other");
  assert.equal(shop.confidence, "low");
  assert.equal(shop.title, "Bienvenido a la tienda");
});

test("streaming: plataforma y espectadores", () => {
  const r = extractContext(lines("shroud is live", "12,431 viewers", "Twitch", "Subscribe", "Chat"));
  assert.equal(r.category, "streaming");
  assert.equal(facts(r).Espectadores, "12,431");
});

test("el modo elegido desempata cuando la pantalla es ambigua", () => {
  const ambiguous = lines("Roulette", "Balance 20.00", "Open High Low Close");
  assert.equal(extractContext(ambiguous, { mode: "casino" }).category, "casino");
  assert.equal(extractContext(ambiguous, { mode: "trading" }).category, "trading");
});

test("sin texto o solo ruido: «Pantalla», confianza baja y sin inventar nada", () => {
  for (const input of [{ lines: [], confidence: 0 }, lines(L("= Be He =", 20, 20), L("@®@", 20, 30), L("%", 20, 10))]) {
    const r = extractContext(input);
    assert.deepEqual([r.category, r.confidence, r.text, r.entities], ["other", "low", "", []]);
    assert.match(r.summary, /No se detectó texto legible/);
  }
});

test("OCR con poca confianza baja la certeza y lo avisa", () => {
  const withConfidence = (confidence) => {
    const ocr = fixture("casino");
    return extractContext({ ...ocr, lines: ocr.lines.map((l) => ({ ...l, confidence })) });
  };
  const sure = withConfidence(95);
  const shaky = withConfidence(45);
  assert.equal(sure.confidence, "high");
  assert.ok(shaky.certainty < sure.certainty - 0.2, `${shaky.certainty} debería ser mucho menor que ${sure.certainty}`);
  assert.notEqual(shaky.confidence, "high");
  assert.ok(shaky.uncertain.some((u) => /poca seguridad/.test(u)));
});

test("correos y números largos se enmascaran ANTES de analizar (gmail.com de un correo no es la app Gmail)", () => {
  const r = extractContext(lines("Contacto: juan.perez@gmail.com", "Tarjeta 4111 1111 1111 1111", "Saldo €10.00"));
  assert.equal(r.text, "Contacto: [correo]\nTarjeta [número]\nSaldo €10.00");
  assert.equal(r.category, "other");
  assert.equal(redactSensitive("a@b.co y 1234567890123456"), "[correo] y [número]");
  assert.equal(redactSensitive("Saldo €148.30 · Apuesta €2.00"), "Saldo €148.30 · Apuesta €2.00", "los importes normales no se tocan");
});

test("compara con el análisis anterior para rellenar «changes»", () => {
  const history = [{ title: "Casino: Gates of Olympus", summary: "x" }];
  assert.match(run("casino", { history }).changes, /^Antes: Casino: Gates of Olympus$/);
  assert.equal(run("casino", { history: [{ title: "Casino: Sweet Bonanza (Pragmatic Play)", summary: "x" }] }).changes, "");
  assert.equal(run("casino").changes, "");
});

test("el texto leído se recorta a un tamaño razonable", () => {
  const many = Array.from({ length: 400 }, (_, i) => L(`linea numero ${i} con bastante texto de relleno`));
  assert.ok(extractContext({ lines: many, confidence: 90 }).text.length <= 2000);
});

test("la frase para el chat nunca queda vacía: si no hay datos, usa el título", () => {
  const footerOnly = extractContext(lines("BALANCE €148.30", "BET €2.00", "WIN €3"), { mode: "casino" });
  assert.equal(footerOnly.category, "casino");
  assert.equal(footerOnly.title, "Casino: juego sin identificar");
  assert.equal(footerOnly.chat_line, "Casino: juego sin identificar");
  assert.equal(footerOnly.summary, "Apuesta €2.00, saldo €148.30, ganancia €3.", "sin el prefijo «juego sin identificar:»");
});

test("la pista del usuario completa lo que la zona no muestra, lo marca y deja constancia", () => {
  const r = extractContext(lines("BALANCE €148.30", "BET €2.00"), { mode: "casino", note: "estoy jugando a Sweet Bonanza de Pragmatic Play" });
  assert.equal(r.title, "Casino: Sweet Bonanza (Pragmatic Play)");
  assert.deepEqual([facts(r).Juego, facts(r).Proveedor], ["Sweet Bonanza", "Pragmatic Play"]);
  assert.equal(facts(r).Pista, "estoy jugando a Sweet Bonanza de Pragmatic Play");
  assert.ok(r.uncertain.some((u) => /tomó de tu pista/.test(u)), "se avisa de que el dato viene de la pista y no de la pantalla");
});

test("si la pantalla y la pista discrepan, manda lo que se lee en la pantalla", () => {
  const r = extractContext(lines("SWEET BONANZA", "BALANCE €10.00", "BET €1.00"), { note: "Gates of Olympus" });
  assert.equal(facts(r).Juego, "Sweet Bonanza");
  assert.equal(facts(r).Pista, "Gates of Olympus");
});

test("una pista sin nombres del catálogo solo se anota, y sin pista no hay entrada «Pista»", () => {
  const withNote = extractContext(lines("BALANCE €10.00", "BET €1.00"), { mode: "casino", note: "mi sesión de la tarde" });
  assert.equal(facts(withNote).Pista, "mi sesión de la tarde");
  assert.ok(!withNote.uncertain.some((u) => /pista/.test(u)));
  assert.ok(!("Pista" in facts(extractContext(lines("BALANCE €10.00", "BET €1.00"), { mode: "casino" }))));
});

test("la pista también se enmascara y se recorta", () => {
  const r = extractContext(lines("BALANCE €10.00", "BET €1.00"), { mode: "casino", note: `escríbeme a yo@correo.com ${"x".repeat(300)}` });
  assert.match(facts(r).Pista, /^escríbeme a \[correo\]/);
  assert.ok(facts(r).Pista.length <= 200);
});
