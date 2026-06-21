// services/security.ts - Cifrado AES-256-GCM y lectura de bearers.enc
/**
 * services/security.ts
 * Módulo de cifrado/descifrado AES-256-GCM.
 *
 * RESPONSABILIDAD ÚNICA: leer y descifrar `bearers.enc` usando la
 * MASTER_KEY del entorno. El cliente NUNCA interactúa con este módulo.
 *
 * Formato del archivo .enc (binario):
 *   [12 bytes IV][16 bytes Auth Tag][N bytes ciphertext]
 *
 * Para GENERAR bearers.enc usa el script: scripts/encrypt-bearers.ts
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { env } from "../config/env";

// Constantes del algoritmo
const ALGORITHM  = "aes-256-gcm" as const;
const IV_LENGTH  = 12;   // 96 bits — recomendado para GCM
const TAG_LENGTH = 16;   // 128 bits

const BEARERS_PATH = path.resolve(process.cwd(), "bearers.enc");

// Cache en memoria: los bearers se descifran una sola vez al arrancar
let _bearersCache: string[] | null = null;

// ─── Cifrado (usado solo por el script de setup) ───────────────────────────────

/**
 * Cifra un texto plano con AES-256-GCM.
 * @returns Buffer con formato [IV][Tag][Ciphertext]
 */
export function encrypt(plaintext: string): Buffer {
  const key = Buffer.from(env.MASTER_KEY.substring(0, 64), "hex");
  const iv  = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Layout: [IV(12)][Tag(16)][Ciphertext]
  return Buffer.concat([iv, authTag, encrypted]);
}

// ─── Descifrado ────────────────────────────────────────────────────────────────

/**
 * Descifra un Buffer con formato [IV][Tag][Ciphertext].
 * Lanza un error si la autenticación falla (datos manipulados).
 */
export function decrypt(data: Buffer): string {
  const key        = Buffer.from(env.MASTER_KEY.substring(0, 64), "hex");
  const iv         = data.subarray(0, IV_LENGTH);
  const authTag    = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });

  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    // No revelar detalles internos al exterior
    throw new Error("Descifrado fallido: integridad comprometida o clave incorrecta");
  }
}

// ─── Carga de Bearers ──────────────────────────────────────────────────────────

/**
 * Lee, descifra y cachea la lista de Bearers desde `bearers.enc`.
 * Solo se ejecuta una vez por ciclo de vida del proceso.
 *
 * El archivo .enc contiene un JSON array:
 *   ["bearer_token_1", "bearer_token_2", ...]
 */
export function loadBearers(): string[] {
  if (_bearersCache) return _bearersCache;

  if (!fs.existsSync(BEARERS_PATH)) {
    throw new Error(
      `No se encontró ${BEARERS_PATH}. ` +
      "Genera el archivo con: npm run encrypt-bearers"
    );
  }

  const encryptedData = fs.readFileSync(BEARERS_PATH);
  const plaintext     = decrypt(encryptedData);

  let bearers: unknown;
  try {
    bearers = JSON.parse(plaintext);
  } catch {
    throw new Error("bearers.enc contiene JSON inválido tras descifrar");
  }

  if (
    !Array.isArray(bearers) ||
    bearers.length === 0 ||
    bearers.some((b) => typeof b !== "string")
  ) {
    throw new Error("bearers.enc debe contener un array de strings no vacío");
  }

  _bearersCache = bearers as string[];
  console.log(`✅  ${_bearersCache.length} bearer(s) cargado(s) en memoria`);
  return _bearersCache;
}

/**
 * Invalida el cache de bearers (útil para hot-reload en desarrollo).
 */
export function invalidateBearersCache(): void {
  _bearersCache = null;
}

/**
 * Retorna un Bearer aleatorio de la lista en cache.
 * Llama a loadBearers() si el cache está vacío.
 * Retorna undefined si bearers.enc no existe o está vacío.
 */
export function getRandomBearer(): string | undefined {
  let bearers: string[];
  try {
    bearers = loadBearers();
  } catch {
    return undefined;
  }
  if (bearers.length === 0) return undefined;
  const idx = crypto.randomInt(0, bearers.length);
  return bearers[idx];
}

// ─── Helpers para almacenar tokens cifrados en DB ────────────────────────────

/**
 * Cifra un texto y devuelve una cadena hex para almacenar en DB.
 */
export function encryptToHex(plaintext: string): string {
  return encrypt(plaintext).toString("hex");
}

function tryDecryptWithKey(hex: string, keyHex?: string): string {
  const key = keyHex
    ? Buffer.from(keyHex.substring(0, 64), "hex")
    : Buffer.from(env.MASTER_KEY, "utf8");
  const data = Buffer.from(hex, "hex");
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Descifra una cadena hex (previamente cifrada con encryptToHex).
 * Compatibilidad hacia atras: si falla con la clave nueva (hex),
 * reintenta con la clave vieja (UTF-8) para tokens pre-fix.
 */
export function decryptFromHex(hex: string): string {
  if (!hex) return "";
  try {
    return tryDecryptWithKey(hex, env.MASTER_KEY);
  } catch {
    try {
      return tryDecryptWithKey(hex);
    } catch {
      throw new Error("Descifrado fallido: integridad comprometida o clave incorrecta");
    }
  }
}