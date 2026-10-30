#!/usr/bin/env node
// Herramienta de administración de licencias (solo para ti; NO se incluye en el instalador).
//
//   node admin/license.mjs keygen                                  crea el par de claves (una sola vez)
//   node admin/license.mjs issue --user ANA --machine XXXXX-XXXXX-XXXXX-XXXXX --days 30
//   node admin/license.mjs renew --id <id> --days 30               nueva clave para el mismo usuario y equipo
//   node admin/license.mjs list                                    todas las licencias y cuántos días les quedan
//   node admin/license.mjs revoke --id <id>                        corta una licencia antes de que venza
//   node admin/license.mjs export-revoked [archivo]                escribe revoked.json para publicarlo
//
// La clave privada y el registro viven en ~/.kcu-license (o KCU_LICENSE_HOME), fuera del repositorio.
// Haz copia de esa carpeta: sin la clave privada no puedes emitir licencias para las builds ya repartidas.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { sign } = require("../src/license.js");

const HOME = process.env.KCU_LICENSE_HOME ?? path.join(os.homedir(), ".kcu-license");
const PRIVATE = path.join(HOME, "private.pem");
const REGISTRY = path.join(HOME, "licenses.json");
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "license-public.pem");
const MACHINE_RE = /^[0-9A-F]{5}(-[0-9A-F]{5}){3}$/;

const [command, ...rest] = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[++i];
  else positional.push(rest[i]);
}

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};
const load = () => (fs.existsSync(REGISTRY) ? JSON.parse(fs.readFileSync(REGISTRY, "utf8")) : { licenses: [] });
const save = (reg) => {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(REGISTRY, JSON.stringify(reg, null, 2));
};
const privateKey = () => (fs.existsSync(PRIVATE) ? fs.readFileSync(PRIVATE, "utf8") : die(`No hay clave privada en ${PRIVATE}. Ejecuta primero: keygen`));
const day = (sec) => new Date(sec * 1000).toLocaleDateString("es");

function issue({ user, machine, days, id = crypto.randomBytes(6).toString("hex") }) {
  const n = Number(days);
  if (!user) die("Falta --user");
  if (!MACHINE_RE.test(machine ?? "")) die("--machine debe ser el ID que muestra la app (XXXXX-XXXXX-XXXXX-XXXXX)");
  if (!Number.isInteger(n) || n < 1 || n > 3650) die("--days debe ser un entero entre 1 y 3650");
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + n * 86400;
  const token = sign({ id, user, machine, iat, exp }, privateKey());
  const reg = load();
  reg.licenses.push({ id, user, machine, iat, exp, revoked: false });
  save(reg);
  console.log(`\nLicencia ${id} para ${user}: ${n} días (vence el ${day(exp)})\n\n${token}\n\nEntrega esa clave a la persona (ella la pega en la ventana de licencia).`);
}

switch (command) {
  case "keygen": {
    if (fs.existsSync(PRIVATE) && flags.force === undefined) die(`Ya existe ${PRIVATE}. Si lo regeneras, las builds ya repartidas dejan de aceptar tus licencias (usa --force bajo tu responsabilidad).`);
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(PRIVATE, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    fs.writeFileSync(PUBLIC, publicKey.export({ type: "spki", format: "pem" }));
    console.log(`Clave privada: ${PRIVATE}  (guárdala, no la subas a ningún sitio)\nClave pública: ${PUBLIC}  (va dentro de la app; vuelve a compilar la app si la cambias)`);
    break;
  }
  case "issue":
    issue(flags);
    break;
  case "renew": {
    const old = load().licenses.find((l) => l.id === flags.id);
    if (!old) die("No existe esa licencia (usa list).");
    issue({ user: old.user, machine: old.machine, days: flags.days });
    break;
  }
  case "list": {
    const now = Math.floor(Date.now() / 1000);
    const rows = load().licenses.map((l) => ({
      id: l.id,
      usuario: l.user,
      equipo: l.machine,
      vence: day(l.exp),
      estado: l.revoked ? "revocada" : l.exp <= now ? "vencida" : `${Math.ceil((l.exp - now) / 86400)} días`,
    }));
    console.table(rows);
    break;
  }
  case "revoke": {
    const reg = load();
    const lic = reg.licenses.find((l) => l.id === flags.id);
    if (!lic) die("No existe esa licencia (usa list).");
    lic.revoked = true;
    save(reg);
    console.log(`Licencia ${lic.id} (${lic.user}) revocada. Surte efecto en las apps cuando lean el revoked.json publicado (ver export-revoked).`);
    break;
  }
  case "export-revoked": {
    const out = positional[0] ?? "revoked.json";
    fs.writeFileSync(out, JSON.stringify({ revoked: load().licenses.filter((l) => l.revoked).map((l) => l.id) }, null, 2));
    console.log(`Escrito ${out}. Publícalo en la URL que configuraste como revocationUrl.`);
    break;
  }
  default:
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 11).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
}
