// Secretos y ajustes de la app. Todo se guarda cifrado con DPAPI (Electron safeStorage) en el perfil
// del usuario de Windows: nada de esto viaja dentro del instalador ni queda en un .env en claro.
const { app, safeStorage } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const FILE = () => path.join(app.getPath("userData"), "secrets.bin");

const hex = (n) => crypto.randomBytes(n).toString("hex");

function defaults() {
  return {
    masterKey: hex(32),
    jwtSecret: hex(32),
    adminSecret: hex(24),
    adminPassword: crypto.randomBytes(15).toString("base64url"),
    setupDone: false,
    kickClientId: "",
    kickClientSecret: "",
    openrouterKey: "",
    geminiKey: "",
    channelSlug: "",
    pipelineEnabled: false,
    license: "",
    lastSeen: 0,
  };
}

function load() {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("El cifrado del sistema (DPAPI) no está disponible.");
  let stored = {};
  try {
    stored = JSON.parse(safeStorage.decryptString(fs.readFileSync(FILE())));
  } catch {
    // primera vez, o archivo ilegible (otro usuario de Windows): se generan secretos nuevos
  }
  const merged = { ...defaults(), ...stored };
  if (!fs.existsSync(FILE())) save(merged);
  return merged;
}

function save(values) {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), safeStorage.encryptString(JSON.stringify(values)));
}

module.exports = { load, save };
