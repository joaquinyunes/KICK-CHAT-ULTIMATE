import { formatDelta, parseAmount } from "./ocr/amounts.js";
import { labels } from "./ocr/labels.js";
import { normalizeText } from "./ocr/knowledge.js";

// Seguimiento de la actividad en el tiempo. Convierte lecturas sueltas en «lo que estás haciendo y desde cuándo».
//
//  · VERIFICACIÓN: una actividad se da por verificada solo si la certeza de la lectura llega al mínimo Y se ha visto
//    en `stableFrames` lecturas seguidas. Un fotograma de transición o un error puntual del OCR no se exporta como verdad.
//  · HISTÉRESIS: no se cambia de actividad por una lectura suelta; la nueva tiene que repetirse `switchFrames` veces.
//  · EVENTOS FIABLES: un cambio de saldo, un gol o un error nuevo solo se anuncia cuando el valor nuevo se ve en lecturas
//    consecutivas. Si el OCR lee «€748.30» por «€148.30» una vez, no se inventa una ganancia de 600 €.
//  · Los eventos de una actividad se retienen hasta que esa actividad queda verificada.

const TEXT = {
  es: {
    started: (title) => `Empieza: ${title}`,
    ended: (title, min) => `Termina: ${title} (${min})`,
    balance: (from, to, delta) => `Saldo: ${from} → ${to} (${delta})`,
    bet: (from, to) => `Apuesta: ${from} → ${to}`,
    win: (amount) => `Ganancia: ${amount}`,
    bigWin: (amount, times) => `Gran ganancia: ${amount} (${times} veces la apuesta)`,
    spins: (n) => `Giros gratis: ${n}`,
    goal: (team, from, to) => `Gol${team ? ` de ${team}` : ""}: ${from} → ${to}`,
    score: (from, to) => `Marcador: ${from} → ${to}`,
    round: (from, to) => `Ronda ${from} → ${to}`,
    stat: (label, from, to) => `${label}: ${from} → ${to} (${to - from > 0 ? "+" : ""}${to - from})`,
    price: (from, to, pct) => `Precio: ${from} → ${to} (${pct})`,
    error: (e) => `Error a la vista: ${e}`,
    cleared: () => "Error resuelto",
    command: (c) => `Comando: ${c}`,
    result: (r) => `Resultado: ${r}`,
    page: (p) => `Página: ${p}`,
    min: (m) => `${m} min`,
    sec: (s) => `${s} s`,
  },
  en: {
    started: (title) => `Started: ${title}`,
    ended: (title, min) => `Ended: ${title} (${min})`,
    balance: (from, to, delta) => `Balance: ${from} → ${to} (${delta})`,
    bet: (from, to) => `Bet: ${from} → ${to}`,
    win: (amount) => `Win: ${amount}`,
    bigWin: (amount, times) => `Big win: ${amount} (${times}x the bet)`,
    spins: (n) => `Free spins: ${n}`,
    goal: (team, from, to) => `Goal${team ? ` for ${team}` : ""}: ${from} → ${to}`,
    score: (from, to) => `Score: ${from} → ${to}`,
    round: (from, to) => `Round ${from} → ${to}`,
    stat: (label, from, to) => `${label}: ${from} → ${to} (${to - from > 0 ? "+" : ""}${to - from})`,
    price: (from, to, pct) => `Price: ${from} → ${to} (${pct})`,
    error: (e) => `Error in view: ${e}`,
    cleared: () => "Error resolved",
    command: (c) => `Command: ${c}`,
    result: (r) => `Result: ${r}`,
    page: (p) => `Page: ${p}`,
    min: (m) => `${m} min`,
    sec: (s) => `${s} s`,
  },
};
const tx = (language) => TEXT[language] ?? TEXT.es;

const BIG_WIN_TIMES = 10;
const PRICE_MOVE = 0.005; // 0,5 %
const round2 = (n) => Math.round(n * 100) / 100;
const money = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const duration = (language, ms) => (ms < 90_000 ? tx(language).sec(Math.round(ms / 1000)) : tx(language).min(Math.round(ms / 60_000)));

// Un valor solo «cuenta» cuando se ve `need` veces seguidas; el primero fija la base sin generar evento.
class Field {
  constructor(need) {
    this.need = need;
    this.stable = undefined;
    this.candidate = undefined;
    this.count = 0;
  }

  // Devuelve { from, to } cuando el cambio queda confirmado; { to } al fijar el primer valor; null si no hay novedad.
  update(value) {
    if (value === null || value === undefined) return null;
    if (this.stable !== undefined && value === this.stable) {
      this.candidate = undefined;
      this.count = 0;
      return null;
    }
    this.count = value === this.candidate ? this.count + 1 : 1;
    this.candidate = value;
    if (this.count < this.need) return null;
    const from = this.stable;
    this.stable = value;
    this.candidate = undefined;
    this.count = 0;
    return from === undefined ? { to: value } : { from, to: value };
  }
}

const numberOf = (text) => {
  const a = parseAmount(text);
  return a ? round2(a.value) : null;
};
const priceOf = (text) => {
  const m = /\d[\d,]*(?:\.\d+)?/.exec(String(text ?? ""));
  return m ? Number(m[0].replace(/,/g, "")) : null;
};

export function createTracker({ now = () => Date.now(), stableFrames = 2, minCertainty = 0.5, switchFrames = 2, maxGapMs = 5 * 60_000, maxEvents = 200, maxSegments = 30 } = {}) {
  let current = null;
  let pending = null; // actividad distinta que aún no se ha repetido lo bastante
  const finished = [];
  const log = []; // eventos liberados (de actividades verificadas)
  let nextId = 1;

  // Todas las lecturas «otro» son la misma «actividad»: su título cambia en cada lectura y, si cada una fuese distinta,
  // nunca se repetiría y se seguiría dando por actual una actividad anterior mientras estás en una app desconocida.
  const keyOf = (r) => (r.category === "other" ? "other|" : `${r.category}|${normalizeText(r.subject || r.title || "")}`);

  function newSegment(r, confirmations) {
    const at = now();
    return {
      id: nextId++,
      key: keyOf(r),
      category: r.category,
      subject: r.subject,
      title: r.title,
      language: r.language ?? "es",
      since: at,
      last: at,
      readings: 1,
      confirmations,
      verified: false,
      certainty: r.certainty,
      facts: {},
      fields: new Map(),
      stats: {},
      events: [],
      released: 0,
    };
  }

  const fmt = (n, currency) => formatDelta(n, currency).replace(/^[+−]/, "");

  const field = (seg, name) => {
    if (!seg.fields.has(name)) seg.fields.set(name, new Field(stableFrames));
    return seg.fields.get(name);
  };

  function emit(seg, type, text, detail = {}) {
    seg.events.push({ at: now(), type, text, detail });
  }

  // Compara la lectura con los valores ya estables de la actividad y registra los eventos confirmados.
  function observe(seg, r) {
    const t = tx(seg.language);
    const e = labels(seg.language).e;
    const facts = Object.fromEntries(r.entities.map((x) => [x.label, x.value]));
    seg.facts = facts;
    seg.title = r.title;

    if (seg.category === "casino") {
      const bet = numberOf(facts[e.bet]);
      const balanceText = facts[e.balance];
      const balance = numberOf(balanceText);
      const currency = parseAmount(balanceText)?.currency ?? parseAmount(facts[e.bet])?.currency ?? null;
      const b = field(seg, "balance").update(balance);
      if (b) {
        seg.stats.balanceStart ??= b.from ?? b.to;
        if (b.from !== undefined) emit(seg, "balance_changed", t.balance(fmt(b.from, currency), fmt(b.to, currency), formatDelta(round2(b.to - b.from), currency)), { from: b.from, to: b.to, delta: round2(b.to - b.from), currency });
      }
      if (field(seg, "balance").stable !== undefined) {
        seg.stats.balanceNow = field(seg, "balance").stable;
        seg.stats.net = round2(seg.stats.balanceNow - seg.stats.balanceStart);
        seg.stats.currency = currency;
      }
      const bt = field(seg, "bet").update(bet);
      if (bt?.from !== undefined) emit(seg, "bet_changed", t.bet(fmt(bt.from, currency), fmt(bt.to, currency)), { from: bt.from, to: bt.to });
      const w = field(seg, "win").update(numberOf(facts[e.win]));
      if (w && w.to > (seg.stats.biggestWin ?? 0)) seg.stats.biggestWin = w.to;
      // Una ganancia ya visible al empezar no es un evento (puede ser de la jugada anterior): solo un cambio confirmado.
      if (w?.from !== undefined && w.to > 0) {
        const times = field(seg, "bet").stable > 0 ? round2(w.to / field(seg, "bet").stable) : null;
        if (times !== null && times >= BIG_WIN_TIMES) emit(seg, "big_win", t.bigWin(fmt(w.to, currency), times), { amount: w.to, times });
        else emit(seg, "win", t.win(fmt(w.to, currency)), { amount: w.to });
      }
      // Los giros gratis ya visibles al empezar son línea base; solo es un evento que aparezcan después.
      const sp = field(seg, "spins").update(facts[e.spins] ?? null);
      if (sp && sp.from === undefined && seg.readings > stableFrames) emit(seg, "free_spins", t.spins(sp.to), { spins: sp.to });
    } else if (seg.category === "sports_betting" || seg.category === "sports_live") {
      const sc = field(seg, "score").update(facts[e.score] ?? null);
      seg.stats.score = field(seg, "score").stable ?? seg.stats.score;
      if (sc?.from !== undefined) {
        const [h0, a0] = sc.from.split("-").map(Number);
        const [h1, a1] = sc.to.split("-").map(Number);
        const [home, away] = String(facts[e.match] ?? "").split(" vs ");
        const team = h1 > h0 && a1 === a0 ? home : a1 > a0 && h1 === h0 ? away : null;
        emit(seg, "score_changed", t.goal(team, sc.from, sc.to), { from: sc.from, to: sc.to, team: team ?? null });
        seg.stats.scoreChanges = (seg.stats.scoreChanges ?? 0) + 1;
      }
    } else if (seg.category === "video_game") {
      const rd = field(seg, "round").update(numberOf(facts[e.round]));
      if (rd?.from !== undefined) emit(seg, "round_changed", t.round(rd.from, rd.to), { from: rd.from, to: rd.to });
      for (const key of ["Kills", "Deaths"]) {
        const f = field(seg, key).update(numberOf(facts[key]));
        if (f?.from !== undefined && f.to > f.from) emit(seg, `${key.toLowerCase()}_changed`, t.stat(key, f.from, f.to), { from: f.from, to: f.to });
        const value = field(seg, key).stable;
        if (value !== undefined) seg.stats[key.toLowerCase()] = value;
      }
    } else if (seg.category === "trading") {
      const p = field(seg, "price").update(priceOf(facts[e.price]));
      const stable = field(seg, "price").stable;
      if (stable !== undefined) {
        seg.stats.priceStart ??= p?.from ?? stable;
        seg.stats.priceNow = stable;
      }
      if (p?.from !== undefined && Math.abs(p.to - p.from) / p.from >= PRICE_MOVE) {
        const pct = `${p.to > p.from ? "+" : ""}${(((p.to - p.from) / p.from) * 100).toFixed(2)}%`;
        emit(seg, "price_moved", t.price(money(p.from), money(p.to), pct), { from: p.from, to: p.to });
      }
    } else if (seg.category === "coding") {
      // «Sin error» también es un valor: así se detecta cuándo desaparece.
      const err = field(seg, "error").update(facts[e.error] ? normalizeText(facts[e.error]).slice(0, 60) : "");
      if (err && err.to !== "") emit(seg, "error_seen", t.error(String(facts[e.error]).slice(0, 80)), { error: facts[e.error] });
      else if (err?.from) emit(seg, "error_cleared", t.cleared(), {});
    } else if (seg.category === "terminal") {
      const c = field(seg, "command").update(facts[e.command] ?? null);
      if (c?.from !== undefined) emit(seg, "command_run", t.command(c.to), { command: c.to });
      const res = field(seg, "result").update(facts[e.result] ?? null);
      if (res?.from !== undefined) emit(seg, "tests_result", t.result(res.to), { result: res.to });
    } else if (seg.category === "browsing") {
      const pg = field(seg, "page").update(facts[e.page] ? normalizeText(facts[e.page]) : null);
      if (pg?.from !== undefined) emit(seg, "page_changed", t.page(facts[e.page]), { page: facts[e.page] });
    }
  }

  function endCurrent(reason) {
    if (!current) return;
    const seg = current;
    if (seg.verified) {
      emit(seg, "activity_ended", tx(seg.language).ended(seg.title, duration(seg.language, seg.last - seg.since)), { reason, durationMs: seg.last - seg.since });
      release(seg);
      finished.push(seg);
      if (finished.length > maxSegments) finished.shift();
    }
    current = null;
  }

  // Los eventos de una actividad solo salen cuando esa actividad está verificada.
  function release(seg) {
    const out = seg.events.slice(seg.released);
    seg.released = seg.events.length;
    for (const ev of out) log.push({ ...ev, segment: seg.id, category: seg.category, subject: seg.subject });
    while (log.length > maxEvents) log.shift();
    return out.map((ev) => ({ ...ev, segment: seg.id, category: seg.category }));
  }

  function closeIfStale() {
    if (current && now() - current.last > maxGapMs) endCurrent("gap");
    if (pending && now() - pending.last > maxGapMs) pending = null;
  }

  function summarize(seg) {
    return {
      id: seg.id,
      category: seg.category,
      subject: seg.subject,
      title: seg.title,
      since: new Date(seg.since).toISOString(),
      last: new Date(seg.last).toISOString(),
      durationSec: Math.round((seg.last - seg.since) / 1000),
      readings: seg.readings,
      confirmations: seg.confirmations,
      verified: seg.verified,
      certainty: seg.certainty,
      facts: seg.facts,
      stats: { ...seg.stats },
      events: seg.events.slice(-20).map((ev) => ({ at: new Date(ev.at).toISOString(), type: ev.type, text: ev.text, detail: ev.detail })),
    };
  }

  return {
    // Procesa una lectura. Devuelve su estado de verificación y los eventos que se liberan con ella.
    ingest(reading) {
      closeIfStale();
      const key = keyOf(reading);
      let blip = false;

      if (!current) {
        current = newSegment(reading, 1);
        emit(current, "activity_started", tx(current.language).started(reading.title), { category: reading.category });
      } else if (key === current.key) {
        current.confirmations += 1;
        current.readings += 1;
        current.last = now();
        current.certainty = reading.certainty;
        pending = null;
      } else {
        // Otra actividad: no se cambia por una lectura suelta, tiene que repetirse.
        pending = pending?.key === key ? { ...pending, count: pending.count + 1, last: now(), reading } : { key, count: 1, last: now(), reading };
        if (pending.count >= switchFrames) {
          endCurrent("changed");
          current = newSegment(pending.reading, pending.count);
          emit(current, "activity_started", tx(current.language).started(pending.reading.title), { category: pending.reading.category });
          reading = pending.reading;
          pending = null;
        } else blip = true;
      }

      if (blip) {
        // Una lectura suelta de otra actividad no toca el estado de la actual ni se exporta como verificada.
        return { verified: false, blip: true, confirmations: current.confirmations, needed: stableFrames, minCertainty, certainty: reading.certainty, state: "switching", segment: summarize(current), events: [] };
      }

      observe(current, reading);
      // La actividad queda ESTABLECIDA al verse en lecturas seguidas con certeza suficiente, y ya no se «desestablece»
      // por una lectura mala suelta. Cada lectura, en cambio, solo se exporta si ella misma tiene certeza suficiente.
      const sure = reading.certainty >= minCertainty && reading.category !== "other";
      if (current.confirmations >= stableFrames && sure) current.verified = true;
      const readingVerified = current.verified && sure;
      const released = current.verified ? release(current) : [];
      return {
        verified: readingVerified,
        blip: false,
        confirmations: current.confirmations,
        needed: stableFrames,
        minCertainty,
        certainty: reading.certainty,
        state: readingVerified ? "verified" : !sure ? "low_certainty" : "confirming",
        segment: summarize(current),
        events: released,
      };
    },

    // Estado de la sesión: la actividad actual, las últimas ya terminadas y los eventos recientes.
    snapshot({ onlyVerified = true } = {}) {
      closeIfStale();
      const show = (seg) => !onlyVerified || seg.verified;
      return {
        current: current && show(current) ? summarize(current) : null,
        candidate: current && !current.verified ? { title: current.title, category: current.category, certainty: current.certainty, confirmations: current.confirmations, needed: stableFrames } : null,
        recent: finished.slice(-10).reverse().map(summarize),
        events: log.slice(-50).map((ev) => ({ at: new Date(ev.at).toISOString(), type: ev.type, text: ev.text, detail: ev.detail, category: ev.category })),
        updatedAt: current ? new Date(current.last).toISOString() : null,
      };
    },

    endCurrent,
    config: { stableFrames, minCertainty, switchFrames, maxGapMs },
  };
}
