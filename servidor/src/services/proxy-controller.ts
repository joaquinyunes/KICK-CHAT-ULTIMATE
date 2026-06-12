import { execSync } from "child_process";
import { getRandomBearer, decryptFromHex } from "./security";
import { stmts } from "../models/database";
import path from "path";
import { getBotAccessToken, sendViaOfficialApi } from "./kick-oauth";

function logMessage(botId: number | null, userId: number, channel: string, message: string, success: boolean, errorReason?: string): void {
  try {
    stmts.insertMessageLog.run({
      bot_id: botId,
      user_id: userId,
      channel,
      message_preview: message.substring(0, 100),
      success: success ? 1 : 0,
      error_reason: errorReason || null,
    });
  } catch {}
}

export interface ProxyRequest {
  channel: string;
  message: string;
  userId: number;
  botName?: string;
  chatroomId?: number;
}

export interface ProxyResult {
  success: boolean;
  reason?: string;
  sentAt: number;
}

const SCRIPT = path.resolve(process.cwd(), "send_to_kick.py");

const PYTHON_CANDIDATES = [
  process.env.PYTHON_PATH,
  "C:\\Users\\joaqii\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe",
  "python",
  "python3",
  "py",
].filter(Boolean) as string[];

function findPython(): string {
  for (const exe of PYTHON_CANDIDATES) {
    try {
      execSync(`"${exe}" -c "import tls_client"`, { timeout: 3000, encoding: "utf-8" });
      return exe;
    } catch {}
  }
  return "python";
}

const PYTHON = findPython();

function pyExec(...args: string[]): { status: number; body: string } {
  const escaped = args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(" ");
  const cmd = `"${PYTHON}" "${SCRIPT}" ${escaped}`;
  const out = execSync(cmd, { timeout: 15000, encoding: "utf-8" }).trim();
  return JSON.parse(out);
}

async function getBot(req: ProxyRequest): Promise<{ bearer?: string; botId?: number }> {
  try {
    const userBots = stmts.listBotsForUser.all(req.userId);
    if (userBots.length > 0) {
      const bot = userBots[Math.floor(Math.random() * userBots.length)];
      return { bearer: decryptFromHex(bot.encrypted_bearer), botId: bot.id };
    }
    if (req.botName) {
      const bot = stmts.findBotByName.get(req.botName);
      if (!bot) return {};
      return { bearer: decryptFromHex(bot.encrypted_bearer), botId: bot.id };
    }
    return { bearer: getRandomBearer() };
  } catch (err) {
    console.error("[proxy-controller] Error al obtener bot:", err);
    return {};
  }
}

export async function sendToKick(req: ProxyRequest): Promise<ProxyResult> {
  const sentAt = Date.now();

  const { bearer, botId } = await getBot(req);
  if (!bearer && !botId) {
    return { success: false, reason: "Error interno de configuración", sentAt };
  }

  // ── Intentar OAuth oficial primero ──
  if (botId) {
    const accessToken = await getBotAccessToken(botId);
    if (accessToken) {
      const result = await sendViaOfficialApi(accessToken, req.message);
      if (result.ok) {
        console.log(`[proxy-controller] Oficial OK → channel=${req.channel}`);
        logMessage(botId, req.userId, req.channel, req.message, true);
        return { success: true, sentAt };
      }
      logMessage(botId, req.userId, req.channel, req.message, false, `OAuth ${result.status}`);
      console.warn(`[proxy-controller] Oficial falló (${result.status}), intentando Python...`);
    }
  }

  // ── Fallback: Python con bearer ──
  if (!bearer) {
    logMessage(null, req.userId, req.channel, req.message, false, "No token");
    return { success: false, reason: "No hay token disponible para enviar", sentAt };
  }

  const chatroomId = req.chatroomId ?? await getChatroomId(bearer, req.channel);
  if (!chatroomId) {
    console.warn(`[proxy-controller] No se pudo obtener chatroomId para channel=${req.channel}`);
    logMessage(null, req.userId, req.channel, req.message, false, "No chatroomId");
    return { success: false, reason: "El canal no existe o no se pudo verificar", sentAt };
  }

  try {
    const result = pyExec("send", bearer, String(chatroomId), req.message);
    if (result.status === 200) {
      console.log(`[proxy-controller] Python OK → channel=${req.channel}`);
      logMessage(botId, req.userId, req.channel, req.message, true);
      return { success: true, sentAt };
    }
    console.warn(`[proxy-controller] Kick rechazó → status=${result.status} body=${(result.body || "").substring(0, 200)}`);
    logMessage(botId, req.userId, req.channel, req.message, false, mapKickError(result.status));
    return { success: false, reason: mapKickError(result.status), sentAt };
  } catch (err: any) {
    console.error("[proxy-controller] Error Python:", err.message);
    logMessage(null, req.userId, req.channel, req.message, false, "Python error");
    return { success: false, reason: "Error al enviar el mensaje", sentAt };
  }
}

async function getChatroomId(bearer: string, channel: string): Promise<number | null> {
  try {
    const result = pyExec("chatroom", bearer, channel);
    if (result.status !== 200) return null;
    const data = JSON.parse(result.body);
    return data?.chatroom?.id ?? null;
  } catch {
    return null;
  }
}

function mapKickError(status: number): string {
  switch (true) {
    case status === 429: return "Demasiadas peticiones. Esperá un momento.";
    case status >= 500: return "El servicio de chat no está disponible.";
    case status === 403: return "No tenés permiso para enviar mensajes en este canal.";
    case status === 404: return "El canal especificado no existe.";
    default: return "No se pudo enviar el mensaje. Intentalo de nuevo.";
  }
}
