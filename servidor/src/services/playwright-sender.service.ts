import { execSync } from "child_process";
import path from "path";
import { logger } from "../utils/logger";

const TAG = "playwright-sender";
const SCRIPT = path.resolve(process.cwd(), "send_to_kick_playwright.py");

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
      execSync('"' + exe + '" -c "import requests"', { timeout: 3000, encoding: "utf-8" });
      return exe;
    } catch {}
  }
  return "python";
}

const PYTHON = findPython();

export interface PlaywrightSendResult {
  success: boolean;
  reason?: string;
}

export function sendViaPlaywright(channel: string, message: string, cookies: any[], bearer?: string): PlaywrightSendResult {
  try {
    const cookiesB64 = Buffer.from(JSON.stringify(cookies)).toString("base64");
    const channelEsc = channel.replace(/"/g, '\\"');
    const msgEsc = message.replace(/"/g, '\\"');
    const bearerEsc = bearer ? bearer.replace(/"/g, '\\"') : "";
    const cmd = `"${PYTHON}" "${SCRIPT}" "${channelEsc}" "${msgEsc}" "${cookiesB64}" "${bearerEsc}"`;
    const out = execSync(cmd, { timeout: 20000, encoding: "utf-8" }).trim();
    const result = JSON.parse(out);
    if (result.status === 200) {
      logger.info(TAG, "Mensaje enviado por cookies", channel);
      return { success: true };
    }
    logger.warn(TAG, "Cookies fallo", "status=" + result.status, "body=" + (result.body || "").substring(0, 200));
    return { success: false, reason: result.body || "Error desconocido" };
  } catch (err: any) {
    logger.error(TAG, "Excepcion en cookies sender", err.message);
    return { success: false, reason: "Error enviando por cookies: " + err.message };
  }
}
