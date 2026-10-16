import { logger } from "../utils/logger";

/**
 * services/security.ts
 * Módulo de cifrado/descifrado AES-256-GCM.
 *
 * RESPONSABILIDAD ÚNICA: cifrar/descifrar secretos (tokens OAuth) con la
 * MASTER_KEY del entorno. El cliente NUNCA interactúa con este módulo.
 *
 * Formato binario: [12 bytes IV][16 bytes Auth Tag][N bytes ciphertext]
 */

import crypto from "crypto";
import { env } from "../config/env";

// Constantes del algoritmo
const ALGORITHM  = "aes-256-gcm" as const;
const IV_LENGTH  = 12;   // 96 bits — recomendado para GCM
const TAG_LENGTH = 16;   // 128 bits

// ─── Cifrado ───────────────────────────────

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