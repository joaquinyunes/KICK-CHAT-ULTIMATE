const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { sign, verify, machineId } = require("../src/license.js");

const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const priv = privateKey.export({ type: "pkcs8", format: "pem" });
const pub = publicKey.export({ type: "spki", format: "pem" });

const NOW = Date.UTC(2026, 9, 30, 12);
const MACHINE = "AAAAA-BBBBB-CCCCC-DDDDD";
const mint = (over = {}) => sign({ id: "abc123", user: "ana", machine: MACHINE, iat: NOW / 1000, exp: NOW / 1000 + 30 * 86400, ...over }, priv);
const check = (token, over = {}) => verify(token, { publicKey: pub, machine: MACHINE, now: NOW, ...over });

test("una licencia vigente es válida y cuenta los días", () => {
  const r = check(mint());
  assert.equal(r.ok, true);
  assert.equal(r.daysLeft, 30);
  assert.equal(r.license.user, "ana");
});

test("vencida", () => {
  const r = check(mint(), { now: NOW + 31 * 86_400_000 });
  assert.equal(r.code, "expired");
});

test("de otro equipo", () => {
  assert.equal(check(mint(), { machine: "ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ" }).code, "machine");
});

test("revocada", () => {
  assert.equal(check(mint(), { revoked: new Set(["abc123"]) }).code, "revoked");
});

test("firmada con otra clave", () => {
  const other = crypto.generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
  const forged = sign({ id: "x", user: "ana", machine: MACHINE, iat: 0, exp: 9_999_999_999 }, other);
  assert.equal(check(forged).code, "signature");
});

test("payload alterado (alargar el vencimiento) invalida la firma", () => {
  const [prefix, , sig] = mint().split(".");
  const body = Buffer.from(JSON.stringify({ v: 1, id: "abc123", user: "ana", machine: MACHINE, iat: 0, exp: 9_999_999_999 })).toString("base64url");
  assert.equal(check(`${prefix}.${body}.${sig}`).code, "signature");
});

test("reloj atrasado respecto a la última vez que se usó", () => {
  assert.equal(check(mint(), { lastSeen: NOW + 3 * 86_400_000 }).code, "clock");
  assert.equal(check(mint(), { lastSeen: NOW + 3_600_000 }).ok, true);
});

test("basura", () => {
  assert.equal(check("hola").code, "format");
  assert.equal(check(null).code, "format");
});

test("machineId tiene el formato esperado y es estable", () => {
  assert.match(machineId(), /^[0-9A-F]{5}(-[0-9A-F]{5}){3}$/);
  assert.equal(machineId(), machineId());
});
