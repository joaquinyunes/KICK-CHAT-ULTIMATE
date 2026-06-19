import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { stmts, type ClientVodRow } from "../models/database";
import { getRandomActiveProxy } from "./proxy-manager.service";

interface ViewerInstance {
  process: ChildProcess;
  userId: number;
  status: "running" | "stopped" | "error";
  viewsGenerated: number;
  viewsFailed: number;
  startedAt: number;
  hourlyLimit: number;
}

const viewers = new Map<number, ViewerInstance>();

function getDbPath(): string {
  return path.resolve(process.cwd(), "data", "streamchat.db");
}

function parseLine(instance: ViewerInstance, line: string): void {
  try {
    const data = JSON.parse(line);
    switch (data.type) {
      case "start":
        instance.status = "running";
        break;
      case "view_ok":
        instance.viewsGenerated = data.total ?? instance.viewsGenerated + 1;
        break;
      case "view_fail":
        instance.viewsFailed = data.failed ?? instance.viewsFailed + 1;
        break;
      case "paused":
        // hourly limit reached, normal
        break;
      case "warn":
        console.warn("[vod-viewer]", data.message);
        break;
      case "error":
        console.error("[vod-viewer]", data.message);
        instance.status = "error";
        break;
      case "stopped":
        instance.status = "stopped";
        break;
    }
  } catch { /* ignore malformed lines */ }
}

export function startViewer(userId: number): { success: boolean; error?: string } {
  if (viewers.has(userId)) {
    const existing = viewers.get(userId)!;
    if (existing.status === "running") {
      return { success: false, error: "Ya hay un visor corriendo para este usuario" };
    }
    // Clean up stopped/error instances
    if (existing.process && existing.process.exitCode === null) {
      existing.process.kill("SIGTERM");
    }
    viewers.delete(userId);
  }

  const user = stmts.findUserById.get([userId]);
  if (!user) return { success: false, error: "Usuario no encontrado" };
  if (user.role !== "client") return { success: false, error: "No es un cliente" };

  const hourlyLimit = user.hourly_view_limit ?? 50;
  const vods = stmts.listActiveClientVods.all([userId]);
  if (vods.length === 0) return { success: false, error: "El cliente no tiene VODs activos" };

  const dbPath = getDbPath();
  const scriptPath = path.join(__dirname, "..", "vod_viewer_worker.py");
  const config = JSON.stringify({ user_id: userId, hourly_limit: hourlyLimit, db_path: dbPath });

  const child = spawn("python", [scriptPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  const instance: ViewerInstance = {
    process: child,
    userId,
    status: "running",
    viewsGenerated: 0,
    viewsFailed: 0,
    startedAt: Math.floor(Date.now() / 1000),
    hourlyLimit,
  };

  child.stdout!.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      parseLine(instance, line);
    }
  });

  child.stderr!.on("data", (data: Buffer) => {
    console.error("[vod-viewer:stderr]", data.toString());
  });

  child.on("exit", (code) => {
    instance.status = "stopped";
    console.log(`[vod-viewer] Proceso terminado para user ${userId}, código ${code}`);
  });

  child.on("error", (err) => {
    instance.status = "error";
    console.error("[vod-viewer] Error al iniciar proceso:", err.message);
  });

  // Send config via stdin
  child.stdin!.write(config + "\n");
  child.stdin!.end();

  viewers.set(userId, instance);
  return { success: true };
}

export function stopViewer(userId: number): { success: boolean; error?: string } {
  const instance = viewers.get(userId);
  if (!instance) {
    return { success: false, error: "No hay visor activo para este usuario" };
  }
  if (instance.process && instance.process.exitCode === null) {
    instance.process.kill("SIGTERM");
    // Force kill after 5 seconds
    setTimeout(() => {
      if (instance.process && instance.process.exitCode === null) {
        instance.process.kill("SIGKILL");
      }
    }, 5000);
  }
  instance.status = "stopped";
  return { success: true };
}

export function getViewerStatus(userId: number): {
  running: boolean;
  status: string;
  viewsGenerated: number;
  viewsFailed: number;
  startedAt: number | null;
  hourlyLimit: number;
} {
  const instance = viewers.get(userId);
  if (!instance) {
    return { running: false, status: "stopped", viewsGenerated: 0, viewsFailed: 0, startedAt: null, hourlyLimit: 50 };
  }
  return {
    running: instance.status === "running",
    status: instance.status,
    viewsGenerated: instance.viewsGenerated,
    viewsFailed: instance.viewsFailed,
    startedAt: instance.startedAt,
    hourlyLimit: instance.hourlyLimit,
  };
}

export function getViewStats(userId: number): { total_views: number; successful: number; last_hour: number } {
  const stats = stmts.getViewStats.all([userId])[0] || { total_views: 0, successful: 0, last_hour: 0 };
  return {
    total_views: stats.total_views ?? 0,
    successful: stats.successful ?? 0,
    last_hour: stats.last_hour ?? 0,
  };
}
