import { spawnSync } from "child_process";
import path from "path";
import { logger } from "../utils/logger";
import { findPython } from "../utils/python";

const TAG = "playwright-sender";
const SCRIPT = path.resolve(process.cwd(), "send_to_kick_playwright.py");

const PYTHON = findPython("requests");

export interface PlaywrightSendResult {
  success: boolean;
  reason?: string;
}

export function sendViaPlaywright(channel: string, message: string, cookies: any[], bearer?: string): PlaywrightSendResult {
  try {
    const cookiesB64 = Buffer.from(JSON.stringify(cookies)).toString("base64");
    const args = [SCRIPT, channel, message, cookiesB64, bearer || ""];
    const result = spawnSync(PYTHON, args, { timeout: 20000, encoding: "utf-8" });
    if (result.error) throw result.error;
    const out = result.stdout?.trim() || "";
    if (!out) throw new Error("No output from script");
    const parsed = JSON.parse(out);
    if (parsed.status === 200) {
      logger.info(TAG, "Mensaje enviado por cookies", channel);
      return { success: true };
    }
    logger.warn(TAG, "Cookies fallo", "status=" + parsed.status, "body=" + (parsed.body || "").substring(0, 200));
    return { success: false, reason: parsed.body || "Error desconocido" };
  } catch (err: any) {
    logger.error(TAG, "Excepcion en cookies sender", err.message);
    return { success: false, reason: "Error enviando por cookies: " + err.message };
  }
}
