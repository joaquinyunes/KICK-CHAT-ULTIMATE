#!/usr/bin/env node
/**
 * periodic-writer.js — utilidad genérica e independiente.
 * Cada N segundos toma una fuente (comando shell o URL HTTP) y vuelca el
 * resultado a un archivo (sobrescribe o agrega). Escritura atómica (tmp + rename).
 *
 * NO forma parte del servidor: no se importa desde `src/` ni toca la DB.
 *
 * Uso:
 *   node scripts/periodic-writer.js --out data/contexto.txt --every 300 --cmd "python ../stream-context/main.py --once"
 *   node scripts/periodic-writer.js --out data/contexto.txt --every 300 --url http://localhost:8080/context --append
 *
 * Flags:
 *   --out <path>     archivo destino (requerido)
 *   --every <secs>   intervalo en segundos (default 300)
 *   --cmd <string>   comando cuyo stdout se guarda
 *   --url <string>   URL cuyo body se guarda (alternativa a --cmd)
 *   --append         agrega al final en vez de sobrescribir
 *   --timestamp      antepone una línea `# <ISO> ` en cada escritura
 *   --once           corre una sola vez y termina
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

function parseArgs(argv) {
  const a = { every: 300 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--append" || k === "--timestamp" || k === "--once") a[k.slice(2)] = true;
    else if (k.startsWith("--")) a[k.slice(2)] = argv[++i];
  }
  return a;
}

const args = parseArgs(process.argv);

if (!args.out || (!args.cmd && !args.url)) {
  console.error("Falta --out y (--cmd o --url). Ver cabecera del archivo.");
  process.exit(1);
}

const outPath = path.resolve(process.cwd(), args.out);
const everyMs = Math.max(5, Number(args.every) || 300) * 1000;

async function getPayload() {
  if (args.url) {
    const res = await fetch(args.url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }
  return await new Promise((resolve, reject) => {
    exec(
      args.cmd,
      { timeout: 60_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

function writeAtomic(content) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const body = args.timestamp ? `# ${new Date().toISOString()}\n${content}` : content;
  if (args.append) {
    fs.appendFileSync(outPath, body.endsWith("\n") ? body : body + "\n");
    return;
  }
  const tmp = outPath + ".tmp";
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, outPath);
}

async function tick() {
  try {
    const payload = await getPayload();
    writeAtomic(payload);
    console.log(`[${new Date().toISOString()}] ${args.append ? "append" : "write"} ${payload.length}b → ${args.out}`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] error:`, e.message);
  }
}

(async () => {
  await tick();
  if (args.once) return;
  setInterval(tick, everyMs);
  console.log(`corriendo cada ${everyMs / 1000}s — Ctrl+C para parar`);
})();
