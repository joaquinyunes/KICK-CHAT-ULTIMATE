// services/proxy-controller.ts - Peticiones salientes hacia Kick
/**
 * services/proxy-controller.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Actúa como el intermediario opaco hacia la API de Kick.
 *
 * FLUJO:
 *   1. Recibe (channel, message, userId) — datos limpios del controlador
 *   2. Obtiene un Bearer aleatorio de security.ts (nunca expuesto al cliente)
 *   3. Realiza el POST a la API de Kick con el Bearer en el header
 *   4. Retorna un resultado normalizado al controlador
 *
 * El cliente solo ve: { success: true } o { success: false, reason: "..." }
 * NUNCA ve el Bearer, la URL exacta ni los headers salientes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { env } from "../config/env";
import { getRandomBearer, decryptFromHex } from "./security";
import { stmts } from "../models/database";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ProxyRequest {
  channel: string;
  message: string;
  userId: number;
  /** Nombre del bot específico a usar (opcional) */
  botName?: string;
}

export interface ProxyResult {
  success: boolean;
  /** Solo presente si success === false */
  reason?: string;
  /** Timestamp de la petición (para logging interno) */
  sentAt: number;
}

// ─── Timeout de la petición saliente ─────────────────────────────────────────
const REQUEST_TIMEOUT_MS = 8_000;

// ─── Controller principal ─────────────────────────────────────────────────────

/**
 * Envía un mensaje al chat de Kick usando un Bearer aleatorio del pool.
 *
 * La selección aleatoria del Bearer distribuye la carga y reduce el riesgo
 * de ban de una única cuenta.
 */
export async function sendToKick(req: ProxyRequest): Promise<ProxyResult> {
  const sentAt = Date.now();

  // 1. Obtener Bearer
  let bearer: string;
  try {
    if (req.botName) {
      // Usar un bot específico asignado al usuario
      const bot = stmts.findBotByName.get(req.botName);
      if (!bot) {
        return { success: false, reason: `Bot "${req.botName}" no encontrado`, sentAt };
      }
      // Verificar que el usuario tenga asignado este bot
      const userBots = stmts.listBotsForUser.all(req.userId);
      const hasBot = userBots.some((b) => b.bot_name === req.botName);
      if (!hasBot) {
        return { success: false, reason: "No tienes este bot asignado", sentAt };
      }
      bearer = decryptFromHex(bot.encrypted_bearer);
    } else {
      // Fallback: bearer aleatorio del pool global
      bearer = getRandomBearer();
    }
  } catch (err) {
    console.error("[proxy-controller] Error al obtener Bearer:", err);
    return {
      success: false,
      reason:  "Error interno de configuración",
      sentAt,
    };
  }

  // 2. Construir el payload para Kick
  //    Ajusta los campos según la documentación real de la API de Kick
  const kickPayload = {
    channel:  req.channel,
    content:  req.message,
  };

  // 3. Realizar la petición con AbortController para timeout
  const controller = new AbortController();
  const timeoutId  = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(env.KICK_API_URL, {
      method:  "POST",
      signal:  controller.signal,
      headers: {
        "Authorization": `Bearer ${bearer}`,
        "Content-Type":  "application/json",
        "Accept":        "application/json",
        // User-Agent genérico para no revelar la infraestructura
        "User-Agent": "Mozilla/5.0 (compatible; StreamBridge/1.0)",
      },
      body: JSON.stringify(kickPayload),
    });

    clearTimeout(timeoutId);

    // 4. Evaluar respuesta de Kick
    if (response.ok) {
      console.log(
        `[proxy-controller] ✅ Mensaje enviado → channel=${req.channel} ` +
        `userId=${req.userId} status=${response.status}`
      );
      return { success: true, sentAt };
    }

    // Kick rechazó la petición (4xx / 5xx)
    const statusText = response.statusText || "Sin descripción";
    console.warn(
      `[proxy-controller] ⚠️  Kick rechazó el mensaje → ` +
      `status=${response.status} channel=${req.channel}`
    );

    // Mapear errores conocidos de Kick sin exponer detalles internos
    const clientReason = mapKickError(response.status, statusText);
    return { success: false, reason: clientReason, sentAt };

  } catch (err) {
    clearTimeout(timeoutId);

    if ((err as Error).name === "AbortError") {
      console.error(
        `[proxy-controller] ⏱  Timeout al contactar Kick (>${REQUEST_TIMEOUT_MS}ms)`
      );
      return {
        success: false,
        reason:  "El servicio no respondió a tiempo. Intenta nuevamente.",
        sentAt,
      };
    }

    console.error("[proxy-controller] Error de red:", err);
    return {
      success: false,
      reason:  "Error de conexión al enviar el mensaje",
      sentAt,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Traduce códigos HTTP de Kick a mensajes seguros para el cliente.
 * NO expone información sobre autenticación ni infraestructura.
 */
function mapKickError(status: number, _detail: string): string {
  switch (true) {
    case status === 429:
      return "Demasiadas peticiones. Espera un momento y reintenta.";
    case status >= 500:
      return "El servicio de chat no está disponible en este momento.";
    case status === 403:
      return "No tienes permiso para enviar mensajes en este canal.";
    case status === 404:
      return "El canal especificado no existe.";
    default:
      return "No se pudo enviar el mensaje. Inténtalo de nuevo.";
  }
}