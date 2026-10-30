import assert from "node:assert/strict";
import { test } from "node:test";
import { createTracker } from "../src/tracker.js";

function setup(options = {}) {
  let t = Date.parse("2026-01-01T12:00:00Z");
  const tracker = createTracker({ now: () => t, ...options });
  return { tracker, advance: (ms) => (t += ms), tick: (s = 10) => (t += s * 1000) };
}

const casino = (over = {}) => ({
  category: "casino", subject: "Sweet Bonanza", title: "Casino: Sweet Bonanza (Pragmatic Play)", language: "es", certainty: 0.9,
  entities: [{ label: "Saldo", value: "€148.30" }, { label: "Apuesta", value: "€2.00" }, { label: "Ganancia", value: "€0.00" }],
  ...over,
});
const withFacts = (base, facts) => ({ ...base, entities: Object.entries(facts).map(([label, value]) => ({ label, value })) });
const feed = (tracker, tick, reading, times = 1) => {
  let last;
  for (let i = 0; i < times; i++) {
    tick();
    last = tracker.ingest(reading);
  }
  return last;
};
const types = (events) => events.map((e) => e.type);

test("una actividad solo se verifica al verse en lecturas seguidas con certeza suficiente", () => {
  const { tracker, tick } = setup();
  const first = tracker.ingest(casino());
  assert.deepEqual([first.verified, first.state, first.confirmations, first.needed], [false, "confirming", 1, 2]);
  assert.deepEqual(first.events, [], "los eventos se retienen hasta verificar");
  tick();
  const second = tracker.ingest(casino());
  assert.deepEqual([second.verified, second.state], [true, "verified"]);
  assert.deepEqual(types(second.events), ["activity_started"]);
  assert.match(second.events[0].text, /^Empieza: Casino: Sweet Bonanza/);
});

test("con certeza baja nunca se verifica, por muchas lecturas que haya; «otro» tampoco", () => {
  const { tracker, tick } = setup();
  const shaky = feed(tracker, tick, casino({ certainty: 0.4 }), 6);
  assert.deepEqual([shaky.verified, shaky.state, shaky.confirmations], [false, "low_certainty", 6]);
  assert.equal(tracker.snapshot().current, null, "en modo verificado no se muestra");
  assert.equal(tracker.snapshot({ onlyVerified: false }).current.verified, false);

  const other = setup();
  assert.equal(feed(other.tracker, other.tick, { category: "other", subject: "", title: "Pantalla", language: "es", certainty: 0.3, entities: [] }, 5).verified, false);
});

test("el umbral de certeza y las lecturas necesarias son configurables", () => {
  const strict = setup({ minCertainty: 0.95, stableFrames: 3 });
  assert.equal(feed(strict.tracker, strict.tick, casino({ certainty: 0.9 }), 5).verified, false);
  const loose = setup({ stableFrames: 1 });
  assert.equal(loose.tracker.ingest(casino()).verified, true);
});

test("una lectura suelta de otra actividad no cambia nada (histéresis); si se repite, sí", () => {
  const { tracker, tick } = setup();
  feed(tracker, tick, casino(), 2);
  const sports = { category: "sports_live", subject: "a vs b", title: "A 1-0 B", language: "es", certainty: 0.9, entities: [] };
  const blip = feed(tracker, tick, sports);
  assert.deepEqual([blip.blip, blip.verified, blip.state, blip.segment.category], [true, false, "switching", "casino"]);
  const back = feed(tracker, tick, casino());
  assert.deepEqual([back.blip, back.verified], [false, true], "volver a la actividad original descarta el parpadeo");

  feed(tracker, tick, sports);
  const switched = feed(tracker, tick, sports);
  assert.equal(switched.segment.category, "sports_live");
  assert.equal(switched.verified, true, "las dos lecturas seguidas ya la confirman");
  assert.equal(tracker.snapshot().recent[0].category, "casino");
  assert.ok(tracker.snapshot().events.some((e) => e.type === "activity_ended" && /^Termina: Casino/.test(e.text)));
});

test("A,B,A,B alternando no cambia nunca de actividad", () => {
  const { tracker, tick } = setup();
  feed(tracker, tick, casino(), 2);
  const other = { category: "video_game", subject: "valorant", title: "Videojuego: Valorant", language: "es", certainty: 0.9, entities: [] };
  for (let i = 0; i < 4; i++) {
    feed(tracker, tick, other);
    assert.equal(feed(tracker, tick, casino()).segment.category, "casino");
  }
});

test("«otro» con títulos distintos cuenta como una sola actividad: se sale de la anterior y no se sigue exportando", () => {
  const { tracker, tick } = setup();
  feed(tracker, tick, casino(), 2);
  assert.ok(tracker.snapshot().current);
  const mk = (title) => ({ category: "other", subject: title, title, language: "es", certainty: 0.3, entities: [] });
  feed(tracker, tick, mk("Bienvenido a la tienda"));
  const left = feed(tracker, tick, mk("Ofertas de la semana"));
  assert.equal(left.segment.category, "other");
  assert.equal(tracker.snapshot().current, null, "ya no se da por actual el casino");
});

test("el saldo: el cambio solo se anuncia cuando el valor nuevo se confirma; un error del OCR no inventa eventos", () => {
  const { tracker, tick } = setup();
  const at = (saldo) => withFacts(casino(), { Saldo: saldo, Apuesta: "€2.00", Ganancia: "€0.00" });
  feed(tracker, tick, at("€148.30"), 2);
  const glitch = feed(tracker, tick, at("€748.30"));
  assert.deepEqual(glitch.events, [], "una lectura rara aislada no es un evento");
  feed(tracker, tick, at("€148.30"));
  const changed1 = feed(tracker, tick, at("€140.30"));
  assert.deepEqual(changed1.events, [], "primera lectura del valor nuevo: aún no");
  const changed2 = feed(tracker, tick, at("€140.30"));
  assert.deepEqual(types(changed2.events), ["balance_changed"]);
  assert.equal(changed2.events[0].text, "Saldo: €148.30 → €140.30 (−€8.00)");
  assert.deepEqual([changed2.events[0].detail.delta, changed2.events[0].detail.currency], [-8, "EUR"]);
  assert.deepEqual([changed2.segment.stats.balanceStart, changed2.segment.stats.balanceNow, changed2.segment.stats.net], [148.3, 140.3, -8]);
});

test("las ganancias: una ya visible al empezar no es evento; los cambios sí, y las grandes se distinguen", () => {
  const { tracker, tick } = setup();
  const at = (win) => withFacts(casino(), { Saldo: "€100.00", Apuesta: "€2.00", Ganancia: win });
  const start = feed(tracker, tick, at("€5.00"), 2);
  assert.ok(!types(start.events).includes("win"), "la ganancia del arranque puede ser de la jugada anterior");
  assert.equal(start.segment.stats.biggestWin, 5);
  const win = feed(tracker, tick, at("€8.00"), 2);
  assert.deepEqual(types(win.events), ["win"]);
  assert.equal(win.events[0].text, "Ganancia: €8.00");
  feed(tracker, tick, at("€0.00"), 2);
  const big = feed(tracker, tick, at("€36.50"), 2);
  assert.deepEqual(types(big.events), ["big_win"]);
  assert.equal(big.events[0].text, "Gran ganancia: €36.50 (18.25 veces la apuesta)");
  assert.equal(big.segment.stats.biggestWin, 36.5);
});

test("giros gratis: ya visibles al empezar son línea base; que aparezcan después es un evento", () => {
  const atStart = setup();
  const started = feed(atStart.tracker, atStart.tick, withFacts(casino(), { Saldo: "€100.00", Apuesta: "€2.00", "Giros gratis": "8" }), 3);
  assert.ok(!types(started.events).includes("free_spins"));

  const later = setup();
  feed(later.tracker, later.tick, withFacts(casino(), { Saldo: "€100.00", Apuesta: "€2.00" }), 4);
  const bonus = feed(later.tracker, later.tick, withFacts(casino(), { Saldo: "€100.00", Apuesta: "€2.00", "Giros gratis": "10" }), 2);
  assert.deepEqual(types(bonus.events), ["free_spins"]);
  assert.equal(bonus.events[0].text, "Giros gratis: 10");
});

test("fútbol: el gol se atribuye al equipo que subió, con el marcador anterior y el nuevo", () => {
  const { tracker, tick } = setup();
  const match = (score) => ({ category: "sports_betting", subject: "real madrid vs manchester city", title: `Real Madrid ${score} Manchester City`, language: "es", certainty: 0.9, entities: [{ label: "Partido", value: "Real Madrid vs Manchester City" }, { label: "Marcador", value: score }] });
  feed(tracker, tick, match("1-1"), 2);
  const home = feed(tracker, tick, match("2-1"), 2);
  assert.equal(home.events[0].text, "Gol de Real Madrid: 1-1 → 2-1");
  const away = feed(tracker, tick, match("2-2"), 2);
  assert.equal(away.events[0].text, "Gol de Manchester City: 2-1 → 2-2");
  assert.equal(away.segment.stats.scoreChanges, 2);
  assert.equal(away.segment.stats.score, "2-2");
});

test("videojuego: rondas y kills/muertes confirmados", () => {
  const { tracker, tick } = setup();
  const g = (round, kills) => ({ category: "video_game", subject: "Valorant", title: "Videojuego: Valorant", language: "es", certainty: 0.9, entities: [{ label: "Ronda", value: String(round) }, { label: "Kills", value: String(kills) }, { label: "Deaths", value: "3" }] });
  feed(tracker, tick, g(13, 17), 2);
  const next = feed(tracker, tick, g(14, 18), 2);
  assert.deepEqual(types(next.events).sort(), ["kills_changed", "round_changed"]);
  assert.ok(next.events.some((e) => e.text === "Kills: 17 → 18 (+1)"));
  assert.deepEqual([next.segment.stats.kills, next.segment.stats.deaths], [18, 3]);
});

test("trading: solo movimientos de precio relevantes (≥ 0,5 %)", () => {
  const { tracker, tick } = setup();
  const p = (price) => ({ category: "trading", subject: "BTC/USDT", title: "Trading: BTC/USDT 1h", language: "es", certainty: 0.9, entities: [{ label: "Precio", value: price }] });
  feed(tracker, tick, p("67,420.50 (+2.35%)"), 2);
  assert.deepEqual(feed(tracker, tick, p("67,450.00"), 2).events, [], "+0,04 %: ruido");
  const move = feed(tracker, tick, p("67,900.00"), 2);
  assert.deepEqual(types(move.events), ["price_moved"]);
  assert.match(move.events[0].text, /Precio: 67,450 → 67,900 \(\+0\.67%\)/);
  assert.deepEqual([move.segment.stats.priceStart, move.segment.stats.priceNow], [67420.5, 67900]);
});

test("programación: error que aparece y error que se resuelve; terminal: comando y resultado", () => {
  const { tracker, tick } = setup();
  const c = (error) => ({ category: "coding", subject: "main.js", title: "Programando: main.js", language: "es", certainty: 0.9, entities: error ? [{ label: "Error", value: error }] : [] });
  feed(tracker, tick, c(null), 2);
  const seen = feed(tracker, tick, c("TypeError: Cannot read properties of undefined"), 2);
  assert.deepEqual(types(seen.events), ["error_seen"]);
  const fixed = feed(tracker, tick, c(null), 2);
  assert.deepEqual(types(fixed.events), ["error_cleared"]);
  assert.equal(fixed.events[0].text, "Error resuelto");

  const term = setup();
  const k = (command, result) => ({ category: "terminal", subject: "terminal", title: "Terminal", language: "es", certainty: 0.9, entities: [{ label: "Comando", value: command }, { label: "Resultado", value: result }] });
  feed(term.tracker, term.tick, k("npm test", "10 pruebas: 10 pasan, 0 fallan"), 2);
  const ran = feed(term.tracker, term.tick, k("npm test", "10 pruebas: 8 pasan, 2 fallan"), 2);
  assert.deepEqual(types(ran.events), ["tests_result"]);
});

test("los eventos de una actividad sin verificar se retienen y nunca salen", () => {
  const { tracker, tick } = setup();
  const r = casino({ certainty: 0.4 });
  const out = [];
  for (let i = 0; i < 6; i++) out.push(...feed(tracker, tick, withFacts(r, { Saldo: `€${100 - i * 10}.00`, Apuesta: "€2.00" })).events);
  assert.deepEqual(out, []);
  assert.deepEqual(tracker.snapshot({ onlyVerified: false }).events, []);
});

test("una actividad ya verificada no se «desverifica» por una lectura mala; esa lectura sí queda sin exportar", () => {
  const { tracker, tick } = setup();
  feed(tracker, tick, casino(), 2);
  const bad = feed(tracker, tick, casino({ certainty: 0.3 }));
  assert.deepEqual([bad.verified, bad.state], [false, "low_certainty"]);
  assert.equal(tracker.snapshot().current.verified, true, "la actividad sigue establecida");
  assert.equal(feed(tracker, tick, casino()).verified, true);
});

test("pasado el tiempo sin lecturas la actividad termina y no se sigue dando por actual", () => {
  const { tracker, tick, advance } = setup({ maxGapMs: 300_000 });
  feed(tracker, tick, casino(), 2);
  assert.ok(tracker.snapshot().current);
  advance(301_000);
  const snap = tracker.snapshot();
  assert.equal(snap.current, null);
  assert.equal(snap.recent.length, 1);
  assert.ok(snap.events.some((e) => e.type === "activity_ended" && e.detail.reason === "gap"));
  const fresh = feed(tracker, tick, casino());
  assert.equal(fresh.confirmations, 1, "una actividad nueva empieza de cero");
});

test("resumen de la actividad: duración, lecturas, datos y candidato mientras se confirma", () => {
  const { tracker, tick } = setup();
  const first = feed(tracker, tick, casino());
  const snap1 = tracker.snapshot();
  assert.equal(snap1.current, null);
  assert.deepEqual(snap1.candidate, { title: "Casino: Sweet Bonanza (Pragmatic Play)", category: "casino", certainty: 0.9, confirmations: 1, needed: 2 });
  feed(tracker, tick, casino(), 5);
  const { current, candidate } = tracker.snapshot();
  assert.equal(candidate, null);
  assert.deepEqual([current.readings, current.confirmations, current.verified, current.durationSec], [6, 6, true, 50]);
  assert.equal(current.since, new Date(Date.parse("2026-01-01T12:00:10Z")).toISOString());
  assert.equal(current.facts.Saldo, "€148.30");
  assert.ok(first.segment.id === current.id);
});

test("los avisos salen en el idioma de la lectura", () => {
  const { tracker, tick } = setup();
  const en = (saldo) => withFacts(casino({ language: "en", title: "Casino: Sweet Bonanza" }), { Balance: saldo, Bet: "€2.00" });
  feed(tracker, tick, en("€148.30"), 2);
  const changed = feed(tracker, tick, en("€140.30"), 2);
  assert.equal(changed.events[0].text, "Balance: €148.30 → €140.30 (−€8.00)");
  assert.match(tracker.snapshot().events[0].text, /^Started: /);
});

test("chat, correo y reunión: hay actividad y duración pero ningún evento de contenido", () => {
  const { tracker, tick } = setup();
  const chat = (n) => ({ category: "chat", subject: "discord general", title: "Chat: Discord #general", language: "es", certainty: 0.8, entities: [{ label: "App", value: "Discord" }, { label: "Canal", value: `#general${n}` }] });
  feed(tracker, tick, chat(1), 2);
  const more = feed(tracker, tick, chat(2), 2);
  assert.deepEqual(more.events, []);
  assert.deepEqual(tracker.snapshot().events.map((e) => e.type), ["activity_started"]);
});
