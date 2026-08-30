import { describe, it, expect } from "vitest";
import { LoginSchema, ChatSendSchema, validate } from "../src/utils/validators";

describe("LoginSchema", () => {
  it("acepta credenciales válidas", () => {
    const r = validate(LoginSchema, { username: "juan_perez", password: "secreta1" });
    expect(r.success).toBe(true);
  });

  it("rechaza username corto", () => {
    const r = validate(LoginSchema, { username: "ab", password: "secreta1" });
    expect(r.success).toBe(false);
  });

  it("rechaza caracteres inválidos en username", () => {
    const r = validate(LoginSchema, { username: "juan perez!", password: "secreta1" });
    expect(r.success).toBe(false);
  });

  it("rechaza password corta", () => {
    const r = validate(LoginSchema, { username: "juanp", password: "123" });
    expect(r.success).toBe(false);
  });
});

describe("ChatSendSchema", () => {
  it("acepta mensaje válido", () => {
    const r = validate(ChatSendSchema, { channel: "xqc", message: "hola" });
    expect(r.success).toBe(true);
  });

  it("coerce de chatroom_id string→number", () => {
    const r = validate(ChatSendSchema, { channel: "xqc", message: "hi", chatroom_id: "42" });
    expect(r.success && r.data.chatroom_id).toBe(42);
  });

  it("rechaza mensaje vacío", () => {
    expect(validate(ChatSendSchema, { channel: "xqc", message: "" }).success).toBe(false);
  });

  it("rechaza mensaje > 500 chars", () => {
    expect(validate(ChatSendSchema, { channel: "xqc", message: "a".repeat(501) }).success).toBe(false);
  });

  it("rechaza canal con guion", () => {
    expect(validate(ChatSendSchema, { channel: "mi-canal", message: "hi" }).success).toBe(false);
  });
});
