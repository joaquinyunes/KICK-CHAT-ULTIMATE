import assert from "node:assert/strict";
import { test } from "node:test";
import { findChannel, findClock, findEditorTitle, findErrors, findFiles, findHud, findPlayer, findScoreLine, findStream, findTerminal, findUrls, languageOf, termHits } from "../src/ocr/signals.js";

const line = (text, zone = "body", extra = {}) => ({ text, zone, confidence: 90, ...extra });
const box = (text, x0, y0, x1, y1) => ({ text, zone: "body", confidence: 90, bbox: { x0, y0, x1, y1 } });

test("findUrls: dominio sin www, ruta y franja; un archivo como main.js no es un dominio", () => {
  const urls = findUrls([line("https://www.elpais.com/espana/2026-10-05/gobierno.html", "top"), line("main.js server.ts index.json"), line("visita stake.com hoy")]);
  assert.deepEqual(urls.map((u) => [u.host, u.zone]), [["elpais.com", "top"], ["stake.com", "body"]]);
  assert.equal(urls[0].path, "/espana/2026-10-05/gobierno.html");
  assert.equal(findUrls([line("localhost:3000/app")])[0].host, "localhost");
  assert.deepEqual(findUrls([line("package.json y README.md")]), []);
});

test("findFiles separa código y documentos y deduce el lenguaje", () => {
  const { code, docs } = findFiles([line("main.js server.ts script.py", "top"), line("Presupuesto 2026.xlsx - Excel"), line("informe.pdf")]);
  assert.deepEqual(code.map((f) => [f.name, f.language]), [["main.js", "JavaScript"], ["server.ts", "TypeScript"], ["script.py", "Python"]]);
  assert.deepEqual(docs.map((f) => [f.name, f.kind]), [["Presupuesto 2026.xlsx", "spreadsheet"], ["informe.pdf", "pdf"]]);
  assert.equal(languageOf("src/app.tsx"), "React (TSX)");
  assert.equal(languageOf("README"), null);
  assert.equal(languageOf(undefined), null);
});

test("findEditorTitle lee la barra del editor aunque el OCR pierda el punto del archivo", () => {
  assert.deepEqual(findEditorTitle([line("main.js — pantalla-context — Visual Studio Code")]), { file: "main.js", project: "pantalla-context", app: "Visual Studio Code" });
  assert.deepEqual(findEditorTitle([line("main js — pantalla-context — Visual Studio Code")]), { file: "main.js", project: "pantalla-context", app: "Visual Studio Code" });
  assert.deepEqual(findEditorTitle([line("● app.py - proyecto - PyCharm")]), { file: "app.py", project: "proyecto", app: "PyCharm" });
  assert.equal(findEditorTitle([line("Documento sin título - Word")]), null);
});

test("findErrors: errores con nombre, trazas y mensajes del sistema", () => {
  assert.match(findErrors([line("TypeError: Cannot read properties of undefined (reading 'map')")]).error, /^TypeError: Cannot read/);
  assert.equal(findErrors([line("at analyze (src/app.js:42:13)")]).stack, true);
  assert.equal(findErrors([line('File "app.py", line 12, in <module>')]).stack, true);
  assert.match(findErrors([line("bash: foo: command not found")]).error, /command not found/);
  assert.deepEqual(findErrors([line("todo va bien")]), { error: null, stack: false });
});

test("findTerminal: prompt, último comando y resultado de pruebas", () => {
  const r = findTerminal([line("user@dev:~/app$ npm test"), line("# tests 174"), line("# pass 170"), line("# fail 4"), line("user@dev:~/app$ git status")]);
  assert.deepEqual([r.prompt, r.command, r.tests], [true, "git status", { total: 174, passed: 170, failed: 4 }]);
  assert.deepEqual(findTerminal([line("PS C:\\proyecto> dotnet build")]).command, "dotnet build");
  assert.deepEqual(findTerminal([line("12 passing"), line("2 failing")]).tests, { total: 14, passed: 12, failed: 2 });
  assert.deepEqual(findTerminal([line("hola")]), { prompt: false, command: null, tests: null });
});

test("findPlayer, findStream y findChannel", () => {
  assert.deepEqual(findPlayer([line("▶ 12:34 / 25:10"), line("1.2M views")]), { time: { current: "12:34", total: "25:10" }, views: "1.2M" });
  assert.deepEqual(findPlayer([line("1:02:03 / 2:00:00")]).time, { current: "1:02:03", total: "2:00:00" });
  assert.deepEqual(findStream([line("xQc is live"), line("Just Chatting · 48,213 viewers")]), { streamer: "xQc", viewers: "48,213", category: "Just Chatting" });
  assert.equal(findChannel([line("# general · Discord")]), "general");
  assert.equal(findChannel([line("sin canal")]), null);
});

test("findScoreLine: una línea, o completando el visitante partido en dos líneas", () => {
  assert.deepEqual(findScoreLine([line("Real Madrid 2 - 1 Manchester City")]), { home: "Real Madrid", away: "Manchester City", score: "2-1" });
  const wrapped = findScoreLine([box("Los Angeles Lakers 98 - 102 Boston", 100, 100, 900, 150), box("Celtics", 120, 160, 300, 210)]);
  assert.deepEqual(wrapped, { home: "Los Angeles Lakers", away: "Boston Celtics", score: "98-102" });
  const far = findScoreLine([box("Los Angeles Lakers 98 - 102 Boston", 100, 100, 900, 150), box("Celtics", 120, 600, 300, 650)]);
  assert.equal(far.away, "Boston", "una línea lejana no se une");
  assert.equal(findScoreLine([line("ROUND 14 - 1:12")]), null);
});

test("findClock: minuto, cuarto con guion del OCR y hitos", () => {
  assert.equal(findClock([line("67' · 2ª parte")]), "67'");
  assert.equal(findClock([line("Q4 · 03:21")]), "Q4 03:21");
  assert.equal(findClock([line("Q4- 03:21")]), "Q4 03:21");
  assert.equal(findClock([line("HT")]), "HT");
  assert.equal(findClock([line("sin reloj")]), null);
});

test("findHud reconoce vida, escudo, kills, eliminaciones y nivel", () => {
  assert.deepEqual(findHud("HP 87 SHIELD 100 Eliminations 7 Level 12 Kills 18 K/D 2.0"), ["HP 87", "Shield 100", "Kills 18", "K/D 2.0", "Eliminations 7", "Level 12"]);
});

test("termHits cuenta términos DISTINTOS, no repeticiones", () => {
  assert.equal(termHits("meeting", "mute mute mute camara salir"), 3);
  assert.equal(termHits("casino", "hola"), 0);
});
