import { normalizeText } from "./knowledge.js";
import { best } from "./classify.js";
import { labels } from "./labels.js";
import { languageOf } from "./signals.js";

// Redacta el contexto de cada actividad: título, resumen, datos clave, frase para el chat y el «sujeto»
// (la identidad estable de lo que se hace, que el seguimiento usa para saber si sigues en lo mismo).

const join = (parts) => parts.filter(Boolean).join(" · ");
const up = (s) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s);

// Texto más grande de la pantalla que parezca un nombre o un titular. Si el titular se parte en varias líneas
// («…del slot de Pragmatic» / «Play»), se unen las contiguas del mismo tamaño.
function headline(lines, { minWords = 2, maxWords = 4, zone = null } = {}) {
  const isLabel = (norm) => /\b(?:balance|saldo|bet|apuesta|win|ganancia)\b/.test(norm) || /^(?:menu|home|inicio|play|settings|spin|auto|buy)\b/.test(norm);
  const words = (l) => l.text.split(" ").length;
  const first =
    lines
      .filter((l) => l.confidence >= 70 && l.height > 0 && (!zone || l.zone === zone) && words(l) >= minWords && words(l) <= maxWords && /^[\p{L}\p{N}' :&.,¿?¡!-]+$/u.test(l.text) && !isLabel(l.norm))
      .sort((a, b) => b.height - a.height)[0] ?? null;
  if (!first?.bbox) return first;
  let text = first.text;
  let last = first;
  for (let i = lines.indexOf(first) + 1; i < lines.length && i <= lines.indexOf(first) + 2; i++) {
    const next = lines[i];
    const sameSize = next.bbox && Math.abs(next.height - first.height) <= 0.15 * first.height;
    if (!sameSize || next.bbox.y0 - last.bbox.y1 > 0.8 * first.height || !/^[\p{L}\p{N}' :&.,¿?¡!-]+$/u.test(next.text)) break;
    text += ` ${next.text}`;
    last = next;
  }
  return { ...first, text };
}

const firstLines = (lines, n, t) => `${t.detected}: ${lines.slice(0, n).map((l) => l.text).join(" · ")}`;

// ctx: { category, signals, matches, lines, language, hint }
// devuelve { title, summary, activity, entities, chat, subject, notes }
export function describe(ctx) {
  const { category, signals: s, matches, lines, language } = ctx;
  const t = labels(language);
  const entities = [];
  const put = (label, value) => value && entities.push({ label, value: String(value) });
  const notes = [];
  const out = { title: t.cat[category], summary: "", activity: "", chat: "", subject: "" };

  const slot = best(matches, "slots") ?? best(matches, "liveGames");
  const provider = best(matches, "providers");
  const site = best(matches, "sites");
  const league = best(matches, "leagues");
  const game = best(matches, "games");
  const platform = best(matches, "platforms");
  const teams = matches.filter((m) => m.type === "teams");
  const appOf = (cat) => matches.filter((m) => m.type === "apps" && m.category === cat && !m.fromHint).sort((a, b) => (a.zone === "top" ? 0 : 1) - (b.zone === "top" ? 0 : 1))[0] ?? null;
  const topUrl = s.urls.find((u) => u.zone === "top") ?? s.urls[0] ?? null;
  const body = lines.filter((l) => l.zone !== "top");

  switch (category) {
    case "casino": {
      let name = slot?.name;
      if (!name) {
        const guess = headline(lines);
        if (guess) {
          name = guess.text;
          notes.push(t.note.deduced);
        }
      }
      const { balance, bet, win } = s.amounts;
      put(t.e.game, name);
      put(t.e.provider, provider?.name);
      put(t.e.site, site?.name ?? (topUrl && topUrl.zone === "top" ? topUrl.host : null));
      put(t.e.bet, bet);
      put(t.e.balance, balance);
      put(t.e.win, win);
      put(t.e.spins, s.spins);
      put(t.e.multiplier, s.multiplier);
      out.title = `${t.cat.casino}: ${name ?? t.unknownGame}${provider ? ` (${provider.name})` : ""}`;
      const bits = [bet && `${t.e.bet.toLowerCase()} ${bet}`, balance && `${t.e.balance.toLowerCase()} ${balance}`, win && `${t.e.win.toLowerCase()} ${win}`, s.spins && `${t.e.spins.toLowerCase()} ${s.spins}`, s.multiplier && `${t.e.multiplier.toLowerCase()} ${s.multiplier}`].filter(Boolean);
      const sentence = bits.join(", ");
      out.summary = bits.length ? (name ? `${name}: ${sentence}.` : `${up(sentence)}.`) : firstLines(lines, 3, t);
      out.activity = s.spins ? t.e.spins.toLowerCase() : "";
      out.chat = join([name, s.spins && `${t.e.spins.toLowerCase()} ${s.spins}`, s.multiplier]);
      out.subject = name ?? "casino";
      break;
    }
    case "sports_betting":
    case "sports_live": {
      const home = s.scoreLine?.home ?? teams[0]?.name;
      const away = s.scoreLine?.away ?? teams[1]?.name;
      const matchName = home && away ? `${home} vs ${away}` : null;
      put(t.e.match, matchName);
      put(t.e.score, s.scoreLine?.score);
      put(t.e.clock, s.clock);
      put(t.e.league, league?.name);
      put(t.e.site, site?.name ?? (topUrl?.zone === "top" ? topUrl.host : null));
      const odds = s.odds.map((o) => (o.label ? `${o.label} ${o.value}` : o.value));
      put(t.e.odds, odds.join(" · "));
      put(t.e.bet, s.amounts.bet);
      const live = s.live || Boolean(s.clock);
      out.activity = live ? t.live.toLowerCase() : "";
      out.title = s.scoreLine ? `${home} ${s.scoreLine.score} ${away}` : (matchName ?? `${t.cat[category]}${league ? `: ${league.name}` : ""}`);
      out.summary = join([live ? `${t.live}${s.clock ? ` (${s.clock})` : ""}` : null, league?.name, site?.name, odds.length ? `${t.e.odds.toLowerCase()} ${odds.join(", ")}` : null]) || firstLines(lines, 3, t);
      out.chat = join([s.scoreLine ? `${home} ${s.scoreLine.score} ${away}` : matchName, s.clock, league?.name]);
      out.subject = matchName ? normalizeText(matchName) : "sports";
      break;
    }
    case "video_game": {
      const name = game?.name ?? headline(lines)?.text;
      put(t.e.game, game?.name);
      for (const h of s.hud) put(h.split(" ")[0], h.split(" ").slice(1).join(" "));
      put(t.e.round, s.round);
      out.title = `${t.cat.video_game}: ${name ?? t.unknownGame}`;
      out.summary = join([game?.name, s.round && `${t.e.round} ${s.round}`, s.hud.join(", ")]) || firstLines(lines, 3, t);
      out.chat = join([game?.name, s.round && `${t.e.round} ${s.round}`]);
      out.subject = name ?? "game";
      break;
    }
    case "trading": {
      put(t.e.pair, s.pair);
      put(t.e.timeframe, s.timeframe);
      put(t.e.price, s.price);
      put(t.e.site, site?.name ?? platform?.name ?? (topUrl?.zone === "top" ? topUrl.host : null));
      for (const k of ["RSI", "MACD", "MA(50)"]) {
        const m = new RegExp(`${k.replace(/[()]/g, "\\$&")}\\s*:?\\s*(-?\\d[\\d.,]*)`, "i").exec(s.joined);
        if (m) put(m[0].split(/\s+/)[0].toUpperCase(), m[1]);
      }
      out.title = `${t.cat.trading}: ${[s.pair, s.timeframe].filter(Boolean).join(" ") || t.unknownGame}`;
      out.summary = join([s.pair, s.price && `${t.e.price.toLowerCase()} ${s.price}`, s.timeframe]) || firstLines(lines, 3, t);
      out.chat = join([s.pair, s.price]);
      out.subject = s.pair ?? "trading";
      break;
    }
    case "streaming": {
      const app = appOf("streaming");
      put(t.e.platform, platform?.name ?? app?.name);
      put(t.e.streamer, s.stream.streamer);
      put(t.e.section, s.stream.category);
      put(t.e.viewers, s.stream.viewers);
      const where = platform?.name ?? app?.name;
      out.title = `${t.cat.streaming}${where ? ` en ${where}` : ""}${s.stream.streamer ? `: ${s.stream.streamer}` : ""}`;
      if (language === "en") out.title = `${t.cat.streaming}${where ? ` on ${where}` : ""}${s.stream.streamer ? `: ${s.stream.streamer}` : ""}`;
      out.summary = join([s.stream.category, s.stream.viewers && `${s.stream.viewers} ${t.e.viewers.toLowerCase()}`]) || firstLines(lines, 3, t);
      out.activity = t.act.stream;
      out.chat = join([s.stream.streamer, where, s.stream.category]);
      out.subject = normalizeText(`${where ?? ""} ${s.stream.streamer ?? ""}`) || "stream";
      break;
    }
    case "video_media": {
      const app = appOf("video_media");
      const titleLine = headline(body.filter((l) => !/\d:\d{2}/.test(l.text)), { minWords: 3, maxWords: 16 });
      put(t.e.platform, app?.name);
      put(t.e.page, titleLine?.text);
      put(t.e.progress, s.player.time && `${s.player.time.current} / ${s.player.time.total}`);
      put(t.e.views, s.player.views);
      out.title = titleLine ? `${t.cat.video_media}: ${titleLine.text}` : `${t.cat.video_media}${app ? ` (${app.name})` : ""}`;
      out.summary = join([app?.name, s.player.time && `${s.player.time.current} / ${s.player.time.total}`, s.player.views && `${s.player.views} ${t.e.views.toLowerCase()}`]) || firstLines(lines, 3, t);
      out.activity = t.act.video;
      out.chat = join([titleLine?.text, app?.name]);
      out.subject = normalizeText(titleLine?.text ?? app?.name ?? "video");
      break;
    }
    case "coding": {
      const app = appOf("coding");
      const file = s.editorTitle?.file ?? s.files.code[0]?.name;
      const language = languageOf(file) ?? s.files.code[0]?.language;
      put(t.e.app, s.editorTitle?.app ?? app?.name);
      put(t.e.file, file);
      put(t.e.language, language);
      put(t.e.project, s.editorTitle?.project);
      put(t.e.error, s.errors.error?.slice(0, 120));
      if (s.terminal.command) put(t.e.command, s.terminal.command);
      out.title = `${t.cat.coding}: ${file ?? s.editorTitle?.app ?? app?.name ?? t.unknownGame}${language ? ` (${language})` : ""}`;
      out.summary = join([s.editorTitle?.app ?? app?.name, file && (language ? `${file} (${language})` : file), s.editorTitle?.project && `${t.e.project.toLowerCase()} ${s.editorTitle.project}`, s.errors.error && `${t.e.error.toLowerCase()}: ${s.errors.error.slice(0, 80)}`]) || firstLines(lines, 3, t);
      out.activity = s.errors.error ? t.act.debugging : t.act.editing;
      out.chat = join([file, language, s.errors.error && t.act.debugging]);
      out.subject = normalizeText(file ?? s.editorTitle?.app ?? app?.name ?? "coding");
      break;
    }
    case "terminal": {
      const tests = s.terminal.tests;
      put(t.e.command, s.terminal.command);
      put(t.e.result, tests && t.tests(tests.passed, tests.failed, tests.total));
      put(t.e.error, s.errors.error?.slice(0, 120));
      out.title = `${t.cat.terminal}${s.terminal.command ? `: ${s.terminal.command}` : ""}`;
      out.summary = join([s.terminal.command, tests && t.tests(tests.passed, tests.failed, tests.total), s.errors.error && `${t.e.error.toLowerCase()}: ${s.errors.error.slice(0, 80)}`]) || firstLines(lines, 3, t);
      out.activity = t.act.running;
      out.chat = join([s.terminal.command, tests && t.tests(tests.passed, tests.failed, tests.total)]);
      out.subject = "terminal";
      break;
    }
    case "documents": {
      const app = appOf("documents");
      const doc = s.files.docs[0];
      const kind = doc?.kind ?? kindOfApp(app?.name) ?? (s.formulas ? "spreadsheet" : null);
      put(t.e.app, app?.name);
      put(t.e.file, doc?.name);
      put(t.e.kind, kind && t.kinds[kind]);
      out.title = `${t.cat.documents}: ${doc?.name ?? app?.name ?? (kind && t.kinds[kind]) ?? headline(lines)?.text ?? t.unknownGame}`;
      out.summary = join([kind && up(t.kinds[kind]), app?.name, doc?.name]) || firstLines(lines, 3, t);
      out.chat = join([doc?.name ?? app?.name, kind && t.kinds[kind]]);
      out.subject = normalizeText(doc?.name ?? app?.name ?? "documents");
      break;
    }
    case "email": {
      const app = appOf("email");
      const view = /(?:inbox|bandeja de entrada)/i.test(s.joined) ? (language === "en" ? "Inbox" : "Bandeja de entrada") : /(?:compose|redactar)/i.test(s.joined) ? (language === "en" ? "Compose" : "Redactar") : null;
      put(t.e.app, app?.name);
      put(t.e.folder, view);
      out.title = `${t.cat.email}${app ? `: ${app.name}` : ""}`;
      out.summary = join([app?.name, view]) || t.act.mail;
      out.activity = t.act.mail;
      out.chat = out.summary;
      out.subject = normalizeText(app?.name ?? "email");
      break;
    }
    case "chat": {
      const app = appOf("chat");
      put(t.e.app, app?.name);
      put(t.e.channel, s.channel && `#${s.channel}`);
      out.title = `${t.cat.chat}${app ? `: ${app.name}` : ""}${s.channel ? ` #${s.channel}` : ""}`;
      out.summary = join([app?.name, s.channel && `#${s.channel}`]) || t.act.chatting;
      out.activity = t.act.chatting;
      out.chat = out.summary;
      out.subject = normalizeText(`${app?.name ?? "chat"} ${s.channel ?? ""}`);
      break;
    }
    case "meeting": {
      const app = appOf("meeting");
      const headerLine = lines.find((l) => l.zone === "top" && /\s[·•|–—-]\s/.test(l.text)) ?? null;
      const topic = headerLine?.text.split(/\s[·•|–—-]\s/).map((p) => p.trim()).find((p) => p.length > 3 && !/\d{1,2}:\d{2}/.test(p) && normalizeText(p) !== normalizeText(app?.name ?? ""));
      put(t.e.app, app?.name);
      put(t.e.meeting, topic);
      out.title = `${t.cat.meeting}${app ? `: ${app.name}` : ""}`;
      out.summary = join([app?.name, topic]) || t.act.meeting;
      out.activity = t.act.meeting;
      out.chat = out.summary;
      out.subject = normalizeText(app?.name ?? "meeting");
      break;
    }
    case "browsing": {
      const head = headline(body, { minWords: 3, maxWords: 16 });
      put(t.e.site, topUrl?.host);
      put(t.e.page, head?.text);
      out.title = `${t.cat.browsing}${topUrl || head ? `: ${topUrl?.host ?? head.text}` : ""}`;
      out.summary = join([head?.text, topUrl && !head ? topUrl.host : null]) || firstLines(lines, 3, t);
      out.activity = /noticias|news|opinion|ultima hora|breaking/.test(normalizeText(s.joined)) ? `${t.act.news} ${language === "en" ? "the news" : "noticias"}` : "";
      out.chat = join([head?.text, topUrl?.host]);
      out.subject = topUrl?.host ?? normalizeText(head?.text ?? "browsing");
      break;
    }
    case "social": {
      const app = appOf("social");
      put(t.e.platform, app?.name);
      out.title = `${t.cat.social}${app ? `: ${app.name}` : ""}`;
      out.summary = join([app?.name]) || firstLines(lines, 3, t);
      out.chat = out.summary;
      out.subject = normalizeText(app?.name ?? "social");
      break;
    }
    default: {
      put(t.e.site, site?.name);
      put(t.e.app, matches.find((m) => m.type === "apps" && !m.fromHint)?.name);
      const head = headline(lines, { minWords: 1, maxWords: 8 }) ?? lines[0];
      out.title = head.text;
      out.summary = firstLines(lines, 4, t);
      out.chat = head.text;
      out.subject = normalizeText(head.text);
    }
  }

  return { ...out, entities, notes };
}

function kindOfApp(name = "") {
  const n = normalizeText(name);
  if (/excel|sheets/.test(n)) return "spreadsheet";
  if (/word|docs|acrobat/.test(n)) return "document";
  if (/powerpoint|slides|keynote/.test(n)) return "presentation";
  if (/figma|photoshop|illustrator|canva|blender/.test(n)) return "design";
  if (/premiere|davinci/.test(n)) return "videoEditing";
  if (/notion|obsidian/.test(n)) return "notes";
  return null;
}
