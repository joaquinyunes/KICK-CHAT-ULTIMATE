/**
 * services/auth-manager.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Gestiona el ciclo completo de autenticación:
 *   · Registro de usuarios (hash bcrypt de contraseñas)
 *   · Login con validación de credenciales
 *   · Emisión de JWT con expiración fija de 24 horas
 *   · Log de actividad (éxitos y fallos)
 *
 * El cliente SOLO recibe el JWT; nunca expone password_hash ni datos internos.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import bcrypt from "bcryptjs";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { env } from "../config/env";
import { stmts, type UserRow } from "../models/database";

// ─── Tipos públicos ────────────────────────────────────────────────────────────

export interface AuthResult {
  token: string;
  expiresAt: number; // Unix timestamp en segundos
}

export interface TokenPayload extends JwtPayload {
  sub: string;       // user ID (string por convención JWT)
  username: string;
}

// ─── Constantes ────────────────────────────────────────────────────────────────

const BCRYPT_ROUNDS   = 12;
const JWT_EXPIRY_SECS = 24 * 60 * 60; // 24 horas en segundos

// ─── Registro ─────────────────────────────────────────────────────────────────

/**
 * Registra un nuevo usuario.
 * @throws Si el username ya existe en la base de datos.
 */
export async function registerUser(
  username: string,
  password: string
): Promise<{ id: number; username: string }> {
  const existing = stmts.findUserByUsername.get(username);
  if (existing) {
    throw new Error(`El usuario '${username}' ya existe`);
  }

  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const result = stmts.insertUser.run({ username, password_hash });
  const newId  = result.lastInsertRowid as number;

  console.log(`[auth-manager] Usuario registrado → id=${newId} username=${username}`);
  return { id: newId, username };
}

// ─── Login ────────────────────────────────────────────────────────────────────

/**
 * Valida credenciales y emite un JWT de 24 horas.
 *
 * @throws Si las credenciales son inválidas o el usuario no existe.
 */
export async function loginUser(
  username: string,
  password: string,
  ipAddress?: string
): Promise<AuthResult> {
  const user = stmts.findUserByUsername.get(username) as UserRow | undefined;

  // Comparamos siempre para evitar timing attacks (no romper el flujo early)
  const dummyHash =
    "$2a$12$invalidhashtopreventtimingattacksxxxxxxxxxxxxxxxxxxxxxx";

  const isValid = user
    ? await bcrypt.compare(password, user.password_hash)
    : await bcrypt.compare(password, dummyHash).then(() => false);

  if (!user || !isValid) {
    // Log del intento fallido si el usuario existe
    if (user) {
      stmts.insertLog.run({
        user_id:    user.id,
        action:     "login_failed",
        ip_address: ipAddress ?? null,
        meta:       null,
      });
    }
    throw new Error("Credenciales inválidas");
  }

  // Emitir JWT
  const now       = Math.floor(Date.now() / 1000);
  const expiresAt = now + JWT_EXPIRY_SECS;

  const payload: TokenPayload = {
    sub:      String(user.id),
    username: user.username,
    iat:      now,
    exp:      expiresAt,       // Expiración FIJA de 24 horas
  };

  const token = jwt.sign(payload, env.JWT_SECRET);

  // Log del login exitoso
  stmts.insertLog.run({
    user_id:    user.id,
    action:     "login",
    ip_address: ipAddress ?? null,
    meta:       JSON.stringify({ expiresAt }),
  });

  console.log(
    `[auth-manager] Login exitoso → username=${username} exp=${new Date(expiresAt * 1000).toISOString()}`
  );

  return { token, expiresAt };
}

// ─── Verificación de Token ────────────────────────────────────────────────────

/**
 * Verifica y decodifica un JWT.
 * @throws Si el token es inválido, expiró o fue manipulado.
 */
export function verifyToken(token: string): TokenPayload {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    return payload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new Error("Token expirado. Por favor inicia sesión nuevamente");
    }
    throw new Error("Token inválido");
  }
}

// ─── Log de actividad ─────────────────────────────────────────────────────────

/**
 * Registra una acción de chat en el log de actividad.
 */
export function logChatActivity(
  userId: number,
  channel: string,
  ipAddress?: string
): void {
  stmts.insertLog.run({
    user_id:    userId,
    action:     "chat_send",
    ip_address: ipAddress ?? null,
    meta:       JSON.stringify({ channel }),
  });
}