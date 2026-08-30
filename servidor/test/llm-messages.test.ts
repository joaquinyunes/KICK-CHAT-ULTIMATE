import { describe, it, expect } from "vitest";
import { parseLlmMessages, sanitizeStreamContext } from "../src/utils/llm-messages";

describe("parseLlmMessages", () => {
  it("array JSON pelado", () => {
    const out = parseLlmMessages('[{"user":"a","message":"hola"},{"user":"b","message":"chau"}]');
    expect(out).toHaveLength(2);
    expect(out[0].user).toBe("a");
  });

  it("objeto con clave mensajes + fences ```json", () => {
    const raw = '```json\n{"session_id":"x","mensajes":[{"user":"a","message":"hi"}]}\n```';
    const out = parseLlmMessages(raw);
    expect(out).toHaveLength(1);
    expect(out[0].message).toBe("hi");
  });

  it("recupera objetos de un array truncado", () => {
    const raw = '[{"user":"a","message":"uno"},{"user":"b","message":"dos"},{"user":"c","mess';
    const out = parseLlmMessages(raw);
    expect(out.map((m) => m.user)).toEqual(["a", "b"]);
  });

  it("une varios agentes separados por ---SPLIT---", () => {
    const raw =
      '[{"user":"a","message":"1"}]\n---SPLIT---\n[{"user":"b","message":"2"}]';
    expect(parseLlmMessages(raw)).toHaveLength(2);
  });

  it("una línea por objeto", () => {
    const raw = 'basura\n{"user":"a","message":"x"}\n{"id":1,"user":"b","message":"y"}\nmás basura';
    const out = parseLlmMessages(raw);
    expect(out).toHaveLength(2);
  });

  it("texto sin JSON → array vacío, no tira", () => {
    expect(parseLlmMessages("perdón, no puedo ayudar con eso")).toEqual([]);
  });

  it("entrada vacía / no-string", () => {
    expect(parseLlmMessages("")).toEqual([]);
    // @ts-expect-error probando robustez
    expect(parseLlmMessages(null)).toEqual([]);
  });
});

describe("sanitizeStreamContext", () => {
  it("saca control chars y comillas, corta a 500", () => {
    const dirty = 'un "contexto" con\x00 basura' + " ".repeat(600);
    const clean = sanitizeStreamContext(dirty);
    expect(clean).not.toMatch(/["'\x00]/);
    expect(clean.length).toBeLessThanOrEqual(500);
  });

  it("no-string → ''", () => {
    expect(sanitizeStreamContext(undefined)).toBe("");
    expect(sanitizeStreamContext(42)).toBe("");
  });
});
