// Proceso principal de la app de escritorio.
// Levanta el servidor KCU y Pantalla Contexto como procesos hijos ligados a 127.0.0.1, con un token por
// arranque que solo conoce esta ventana; el pipeline de Python lo lanza el propio servidor (KC_EXE).
const { app, BrowserWindow, Menu, session, desktopCapturer, ipcMain, utilityProcess, dialog, shell, clipboard } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const secrets = require("./secrets");
const license = require("./license");
const licenseConfig = require("./license-config.json");
const PUBLIC_KEY = require("./license-public.pem");

const HOST = "127.0.0.1";
const PREFERRED = { server: 3000, pantalla: 3100 };
// Dominios a los que la ventana puede ir además de la app (login de Kick para conectar la cuenta).
const KICK_HOSTS = /(^|\.)kick\.com$/;

const token = crypto.randomBytes(24).toString("hex");
const ports = { server: 0, pantalla: 0 };
const children = new Map();
let settings;
let mainWindow = null;
let pantallaWindow = null;
let setupWindow = null;
let quitting = false;

const resource = (...p) => path.join(process.resourcesPath, ...p);
const dataDir = (...p) => path.join(app.getPath("userData"), ...p);
const origin = (name) => `http://${HOST}:${ports[name]}`;

// ── Utilidades ─────────────────────────────────────────────────────────────

function freePort(preferred) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const srv = net.createServer();
      srv.once("error", () => (port === 0 ? resolve(0) : tryPort(0)));
      srv.listen(port, HOST, () => {
        const { port: got } = srv.address();
        srv.close(() => resolve(got));
      });
    };
    tryPort(preferred);
  });
}

function probe(port, urlPath) {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port, path: urlPath, headers: { "x-desktop-token": token }, timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => req.destroy());
  });
}

async function waitFor(port, urlPath, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await probe(port, urlPath)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// ── Servicios hijos ────────────────────────────────────────────────────────

function serverEnv() {
  const exe = app.isPackaged ? resource("kc", "kc-runtime.exe") : path.join(__dirname, "..", "python-dist", "kc-runtime.exe");
  const binDir = app.isPackaged ? resource("bin") : path.join(__dirname, "..", "bin");
  return {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(ports.server),
    HOST,
    DESKTOP_TOKEN: token,
    MASTER_KEY: settings.masterKey,
    JWT_SECRET: settings.jwtSecret,
    ADMIN_SECRET: settings.adminSecret,
    ADMIN_PASSWORD: settings.adminPassword,
    // Sin credenciales de Kick el servidor no arranca (las exige al validar el entorno): valores de relleno hasta que se configuren.
    KICK_CLIENT_ID: settings.kickClientId || "sin-configurar",
    KICK_CLIENT_SECRET: settings.kickClientSecret || "sin-configurar",
    KICK_REDIRECT_URI: `http://localhost:${ports.server}/auth/kick/callback`,
    OPENROUTER_API_KEY: settings.openrouterKey,
    KICK_GEMINI_API_KEY: settings.geminiKey,
    KICK_CANAL_SLUG: settings.channelSlug,
    KC_PIPELINE_ENABLED: settings.pipelineEnabled ? "1" : "0",
    KC_EXE: exe,
    KC_DIR: dataDir("kick-context"),
    KICK_CONTEXT_DATA_DIR: dataDir("kick-context-data"),
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
  };
}

function pantallaEnv() {
  return {
    ...process.env,
    PORT: String(ports.pantalla),
    HOST,
    PANTALLA_DESKTOP_TOKEN: token,
    PANTALLA_BACKEND: process.env.PANTALLA_BACKEND || "ocr",
    PANTALLA_OCR_LANGS: process.env.PANTALLA_OCR_LANGS || "eng+spa",
  };
}

function launch(name, entry, env) {
  fs.mkdirSync(dataDir("logs"), { recursive: true });
  const log = fs.createWriteStream(dataDir("logs", `${name}.log`), { flags: "w" });
  const child = utilityProcess.fork(path.join(__dirname, entry), [], { env, cwd: app.getPath("userData"), stdio: "pipe", serviceName: name });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  children.set(name, child);
  child.once("exit", (code) => {
    children.delete(name);
    log.end();
    if (!quitting && !restarting) dialog.showErrorBox("KICK-CHAT-ULTIMATE", `El servicio «${name}» se cerró (código ${code}). Revisa ${dataDir("logs", `${name}.log`)}`);
  });
}

function stopChild(name, graceMs = 8000) {
  const child = children.get(name);
  if (!child) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill(), graceMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.postMessage({ type: "shutdown" });
  });
}

let restarting = false;
async function startServices() {
  ports.server = await freePort(PREFERRED.server);
  ports.pantalla = await freePort(PREFERRED.pantalla);
  launch("servidor", "server/index.js", serverEnv());
  launch("pantalla", "pantalla/index.js", pantallaEnv());
  const ok = await waitFor(ports.server, "/health");
  if (!ok) throw new Error(`El servidor no respondió. Revisa ${dataDir("logs", "servidor.log")}`);
}

// ── Ventanas ───────────────────────────────────────────────────────────────

function isAppUrl(url) {
  try {
    const u = new URL(url);
    // localhost (no solo 127.0.0.1): es el host del redirect_uri de OAuth que Kick devuelve al servidor.
    return (
      u.origin === origin("server") ||
      u.origin === origin("pantalla") ||
      u.origin === `http://localhost:${ports.server}` ||
      (u.protocol === "https:" && KICK_HOSTS.test(u.hostname))
    );
  } catch {
    return false;
  }
}

// Se aplica a TODA ventana, incluidas las que abre la app (login de Kick).
function lockDown(wc) {
  wc.on("before-input-event", (e, input) => {
    const devtools = input.key === "F12" || (input.control && input.shift && /^[ijc]$/i.test(input.key));
    if (devtools) e.preventDefault();
  });
  wc.on("will-navigate", (e, url) => {
    if (!isAppUrl(url)) {
      e.preventDefault();
      if (url.startsWith("https://")) shell.openExternal(url);
    }
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { devTools: false, sandbox: true } } };
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  wc.on("devtools-opened", () => wc.closeDevTools());
}

function createWindow(url, { title, width = 1280, height = 820 } = {}) {
  const win = new BrowserWindow({
    width,
    height,
    minWidth: 900,
    minHeight: 600,
    title,
    backgroundColor: "#0d0f14",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false },
  });
  win.loadURL(url);
  return win;
}

function openMain(urlPath = "/") {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(origin("server") + urlPath);
    mainWindow.focus();
    return;
  }
  mainWindow = createWindow(origin("server") + urlPath, { title: "KICK-CHAT-ULTIMATE" });
  mainWindow.on("closed", () => (mainWindow = null));
}

function openPantalla() {
  if (pantallaWindow && !pantallaWindow.isDestroyed()) return pantallaWindow.focus();
  pantallaWindow = createWindow(origin("pantalla") + "/", { title: "Pantalla Contexto", width: 1180, height: 780 });
  pantallaWindow.on("closed", () => (pantallaWindow = null));
}

function openSetup() {
  if (setupWindow && !setupWindow.isDestroyed()) return setupWindow.focus();
  setupWindow = new BrowserWindow({
    width: 560,
    height: 700,
    title: "Configuración",
    backgroundColor: "#0d0f14",
    autoHideMenuBar: true,
    parent: mainWindow ?? undefined,
    webPreferences: { preload: path.join(__dirname, "preload-setup.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false },
  });
  setupWindow.loadFile(path.join(__dirname, "renderer", "setup.html"));
  setupWindow.on("closed", () => (setupWindow = null));
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "Archivo", submenu: [{ label: "Configuración…", click: openSetup }, { label: "Licencia…", click: showLicense }, { type: "separator" }, { role: "quit", label: "Salir" }] },
      {
        label: "Ir a",
        submenu: [
          { label: "Panel principal", click: () => openMain("/") },
          { label: "Contexto en vivo", click: () => openMain("/kc") },
          { label: "Pantalla Contexto", click: openPantalla },
        ],
      },
      { label: "Ver", submenu: [{ role: "reload", label: "Recargar" }, { role: "togglefullscreen", label: "Pantalla completa" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }] },
    ]),
  );
}

// ── Sesión: token en cada petición y selector de pantalla ──────────────────

function setupSession() {
  const ses = session.defaultSession;
  const urls = [`http://${HOST}:${ports.server}/*`, `http://${HOST}:${ports.pantalla}/*`, `http://localhost:${ports.server}/*`];
  ses.webRequest.onBeforeSendHeaders({ urls }, (details, cb) => {
    cb({ requestHeaders: { ...details.requestHeaders, "x-desktop-token": token } });
  });
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(permission === "display-capture" && wc.getURL().startsWith(origin("pantalla"))));
  // Pantalla Contexto comparte pantalla con getDisplayMedia: Electron no trae selector, se arma un menú nativo.
  ses.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (!request.frame?.url.startsWith(origin("pantalla"))) return callback({});
      const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } });
      const picked = await new Promise((resolve) => {
        const menu = Menu.buildFromTemplate([
          { label: "¿Qué quieres compartir?", enabled: false },
          { type: "separator" },
          ...sources.map((s) => ({ label: s.name.slice(0, 80), click: () => resolve(s) })),
          { type: "separator" },
          { label: "Cancelar", click: () => resolve(null) },
        ]);
        menu.once("menu-will-close", () => setTimeout(() => resolve(null), 200));
        menu.popup();
      });
      callback(picked ? { video: picked } : {});
    },
    { useSystemPicker: false },
  );
}

// ── Licencia ───────────────────────────────────────────────────────────────

const MACHINE = license.machineId();
let revoked = new Set();
let currentLicense = null;
let licenseWindow = null;
let licenseResolve = null;

async function checkLicense(token = settings.license) {
  const fetched = await license.fetchRevoked(licenseConfig.revocationUrl);
  if (fetched) revoked = fetched;
  const now = Date.now();
  const res = license.verify(token, { publicKey: PUBLIC_KEY, machine: MACHINE, now, revoked, lastSeen: settings.lastSeen });
  if (res.ok && now - settings.lastSeen > 60_000) {
    settings.lastSeen = Math.max(settings.lastSeen, now);
    secrets.save(settings);
  }
  return res;
}

// Ventana de activación. Resuelve con la licencia válida o con null si la persona sale sin activar.
function askLicense(reason) {
  return new Promise((resolve) => {
    licenseResolve = resolve;
    licenseWindow = new BrowserWindow({
      width: 560,
      height: 470,
      title: "Licencia",
      backgroundColor: "#0d0f14",
      autoHideMenuBar: true,
      resizable: false,
      webPreferences: { preload: path.join(__dirname, "preload-license.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false },
    });
    licenseWindow.loadFile(path.join(__dirname, "renderer", "license.html"));
    licenseWindow.licenseReason = reason;
    licenseWindow.on("closed", () => {
      licenseWindow = null;
      if (licenseResolve) licenseResolve(null);
      licenseResolve = null;
    });
  });
}

const fromLicenseWindow = (e) => licenseWindow && !licenseWindow.isDestroyed() && e.sender === licenseWindow.webContents;
ipcMain.handle("license:info", (e) => (fromLicenseWindow(e) ? { machine: MACHINE, reason: licenseWindow.licenseReason } : null));
ipcMain.handle("license:copy", (e, text) => {
  if (fromLicenseWindow(e) && text === MACHINE) clipboard.writeText(text);
});
ipcMain.handle("license:submit", async (e, token) => {
  if (!fromLicenseWindow(e)) return null;
  if (token === null) return licenseWindow.close();
  const res = await checkLicense(String(token));
  if (!res.ok) return { ok: false, reason: res.reason };
  settings.license = String(token).trim();
  secrets.save(settings);
  const resolve = licenseResolve;
  licenseResolve = null;
  licenseWindow.close();
  resolve?.(res);
  return { ok: true };
});

/** Pide licencia hasta que haya una válida. null = la persona salió sin activar. */
async function ensureLicense() {
  let res = await checkLicense();
  while (!res.ok) {
    res = await askLicense(settings.license ? res.reason : "Para usar la aplicación necesitas una licencia.");
    if (!res) return null;
  }
  return res;
}

function showLicense() {
  const { license: l, daysLeft } = currentLicense;
  dialog
    .showMessageBox({
      type: "info",
      title: "Licencia",
      message: `Usuario: ${l.user}`,
      detail: `Vence el ${new Date(l.exp * 1000).toLocaleDateString("es")} (${daysLeft} día${daysLeft === 1 ? "" : "s"}).\nEquipo: ${MACHINE}`,
      buttons: ["Cerrar", "Cambiar clave…"],
    })
    .then(async ({ response }) => {
      if (response !== 1) return;
      const next = await askLicense("Pega la nueva clave de licencia.");
      if (next) currentLicense = next;
    });
}

// Se revisa cada hora: si venció, se revocó o se tocó el reloj, la app se cierra.
function watchLicense() {
  setInterval(async () => {
    const res = await checkLicense();
    if (res.ok) {
      currentLicense = res;
      return;
    }
    dialog.showErrorBoxSync("KICK-CHAT-ULTIMATE", res.reason);
    app.quit();
  }, 3600_000).unref();
}

// ── Ciclo de vida ──────────────────────────────────────────────────────────

ipcMain.handle("setup:get", (e) => (e.senderFrame.url.startsWith("file:") ? settings : null));

ipcMain.handle("setup:save", async (e, values) => {
  if (!e.senderFrame.url.startsWith("file:")) return;
  settings = { ...settings, ...(values ?? {}), setupDone: true };
  secrets.save(settings);
  setupWindow?.close();
  if (values) {
    // Las claves llegan al servidor por entorno: hay que reiniciarlo para que las tome.
    restarting = true;
    await Promise.all([stopChild("servidor"), stopChild("pantalla")]);
    await startServices();
    restarting = false;
    setupSession();
    openMain("/");
  }
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("web-contents-created", (_e, wc) => lockDown(wc));
  app.on("second-instance", () => (mainWindow ? mainWindow.focus() : null));

  app.whenReady().then(async () => {
    try {
      settings = secrets.load();
      currentLicense = await ensureLicense();
      if (!currentLicense) return app.quit();
      watchLicense();
      await startServices();
    } catch (err) {
      dialog.showErrorBox("KICK-CHAT-ULTIMATE", String(err.message ?? err));
      return app.quit();
    }
    setupSession();
    buildMenu();
    openMain("/");
    if (!settings.setupDone) openSetup();
  });

  app.on("before-quit", async (e) => {
    if (quitting || children.size === 0) return;
    // Cierre ordenado: el servidor vuelca la base a disco y mata el pipeline antes de salir.
    e.preventDefault();
    quitting = true;
    await Promise.all([...children.keys()].map((n) => stopChild(n)));
    app.quit();
  });

  // Cerrar la ventana de licencia o de configuración antes de abrir el panel no debe cerrar la app.
  app.on("window-all-closed", () => {
    if (children.size > 0) app.quit();
  });
}
