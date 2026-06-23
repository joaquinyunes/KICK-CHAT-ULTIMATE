import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { stmts } from "../models/database";

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

let stdoutBuffer = "";

function logDebug(msg: string) {
  try {
    const logPath = path.resolve(process.cwd(), "data", "viewer_debug.log");
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

function parseLine(instance: ViewerInstance, line: string): void {
  try {
    const data = JSON.parse(line);
    logDebug(`stdout: ${line}`);
    switch (data.type) {
      case "start":
        instance.status = "running";
        break;
      case "view_ok":
        instance.viewsGenerated = data.total ?? instance.viewsGenerated + 1;
        try {
          stmts.insertViewLog.run([instance.userId, data.vod_id ?? null, null, 1, null]);
          if (data.vod_id) {
            stmts.incrementVodViews.run({ id: data.vod_id });
          }
        } catch (dbErr) {
          console.error("[vod-viewer] DB error:", dbErr);
          logDebug(`DB error on view_ok: ${dbErr}`);
        }
        break;
      case "view_fail":
        instance.viewsFailed = data.failed ?? instance.viewsFailed + 1;
        try {
          stmts.insertViewLog.run([instance.userId, data.vod_id ?? null, null, 0, data.error ?? null]);
        } catch (dbErr) {
          console.error("[vod-viewer] DB error:", dbErr);
          logDebug(`DB error on view_fail: ${dbErr}`);
        }
        break;
      case "paused":
        break;
      case "warn":
        console.warn("[vod-viewer]", data.message);
        break;
      case "error":
        console.error("[vod-viewer]", data.message);
        logDebug(`Worker error: ${data.message}`);
        instance.status = "error";
        break;
      case "stopped":
        instance.status = "stopped";
        break;
    }
  } catch (e) {
    logDebug(`parseLine error for line "${line}": ${e}`);
  }
}

export function startViewer(userId: number): { success: boolean; error?: string } {
  logDebug(`startViewer called for userId=${userId}`);

  if (viewers.has(userId)) {
    const existing = viewers.get(userId)!;
    logDebug(`existing instance found: status=${existing.status}`);
    if (existing.status === "running") {
      return { success: false, error: "Ya hay un visor corriendo para este usuario" };
    }
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

  const recentViews = stmts.getViewStats.all([userId])[0] || { total_views: 0, successful: 0, last_hour: 0 };

  const vodsData = vods.map(v => ({ id: v.id, url: v.url, type: v.type }));
  const scriptPath = path.resolve(process.cwd(), "vod_viewer_worker.py");
  const config = JSON.stringify({
    user_id: userId,
    hourly_limit: hourlyLimit,
    vods: vodsData,
    hourly_views: (recentViews.last_hour ?? 0),
  });

  logDebug(`scriptPath=${scriptPath} config=${config}`);

  // Check if script exists
  if (!fs.existsSync(scriptPath)) {
    logDebug(`Script NOT FOUND at ${scriptPath}`);
    return { success: false, error: `Script no encontrado: ${scriptPath}` };
  }

  // Check python
  const pythonCmd = "python";
  logDebug(`Spawning: ${pythonCmd} ${scriptPath}`);

  stdoutBuffer = "";
  const child = spawn(pythonCmd, [scriptPath], {
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
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() || "";
    for (const line of lines) {
      if (line) parseLine(instance, line);
    }
  });

  child.stderr!.on("data", (data: Buffer) => {
    const msg = data.toString();
    console.error("[vod-viewer:stderr]", msg);
    logDebug(`stderr: ${msg}`);
  });

  child.on("exit", (code, signal) => {
    instance.status = code === 0 ? "stopped" : "error";
    const msg = `Proceso terminado user=${userId} code=${code} signal=${signal}`;
    logDebug(msg);
    if (code !== 0) {
      console.error(`[vod-viewer] ${msg}`);
    } else {
      console.log(`[vod-viewer] ${msg}`);
    }
  });

  child.on("error", (err) => {
    instance.status = "error";
    const msg = `Error al iniciar proceso: ${err.message}`;
    console.error("[vod-viewer]", msg);
    logDebug(msg);
  });

  child.stdin!.write(config + "\n");
  child.stdin!.end();

  viewers.set(userId, instance);
  logDebug(`Viewer started for userId=${userId}`);
  return { success: true };
}

export function stopViewer(userId: number): { success: boolean; error?: string } {
  const instance = viewers.get(userId);
  if (!instance) {
    return { success: false, error: "No hay visor activo para este usuario" };
  }
  if (instance.process && instance.process.exitCode === null) {
    instance.process.kill("SIGTERM");
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
