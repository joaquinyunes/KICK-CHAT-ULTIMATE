// Licencias firmadas (Ed25519), sin servidor. Formato de la clave:
//
//   KCU1.<payload base64url>.<firma base64url>
//   payload = { v, id, user, machine, iat, exp }      (iat/exp en segundos Unix)
//
// La clave privada solo la tiene el administrador (desktop/admin/license.mjs); la app lleva la pública, así que puede
// comprobar una licencia pero no fabricar otra. Cada licencia va atada al equipo (`machine`) para que no se pueda pasar
// a otra persona.
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const PREFIX = "KCU1";
const CLOCK_SKEW_MS = 24 * 3600 * 1000; // tolerancia al retroceso del reloj

const b64 = (buf) => Buffer.from(buf).toString("base64url");

/** Identificador del equipo: hash del MachineGuid de Windows, con grupos legibles (XXXXX-XXXXX-XXXXX-XXXXX). */
function machineId() {
  let guid = "";
  try {
    const out = execFileSync("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { encoding: "utf8", windowsHide: true });
    guid = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out)?.[1] ?? "";
  } catch {
    /* se cae al respaldo de abajo */
  }
  if (!guid) guid = `${process.env.COMPUTERNAME ?? ""}|${process.env.USERNAME ?? ""}`;
  const hex = crypto.createHash("sha256").update(`kcu-machine|${guid}`).digest("hex").slice(0, 20).toUpperCase();
  return hex.match(/.{5}/g).join("-");
}

/** Firma una licencia. Solo la usa la herramienta de administración. */
function sign(payload, privateKeyPem) {
  const body = b64(JSON.stringify({ v: 1, ...payload }));
  const signature = crypto.sign(null, Buffer.from(`${PREFIX}.${body}`), privateKeyPem);
  return `${PREFIX}.${body}.${b64(signature)}`;
}

/**
 * Comprueba una licencia. Devuelve { ok:true, license, daysLeft } o { ok:false, reason, code }.
 *   revoked  Set de ids revocados (puede estar vacío)
 *   lastSeen última hora (ms) en la que se vio funcionar la app: detecta que se atrase el reloj para alargar la licencia
 */
function verify(token, { publicKey, machine = machineId(), now = Date.now(), revoked = new Set(), lastSeen = 0 } = {}) {
  const fail = (code, reason) => ({ ok: false, code, reason });
  const parts = String(token ?? "").trim().split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return fail("format", "La clave no tiene un formato válido.");
  let payload;
  try {
    const valid = crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], "base64url"));
    if (!valid) return fail("signature", "La clave no es auténtica.");
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return fail("format", "La clave no tiene un formato válido.");
  }
  if (payload.machine !== machine) return fail("machine", "Esta licencia es de otro equipo.");
  if (revoked.has(payload.id)) return fail("revoked", "La licencia fue revocada.");
  if (lastSeen && now < lastSeen - CLOCK_SKEW_MS) return fail("clock", "El reloj del equipo está atrasado. Corrígelo para continuar.");
  const expMs = Number(payload.exp) * 1000;
  if (!Number.isFinite(expMs) || now >= expMs) return fail("expired", `La licencia venció el ${new Date(expMs).toLocaleDateString("es")}.`);
  return { ok: true, license: payload, daysLeft: Math.ceil((expMs - now) / 86_400_000) };
}

/** Lista de ids revocados publicada por el administrador ({"revoked":["id",...]}). Sin red o con error: se ignora. */
async function fetchRevoked(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return new Set(Array.isArray(json.revoked) ? json.revoked.map(String) : []);
  } catch {
    return null;
  }
}

module.exports = { machineId, sign, verify, fetchRevoked };
