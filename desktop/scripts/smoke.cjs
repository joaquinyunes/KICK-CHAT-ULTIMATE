// Prueba de humo del build: arranca los dos servicios ya compilados (bytecode) con el Electron de la app
// y comprueba que (1) el servidor responde solo con el token, (2) Pantalla Contexto lee una imagen con OCR.
//
//   node scripts/smoke.cjs [carpeta-de-la-app]      (por defecto build/app)
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const APP = path.resolve(process.argv[2] ?? path.join(DESKTOP, "build", "app"));
const electron = require("electron");
const TOKEN = "smoke-token";
const SERVER_PORT = 3911;
const SCREEN_PORT = 3912;
const data = fs.mkdtempSync(path.join(os.tmpdir(), "kcu-smoke-"));

function start(entry, env) {
  const code = `require("bytenode");require(${JSON.stringify(path.join(APP, entry))});`;
  const child = spawn(electron, ["-e", code], { cwd: data, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_PATH: path.join(APP, "node_modules"), ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.logs = "";
  child.stdout.on("data", (b) => (child.logs += b));
  child.stderr.on("data", (b) => (child.logs += b));
  return child;
}

function request(port, method, urlPath, { token = TOKEN, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = token ? { "x-desktop-token": token } : {};
    if (body) Object.assign(headers, { "content-type": "application/json" });
    const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function until(fn, ms = 60_000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const r = await fn();
      if (r) return r;
    } catch {
      /* todavía no */
    }
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 400));
  }
}

const results = [];
const check = (name, ok, extra = "") => {
  results.push(ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
};

(async () => {
  const kids = [
    start("server/dist/server.jsc", {
      NODE_ENV: "production", PORT: String(SERVER_PORT), HOST: "127.0.0.1", DESKTOP_TOKEN: TOKEN,
      MASTER_KEY: "a".repeat(64), JWT_SECRET: "b".repeat(48), ADMIN_PASSWORD: "smoke-pass-123",
      KICK_CLIENT_ID: "x", KICK_CLIENT_SECRET: "x", KICK_REDIRECT_URI: `http://localhost:${SERVER_PORT}/cb`, KC_PIPELINE_ENABLED: "0",
    }),
    start("pantalla/dist/pantalla.jsc", { PORT: String(SCREEN_PORT), HOST: "127.0.0.1", PANTALLA_DESKTOP_TOKEN: TOKEN, PANTALLA_BACKEND: "ocr", PANTALLA_OCR_LANGS: "eng" }),
  ];
  try {
    await until(async () => (await request(SERVER_PORT, "GET", "/health")).status === 200);
    check("servidor arranca desde bytecode", true);
    check("servidor sin token -> 403", (await request(SERVER_PORT, "GET", "/health", { token: null })).status === 403);
    const page = await request(SERVER_PORT, "GET", "/");
    check("servidor sirve el panel con token", page.status === 200 && page.text.includes("<"), `${page.text.length} bytes`);

    await until(async () => (await request(SCREEN_PORT, "GET", "/api/config")).status === 200);
    check("pantalla arranca desde bytecode", true);
    check("pantalla sin token -> 403", (await request(SCREEN_PORT, "GET", "/api/config", { token: null })).status === 403);

    const image = fs.readFileSync(path.join(DESKTOP, "..", "pantalla-context", "test", "fixtures", "casino.jpg")).toString("base64");
    const r = await request(SCREEN_PORT, "POST", "/api/analyze", { body: JSON.stringify({ image: `data:image/jpeg;base64,${image}`, mode: "auto", language: "es" }) });
    let parsed = {};
    try { parsed = JSON.parse(r.text); } catch { /* se informa abajo */ }
    check("pantalla hace OCR de una captura", r.status === 200 && parsed.context?.category === "casino", `HTTP ${r.status} ${r.text.slice(0, 160)}`);
  } catch (err) {
    check("flujo", false, err.message);
  } finally {
    for (const k of kids) k.kill();
    if (results.includes(false)) for (const k of kids) console.log("\n--- log ---\n" + k.logs.slice(-1500));
    await new Promise((r) => setTimeout(r, 800)); // que los hijos suelten su carpeta de trabajo
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* carpeta temporal, no importa */ }
    process.exit(results.includes(false) ? 1 : 0);
  }
})();
