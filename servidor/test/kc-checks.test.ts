import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kc-checks-"));
let sup: typeof import("../src/services/kc-supervisor.service");

beforeAll(async () => {
  fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
  process.env.KC_DIR = tmp;
  delete process.env.KICK_GEMINI_API_KEY;
  sup = await import("../src/services/kc-supervisor.service");
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("geminiKeyPresent", () => {
  const envFile = () => path.join(tmp, "src", ".env");

  it("falso sin .env, con clave vacía o comentada", () => {
    expect(sup.geminiKeyPresent()).toBe(false);
    fs.writeFileSync(envFile(), "KICK_GEMINI_API_KEY=\nKICK_GEMINI_MODEL=gemini-flash-lite-latest\n");
    expect(sup.geminiKeyPresent()).toBe(false);
    fs.writeFileSync(envFile(), 'KICK_GEMINI_API_KEY=""\n# KICK_GEMINI_API_KEY=abc\n');
    expect(sup.geminiKeyPresent()).toBe(false);
  });

  it("verdadero con clave en kick-context/src/.env o en el entorno", () => {
    fs.writeFileSync(envFile(), "KICK_GEMINI_API_KEY=AIzaXYZ\n");
    expect(sup.geminiKeyPresent()).toBe(true);
    fs.rmSync(envFile());
    process.env.KICK_GEMINI_API_KEY = "AIzaXYZ";
    expect(sup.geminiKeyPresent()).toBe(true);
    delete process.env.KICK_GEMINI_API_KEY;
  });
});

describe("getKcChecks", () => {
  it("devuelve los 4 requisitos con cómo arreglarlos", async () => {
    const checks = await sup.getKcChecks(true);
    expect(checks.map((c) => c.id)).toEqual(["python", "requests", "ffmpeg", "gemini"]);
    for (const c of checks) expect(c.fix.length).toBeGreaterThan(5);
    expect(checks.find((c) => c.id === "gemini")!.ok).toBe(false);
  });
});
