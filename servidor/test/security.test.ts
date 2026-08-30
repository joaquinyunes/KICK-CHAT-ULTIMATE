import { describe, it, expect } from "vitest";
import {
  encrypt,
  decrypt,
  encryptToHex,
  decryptFromHex,
} from "../src/services/security";

describe("security / AES-256-GCM", () => {
  it("encrypt→decrypt es identidad", () => {
    const plain = "bearer_token_abcdef_ñ_€_🎉";
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it("el layout es [IV(12)][Tag(16)][ciphertext]", () => {
    const buf = encrypt("x");
    expect(buf.length).toBeGreaterThanOrEqual(12 + 16 + 1);
  });

  it("encryptToHex→decryptFromHex es identidad", () => {
    const secret = "un-refresh-token-cualquiera";
    expect(decryptFromHex(encryptToHex(secret))).toBe(secret);
  });

  it("decryptFromHex('') devuelve ''", () => {
    expect(decryptFromHex("")).toBe("");
  });

  it("detecta manipulación (auth tag inválido)", () => {
    const buf = Buffer.from(encrypt("dato sensible"));
    buf[buf.length - 1] ^= 0xff; // corromper último byte del ciphertext
    expect(() => decrypt(buf)).toThrow();
  });

  it("dos cifrados del mismo texto difieren (IV aleatorio)", () => {
    expect(encrypt("mismo").toString("hex")).not.toBe(encrypt("mismo").toString("hex"));
  });
});
