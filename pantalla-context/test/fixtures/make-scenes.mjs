// Genera las pantallas de prueba del banco de precisión (test/fixtures/scenes/*.jpg).
// Son pantallas SINTÉTICAS dibujadas con HTML: sirven para detectar regresiones, no para prometer precisión en webs reales.
// Uso (necesita Playwright y Chromium):  PLAYWRIGHT=/ruta/a/playwright/index.mjs CHROMIUM=/ruta/a/chrome node test/fixtures/make-scenes.mjs
import fs from "node:fs";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const OUT = new URL("./scenes/", import.meta.url).pathname;

const font = "font-family:Arial,Helvetica,sans-serif";
const page = (style, body, w = 1280, h = 720) => `<body style="margin:0;width:${w}px;height:${h}px;position:relative;overflow:hidden;${font};${style}">${body}</body>`;
const reels = (n = 30) => Array.from({ length: n }, (_, i) => `<div style="background:#3b1d7a;border-radius:8px;font-size:34px;text-align:center;line-height:56px">${["🍇", "🍌", "🍎", "🍉", "🍬", "🍭"][i % 6]}</div>`).join("");

export const scenes = {
  // --- casino ---
  casino: { size: [1280, 720], html: page("background:linear-gradient(#1b1038,#3a1b6e);color:#fff", `
    <div style="padding:14px 24px;background:#120a28;display:flex;justify-content:space-between;font-size:22px"><b>STAKE CASINO</b><span>Slots &gt; Pragmatic Play</span></div>
    <div style="text-align:center;font-size:54px;font-weight:bold;margin-top:26px;color:#ffd166">SWEET BONANZA</div>
    <div style="margin:20px auto;width:760px;height:330px;background:#2a1458;border:4px solid #ffd166;border-radius:16px;display:grid;grid-template-columns:repeat(6,1fr);gap:6px;padding:10px">${reels()}</div>
    <div style="position:absolute;bottom:0;left:0;right:0;background:#120a28;padding:18px 40px;display:flex;justify-content:space-between;font-size:26px"><span>BALANCE <b>€148.30</b></span><span>BET <b>€2.00</b></span><span style="color:#7CFC8A">WIN <b>€36.50</b></span><span style="color:#ffd166">FREE SPINS 8</span><span>MULTIPLIER x25</span></div>`) },
  roulette: { size: [1280, 720], html: page("background:radial-gradient(#0b3d2e,#04150f);color:#fff", `
    <div style="padding:14px 24px;background:#02100b;display:flex;justify-content:space-between;font-size:22px"><b>Betano Casino</b><span>Live Casino · Evolution</span></div>
    <div style="text-align:center;font-size:56px;font-weight:bold;margin-top:24px;color:#ffd166">Lightning Roulette</div>
    <div style="text-align:center;font-size:30px;margin-top:20px;color:#9fe">LAST NUMBERS &nbsp; 17 &nbsp; 32 &nbsp; 5 &nbsp; 0 &nbsp; 26</div>
    <div style="margin:30px auto;width:700px;height:260px;border-radius:50%;background:#14543f;border:6px solid #ffd166;text-align:center;line-height:260px;font-size:44px">PLACE YOUR BETS · 12s</div>
    <div style="position:absolute;bottom:0;left:0;right:0;background:#02100b;padding:18px 40px;display:flex;justify-content:space-around;font-size:26px"><span>BALANCE <b>$512.00</b></span><span>TOTAL BET <b>$25.00</b></span></div>`) },
  casino_hard: { size: [1280, 720], html: page("background:linear-gradient(120deg,#ffe29a,#ff9a76,#ffd1ff);color:#fff", `
    <div style="text-align:center;font-size:58px;font-weight:bold;margin-top:60px;text-shadow:3px 3px 0 #5a1d00,-2px -2px 0 #5a1d00">GATES OF OLYMPUS</div>
    <div style="text-align:center;font-size:28px;margin-top:10px;text-shadow:2px 2px 0 #3a1000">Pragmatic Play</div>
    <div style="position:absolute;bottom:30px;left:40px;right:40px;display:flex;justify-content:space-between;font-size:30px;font-weight:bold;text-shadow:2px 2px 0 #301000"><span>BALANCE $320.50</span><span>BET $4.00</span><span>WIN $0.00</span></div>`) },
  // --- deportes ---
  sports: { size: [1280, 720], html: page("background:#0b1a12;color:#fff", `
    <div style="padding:14px 24px;background:#07110c;display:flex;justify-content:space-between;font-size:22px"><b>bet365</b><span>EN VIVO · Fútbol · UEFA Champions League</span></div>
    <div style="text-align:center;margin-top:40px"><div style="font-size:58px;font-weight:bold">Real Madrid 2 - 1 Manchester City</div><div style="font-size:34px;color:#7CFC8A;margin-top:12px">67' · 2ª parte · LIVE</div></div>
    <div style="display:flex;justify-content:center;gap:40px;margin-top:60px;font-size:30px"><div style="background:#143826;padding:24px 50px;border-radius:12px;text-align:center">Real Madrid<br><b style="font-size:44px">1.45</b></div><div style="background:#143826;padding:24px 50px;border-radius:12px;text-align:center">Empate<br><b style="font-size:44px">4.20</b></div><div style="background:#143826;padding:24px 50px;border-radius:12px;text-align:center">Manchester City<br><b style="font-size:44px">6.75</b></div></div>
    <div style="text-align:center;margin-top:50px;font-size:26px;color:#9fb">Próximo gol · Mercado 1X2 · Apuesta simple €10.00</div>`) },
  basket: { size: [1280, 720], html: page("background:#10131c;color:#fff", `
    <div style="padding:14px 24px;background:#080a10;font-size:22px"><b>NBA</b> · Regular Season · ESPN</div>
    <div style="text-align:center;margin-top:70px;font-size:64px;font-weight:bold">Los Angeles Lakers 98 - 102 Boston Celtics</div>
    <div style="text-align:center;margin-top:30px;font-size:40px;color:#ffd166">Q4 · 03:21</div>`) },
  // --- videojuegos ---
  game: { size: [1280, 720], html: page("background:linear-gradient(#335,#121);color:#fff", `
    <div style="position:absolute;top:20px;left:24px;font-size:28px">VALORANT · Competitive · Ascent</div><div style="position:absolute;top:20px;right:24px;font-size:40px;font-weight:bold">ROUND 14 · 1:12</div>
    <div style="position:absolute;top:80px;left:540px;font-size:60px;font-weight:bold">8 : 5</div><div style="position:absolute;bottom:30px;left:30px;font-size:40px">HP 100 &nbsp; ARMOR 50</div>
    <div style="position:absolute;bottom:30px;right:30px;font-size:40px">Vandal 25 / 75</div><div style="position:absolute;bottom:100px;left:30px;font-size:30px">Kills 18 &nbsp; Deaths 9 &nbsp; K/D 2.0</div>`) },
  game_hard: { size: [1280, 720], html: page("background:linear-gradient(135deg,#ff7e5f,#feb47b,#86a8e7,#91eae4);color:#fff", `
    <div style="position:absolute;top:24px;left:24px;font-size:34px;font-weight:bold;-webkit-text-stroke:2px #000;text-shadow:3px 3px 0 #000">FORTNITE</div>
    <div style="position:absolute;bottom:40px;left:30px;font-size:44px;font-weight:bold;-webkit-text-stroke:2px #000">HP 87 &nbsp; SHIELD 100</div>
    <div style="position:absolute;top:24px;right:30px;font-size:36px;font-weight:bold;-webkit-text-stroke:2px #000">Eliminations 7 &nbsp; 23 players left</div>`) },
  // --- trading ---
  trading: { size: [1280, 720], html: page("background:#0d1117;color:#e6edf3", `
    <div style="padding:14px 24px;background:#161b22;display:flex;gap:30px;font-size:26px"><b>BTC/USDT</b><span>1h</span><span>Binance</span><span style="color:#26a69a">67,420.50 +2.35%</span></div>
    <div style="padding:30px;font-size:30px">Open 66,120.00 &nbsp; High 67,800.10 &nbsp; Low 65,990.00 &nbsp; Close 67,420.50<br><br>Vol 1,245.8 BTC &nbsp; RSI 61.2 &nbsp; MA(50) 65,880</div>
    <div style="margin:20px 30px;display:flex;gap:30px"><div style="background:#26a69a;padding:20px 60px;font-size:36px;border-radius:8px">Buy / Long</div><div style="background:#ef5350;padding:20px 60px;font-size:36px;border-radius:8px">Sell / Short</div></div>`) },
  // --- trabajo / programación ---
  code: { size: [1280, 720], html: page("background:#1e1e1e;color:#d4d4d4;font-family:Consolas,'DejaVu Sans Mono',monospace", `
    <div style="background:#323233;padding:8px 16px;font-size:16px;font-family:Arial">main.js — pantalla-context — Visual Studio Code</div>
    <div style="background:#252526;padding:6px 16px;font-size:15px;font-family:Arial;display:flex;gap:24px"><span style="color:#fff">main.js</span><span>server.js</span><span>package.json</span></div>
    <pre style="margin:16px;font-size:20px;line-height:28px;color:#9cdcfe">import { createApp } from "./src/app.js";
const backend = createBackend(config);
function analyze(req) {
  const result = await run(req);
  return result.items.map((item) =&gt; item.name);
}</pre>
    <div style="position:absolute;bottom:0;left:0;right:0;height:210px;background:#181818;border-top:1px solid #444;padding:12px 18px;font-size:18px;line-height:26px;color:#f48771">PROBLEMS &nbsp; OUTPUT &nbsp; TERMINAL<br>TypeError: Cannot read properties of undefined (reading 'map')<br>&nbsp;&nbsp;&nbsp;at analyze (src/app.js:42:13)<br><span style="color:#d4d4d4">$ npm test</span></div>`) },
  terminal: { size: [1280, 720], html: page("background:#0c0c0c;color:#cccccc;font-family:'DejaVu Sans Mono',monospace", `
    <pre style="margin:20px;font-size:22px;line-height:32px">user@dev:~/pantalla-context$ npm test
&gt; pantalla-contexto@0.2.0 test
&gt; node --test "test/*.test.js"
# tests 174
# pass 174
# fail 0
user@dev:~/pantalla-context$ git status</pre>`) },
  browser_news: { size: [1280, 720], html: page("background:#fff;color:#111", `
    <div style="background:#e8eaed;padding:10px 16px;font-size:18px;display:flex;gap:12px"><span style="background:#fff;border-radius:16px;padding:6px 18px;flex:1">https://www.elpais.com/espana/2026-10-05/el-gobierno-aprueba-el-presupuesto.html</span></div>
    <div style="padding:30px 60px"><div style="font-size:16px;color:#666">EL PAÍS · España</div><div style="font-size:50px;font-weight:bold;margin:14px 0">El Gobierno aprueba el presupuesto para 2027</div><div style="font-size:22px;color:#444">Madrid · 5 oct 2026 · Suscríbete para seguir leyendo</div></div>`) },
  email: { size: [1280, 720], html: page("background:#f6f8fc;color:#202124", `
    <div style="background:#fff;padding:14px 24px;font-size:22px;border-bottom:1px solid #ddd"><b>Gmail</b> &nbsp; Bandeja de entrada · Redactar</div>
    <div style="padding:20px 40px;font-size:26px;line-height:50px">Equipo Producto &nbsp; Reunión de planificación del lunes<br>Banco Central &nbsp; Resumen de tu cuenta de septiembre<br>GitHub &nbsp; [pantalla-context] Pull request #12 merged</div>`) },
  spreadsheet: { size: [1280, 720], html: page("background:#fff;color:#111", `
    <div style="background:#217346;color:#fff;padding:10px 20px;font-size:20px">Presupuesto 2026.xlsx - Excel</div>
    <div style="padding:16px;font-size:20px"><table style="border-collapse:collapse;width:100%"><tr style="background:#eee"><th style="border:1px solid #bbb;padding:8px">Concepto</th><th style="border:1px solid #bbb;padding:8px">Enero</th><th style="border:1px solid #bbb;padding:8px">Febrero</th></tr><tr><td style="border:1px solid #bbb;padding:8px">Alquiler</td><td style="border:1px solid #bbb;padding:8px">900</td><td style="border:1px solid #bbb;padding:8px">900</td></tr><tr><td style="border:1px solid #bbb;padding:8px">Total</td><td style="border:1px solid #bbb;padding:8px">=SUM(B2:B5)</td><td style="border:1px solid #bbb;padding:8px">=SUM(C2:C5)</td></tr></table></div>`) },
  // --- comunicación / vídeo / streaming ---
  chat: { size: [1280, 720], html: page("background:#313338;color:#dbdee1", `
    <div style="background:#2b2d31;width:260px;height:720px;position:absolute;left:0;top:0;padding:20px;font-size:22px"><b>Pantalla Dev</b><br><br># general<br># ayuda<br># ideas</div>
    <div style="position:absolute;left:290px;top:20px;font-size:26px"><b># general</b> · Discord<br><br><b style="color:#5865f2">maria</b> hoy 18:02 &nbsp; ¿alguien probó el OCR?<br><b style="color:#43b581">luis</b> hoy 18:03 &nbsp; sí, va muy bien<br><b style="color:#5865f2">maria</b> hoy 18:04 &nbsp; genial, gracias</div>`) },
  meeting: { size: [1280, 720], html: page("background:#202124;color:#fff", `
    <div style="padding:16px 24px;font-size:24px"><b>Google Meet</b> · Reunión semanal de producto · 12:45</div>
    <div style="display:flex;gap:20px;margin:40px;font-size:30px"><div style="background:#3c4043;width:420px;height:300px;text-align:center;line-height:300px">Ana García</div><div style="background:#3c4043;width:420px;height:300px;text-align:center;line-height:300px">Pedro Ruiz</div></div>
    <div style="position:absolute;bottom:20px;left:0;right:0;text-align:center;font-size:24px">Silenciar &nbsp; Cámara &nbsp; Presentar ahora &nbsp; <span style="background:#ea4335;padding:8px 20px;border-radius:20px">Salir</span></div>`) },
  video: { size: [1280, 720], html: page("background:#0f0f0f;color:#fff", `
    <div style="background:#000;height:430px;position:relative"><div style="position:absolute;bottom:14px;left:20px;font-size:22px">▶ 12:34 / 25:10</div></div>
    <div style="padding:16px 30px"><div style="font-size:34px;font-weight:bold">Cómo configurar OBS Studio para streaming en 2026</div><div style="font-size:24px;color:#aaa;margin-top:10px">YouTube · TutoStream · 1.2M views · Subscribe</div></div>`) },
  twitch: { size: [1280, 720], html: page("background:#18181b;color:#efeff1", `
    <div style="background:#0e0e10;padding:14px 24px;font-size:22px"><b style="color:#9147ff">Twitch</b> &nbsp; Following · Browse</div>
    <div style="padding:30px;font-size:40px;font-weight:bold">xQc is live</div><div style="padding:0 30px;font-size:28px">Just Chatting · 48,213 viewers · Subscribe · Chat</div>`) },
  // --- NEGATIVOS Y AMBIGUOS: parecen una actividad pero no lo son (o no hay nada que leer) ---
  slot_review: { size: [1280, 720], html: page("background:#fff;color:#111", `
    <div style="background:#e8eaed;padding:10px 16px;font-size:18px"><span style="background:#fff;border-radius:16px;padding:6px 18px;display:inline-block;width:900px">https://www.casinoreviews.com/slots/sweet-bonanza-review</span></div>
    <div style="padding:26px 70px"><div style="font-size:40px;font-weight:bold">Sweet Bonanza: reseña completa del slot de Pragmatic Play</div>
    <div style="font-size:20px;color:#444;margin:10px 0 18px">Por Redacción · 5 oct 2026 · Leer más</div>
    <div style="font-size:21px;line-height:34px;max-width:1100px">Sweet Bonanza es una de las tragaperras más populares del proveedor y destaca por su mecánica de cascadas y el multiplicador de las bombas de caramelo.<br>En esta reseña analizamos su volatilidad, el porcentaje de retorno teórico y las rondas de giros gratis que ofrece el juego a los jugadores.<br>Antes de jugar conviene leer las condiciones del operador y establecer un límite de gasto responsable para cada sesión.</div></div>`) },
  sports_news: { size: [1280, 720], html: page("background:#fff;color:#111", `
    <div style="background:#e8eaed;padding:10px 16px;font-size:18px"><span style="background:#fff;border-radius:16px;padding:6px 18px;display:inline-block;width:900px">https://www.marca.com/futbol/champions-league/2026/10/05/cronica-madrid-city.html</span></div>
    <div style="padding:26px 70px"><div style="font-size:30px;color:#c00">MARCA · Champions League · Crónica</div><div style="font-size:44px;font-weight:bold;margin:10px 0">Real Madrid 2 - 1 Manchester City</div>
    <div style="font-size:20px;color:#444;margin:6px 0 18px">Madrid · 5 oct 2026 · Suscríbete para seguir leyendo</div>
    <div style="font-size:21px;line-height:34px;max-width:1100px">El conjunto blanco se impuso en el Santiago Bernabéu con un gol en el minuto 67 que decidió un partido muy disputado por ambos equipos.<br>El técnico destacó la intensidad de la segunda parte y la solidez defensiva del equipo durante todo el encuentro disputado en casa.</div></div>`) },
  lorem: { size: [1280, 720], html: page("background:#fff;color:#222", `
    <div style="padding:60px 120px;font-size:22px;line-height:36px">Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.<br>Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.<br>Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.</div>`) },
  blank: { size: [1280, 720], html: page("background:#101018", "") },
  noise: { size: [1280, 720], html: page("background:conic-gradient(from 30deg,#f06,#09f,#0f9,#fc0,#f06)", `<div style="position:absolute;left:300px;top:200px;width:600px;height:300px;border-radius:50%;background:radial-gradient(#fff3,#0008)"></div>`) },
  // --- letra pequeña (full HD) ---
  small_text: { size: [1920, 1080], html: page("background:#10101a;color:#fff", `
    <div style="padding:14px 30px;background:#0a0a12;display:flex;justify-content:space-between;font-size:15px"><b>STAKE CASINO</b><span>Slots &gt; Pragmatic Play</span></div>
    <div style="text-align:center;font-size:60px;font-weight:bold;margin-top:60px;color:#ffd166">SUGAR RUSH</div>
    <div style="position:absolute;bottom:14px;left:30px;right:30px;display:flex;justify-content:space-between;font-size:14px"><span>BALANCE €75.20</span><span>BET €0.50</span><span>WIN €1.20</span></div>`, 1920, 1080) },
};

if (import.meta.url === `file://${process.argv[1]}`) {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox"] });
  for (const [name, { size, html }] of Object.entries(scenes)) {
    const p = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
    await p.setContent(`<!doctype html><meta charset=utf-8>${html}`);
    await p.screenshot({ path: `${OUT}${name}.jpg`, type: "jpeg", quality: 85 });
    await p.close();
  }
  await browser.close();
  console.log(`${Object.keys(scenes).length} pantallas generadas en ${OUT}`);
}
