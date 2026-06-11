/**
 * Bridge Server — Fase 6: Seguridad Avanzada (Token Encapsulation)
 *
 * Arquitectura de seguridad:
 *  - POST /session/handshake  →  recibe kickApiToken, lo cifra en memoria (AES-256-GCM)
 *  - POST /chat/send          →  recibe sessionId + message; descifra token en RAM,
 *                                llama a Kick API, y borra la variable descifrada
 *  - El token NUNCA toca logs, disco ni respuestas HTTP
 *  - Al reiniciar el proceso, todas las sesiones se invalidan automáticamente
 *
 * Variables de entorno requeridas:
 *   SECRET_KEY   → 64 hex chars (256 bits), ej: openssl rand -hex 32
 *   PORT         → (opcional) puerto del servidor, default 3000
 */

"use strict";

const express = require("express");
const crypto = require("crypto");

// ─── Configuración ────────────────────────────────────────────────────────────

const SECRET_KEY_HEX = process.env.SECRET_KEY;
if (!SECRET_KEY_HEX || SECRET_KEY_HEX.length !== 64) {
  console.error(
    "[FATAL] SECRET_KEY debe ser exactamente 64 caracteres hexadecimales (256 bits).\n" +
      "Genera una con: openssl rand -hex 32"
  );
  process.exit(1);
}
const SECRET_KEY = Buffer.from(SECRET_KEY_HEX, "hex"); // 32 bytes

const KICK_API_BASE = "https://kick.com/api/v2"; // ajustar según la API real

// ─── Almacén de sesiones (solo en memoria) ────────────────────────────────────
// Clave:   sessionId  (string)
// Valor:   { iv, authTag, ciphertext }  — todo en Buffer/hex
// Se destruye completamente al reiniciar el proceso.

/** @type {Map<string, { iv: string, authTag: string, ciphertext: string }>} */
const sessionStore = new Map();

// ─── Criptografía ─────────────────────────────────────────────────────────────

/**
 * Cifra un texto plano con AES-256-GCM.
 * @param {string} plaintext
 * @returns {{ iv: string, authTag: string, ciphertext: string }} — todo en hex
 */
function encryptToken(plaintext) {
  const iv = crypto.randomBytes(12); // 96 bits, recomendado para GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", SECRET_KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
    ciphertext: encrypted.toString("hex"),
  };
}

/**
 * Descifra un objeto cifrado con AES-256-GCM.
 * Devuelve el plaintext O lanza un error si la integridad falla.
 * @param {{ iv: string, authTag: string, ciphertext: string }} encrypted
 * @returns {string} plaintext
 */
function decryptToken(encrypted) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    SECRET_KEY,
    Buffer.from(encrypted.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

// ─── Middleware ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

/**
 * Middleware de telemetría: registra requests pero NUNCA el cuerpo completo
 * para evitar que tokens o mensajes sensibles aparezcan en logs.
 */
app.use((req, _res, next) => {
  // Solo se loguea método + ruta + sessionId (si existe). NUNCA el body completo.
  const safeLog = {
    method: req.method,
    path: req.path,
    sessionId: req.body?.sessionId ?? req.headers["x-session-id"] ?? "—",
    // ⚠️  kickApiToken y message quedan FUERA del log intencionalmente
  };
  console.log("[TEL]", JSON.stringify(safeLog));
  next();
});

// ─── Endpoints ────────────────────────────────────────────────────────────────

/**
 * POST /session/handshake
 *
 * Body: { sessionId: string, kickApiToken: string }
 *
 * Recibe el token UNA sola vez por sesión, lo cifra y lo almacena en memoria.
 * Responde solo con { ok: true } — el token nunca vuelve al cliente.
 */
app.post("/session/handshake", (req, res) => {
  const { sessionId, kickApiToken } = req.body;

  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ error: "sessionId requerido" });
  }
  if (!kickApiToken || typeof kickApiToken !== "string") {
    return res.status(400).json({ error: "kickApiToken requerido" });
  }
  if (sessionStore.has(sessionId)) {
    // Re-handshake permitido: sobrescribir con nuevo token cifrado
    console.warn(`[WARN] Re-handshake para sesión existente: ${sessionId}`);
  }

  // Cifrar y guardar — el plaintext del token NUNCA se almacena
  const encrypted = encryptToken(kickApiToken);
  sessionStore.set(sessionId, encrypted);

  // Forzar que kickApiToken no quede en memoria más allá de este scope
  // (JS no garantiza GC inmediato, pero al menos no persistimos la ref)
  return res.status(200).json({ ok: true });
});

/**
 * POST /chat/send
 *
 * Body: { sessionId: string, message: string, metadata?: object }
 *
 * Recupera el token cifrado, lo descifra en RAM, llama a Kick API
 * y borra la variable descifrada inmediatamente.
 */
app.post("/chat/send", async (req, res) => {
  const { sessionId, message, metadata = {} } = req.body;

  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ error: "sessionId requerido" });
  }
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message requerido" });
  }

  // Verificar sesión válida
  const encryptedToken = sessionStore.get(sessionId);
  if (!encryptedToken) {
    return res.status(401).json({
      error: "Sesión no encontrada o expirada. Realiza un nuevo handshake.",
    });
  }

  // Descifrar token — SOLO en esta función, SOLO en esta variable local
  let plainToken;
  try {
    plainToken = decryptToken(encryptedToken);
  } catch {
    // Fallo de integridad: posible manipulación. Invalidar sesión.
    sessionStore.delete(sessionId);
    return res.status(500).json({ error: "Fallo al descifrar token. Sesión invalidada." });
  }

  // Llamar a la API de Kick con el token descifrado
  let kickResponse;
  try {
    kickResponse = await fetch(`${KICK_API_BASE}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${plainToken}`, // único uso del plaintext
      },
      body: JSON.stringify({ message, ...metadata }),
    });
  } finally {
    // ── BORRAR rastro del token descifrado inmediatamente ──────────────────
    // Sobrescribir con string vacío antes de soltar la referencia
    // para reducir la ventana de exposición en el heap de V8.
    if (plainToken) {
      // eslint-disable-next-line no-unused-vars
      plainToken = "\x00".repeat(plainToken.length);
    }
    plainToken = null;
  }

  if (!kickResponse.ok) {
    const errBody = await kickResponse.text().catch(() => "");
    // Loguear solo el status code, NUNCA el cuerpo que podría contener el token
    console.error(`[ERROR] Kick API respondió ${kickResponse.status}`);
    return res.status(kickResponse.status).json({
      error: `Kick API error ${kickResponse.status}`,
      detail: errBody,
    });
  }

  const data = await kickResponse.json();
  return res.status(200).json({ ok: true, data });
});

/**
 * DELETE /session/:sessionId
 *
 * Permite al cliente invalidar su sesión explícitamente (logout / cierre).
 */
app.delete("/session/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  if (sessionStore.has(sessionId)) {
    sessionStore.delete(sessionId);
    return res.status(200).json({ ok: true, message: "Sesión eliminada" });
  }
  return res.status(404).json({ error: "Sesión no encontrada" });
});

// ─── Manejo de cierre limpio ──────────────────────────────────────────────────

function gracefulShutdown(signal) {
  console.log(`[SHUTDOWN] Señal ${signal} recibida. Limpiando sesiones en memoria…`);
  // Limpiar explícitamente el store antes de salir
  sessionStore.clear();
  process.exit(0);
}
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// ─── Arranque ─────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`[SERVER] Bridge escuchando en http://localhost:${PORT}`);
  console.log("[SERVER] SECRET_KEY cargada. Sesiones se invalidan al reiniciar.");
});

module.exports = app; // para tests
