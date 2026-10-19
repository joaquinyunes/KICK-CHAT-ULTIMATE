import { describe, it, expect, vi, afterEach } from "vitest";
import { generarContexto } from "../src/services/context-ai.service";

const okGemini = (t: string) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: t }] } }] }) });
const okOllama = (t: string) => ({ ok: true, status: 200, json: async () => ({ response: t }) });
const fail = (status: number) => ({ ok: false, status, json: async () => ({}) });

afterEach(() => { vi.unstubAllGlobals(); delete process.env.KICK_GEMINI_API_KEY; });

describe("generarContexto", () => {
  it("usa Gemini si hay clave", async () => {
    process.env.KICK_GEMINI_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => okGemini(" juega Gates of Olympus ")));
    const r = await generarContexto("texto del stream de prueba largo", "auto");
    expect(r.proveedor).toBe("gemini");
    expect(r.contexto).toBe("juega Gates of Olympus");
  });

  it("si Gemini devuelve 429 cae a Ollama y deja el intento anotado", async () => {
    process.env.KICK_GEMINI_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("googleapis") ? fail(429) : okOllama("contexto local"))));
    const r = await generarContexto("texto del stream de prueba largo", "auto");
    expect(r.proveedor).toBe("ollama");
    expect(r.intentos[0].proveedor).toBe("gemini");
    expect(r.intentos[0].error).toContain("429");
  });

  it("si todo falla tira error con los intentos", async () => {
    process.env.KICK_GEMINI_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => fail(503)));
    await expect(generarContexto("texto del stream de prueba largo", "auto")).rejects.toThrow(/gemini.*ollama/s);
  });

  it("proveedor gemini sin clave falla sin llamar a la red", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(generarContexto("texto del stream de prueba largo", "gemini")).rejects.toThrow(/KICK_GEMINI_API_KEY/);
    expect(f).not.toHaveBeenCalled();
  });
});
