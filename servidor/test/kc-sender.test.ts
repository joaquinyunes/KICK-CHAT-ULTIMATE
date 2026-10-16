import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// El módulo lee process.cwd() y el env al cargarse: se prepara antes del import dinámico.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kc-sender-"));
const ACCOUNTS = ["ana", "beto", "caro", "dani", "eli", "fede"];

interface Sent {
  account: string;
  content: string;
  replyTo?: string;
  messageId: string;
}
const sent: Sent[] = [];

let sender: typeof import("../src/services/kc-sender.service");

beforeAll(async () => {
  process.env.KC_SEND_CHANNEL = "canal-test";
  vi.spyOn(process, "cwd").mockReturnValue(tmp);
  vi.useFakeTimers();

  const { encryptToHex } = await import("../src/services/security");
  fs.mkdirSync(path.join(tmp, "data"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, "data", "kick20.json"),
    JSON.stringify({
      client_id: "id",
      client_secret_enc: encryptToHex("secret"),
      redirect_uri: "http://localhost/cb",
      accounts: ACCOUNTS.map((u) => ({
        username: u,
        access_enc: encryptToHex("tok_" + u),
        refresh_enc: "",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: "chat:write",
        added_at: Date.now(),
      })),
    })
  );

  let counter = 0;
  vi.stubGlobal("fetch", async (url: string, init: any) => {
    const u = String(url);
    const json = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body });
    if (u.includes("/channels")) return json({ data: [{ broadcaster_user_id: 42 }] });
    const body = JSON.parse(init.body);
    const messageId = "msg-" + ++counter;
    sent.push({
      account: String(init.headers.Authorization).replace("Bearer tok_", ""),
      content: body.content,
      replyTo: body.reply_to_message_id,
      messageId,
    });
    return json({ data: { is_sent: true, message_id: messageId } });
  });

  sender = await import("../src/services/kc-sender.service");
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function drain(): Promise<void> {
  for (let i = 0; i < 400; i++) {
    await vi.advanceTimersByTimeAsync(20_000);
    if (sender.getKcSenderStatus().queued === 0 && i > 2) break;
  }
  await vi.advanceTimersByTimeAsync(20_000);
}

describe("kc-sender: reparto de cuentas", () => {
  it("líneas sin autor: casi todos de a 1, alguna doble (nunca 3 seguidas), sin ciclo fijo", async () => {
    sent.length = 0;
    sender.enqueueKcLines(Array.from({ length: 60 }, (_, i) => `mensaje ${i}`), 1);
    await drain();

    expect(sent).toHaveLength(60);
    const seq = sent.map((s) => s.account);
    // tandas de mensajes seguidos de la misma cuenta
    const rafagas: string[][] = [];
    for (const a of seq) {
      const ultima = rafagas[rafagas.length - 1];
      if (ultima && ultima[0] === a) ultima.push(a);
      else rafagas.push([a]);
    }
    expect(Math.max(...rafagas.map((r) => r.length))).toBeLessThanOrEqual(2);              // nunca 3
    expect(rafagas.some((r) => r.length > 1)).toBe(true);            // hay alguna doble
    expect(rafagas.filter((r) => r.length > 1).length).toBeLessThanOrEqual(6); // ~1 cada 15 (60 msgs)
    expect(rafagas.some((r) => r.length === 1)).toBe(true);          // y turnos de uno solo
    // una ráfaga nueva nunca arranca con la cuenta de la anterior
    for (let i = 1; i < rafagas.length; i++) expect(rafagas[i][0]).not.toBe(rafagas[i - 1][0]);
    // el viejo round-robin repetía la cuenta cada 6 mensajes, siempre
    const cyclic = seq.every((a, i) => i < 6 || a === seq[i - 6]);
    expect(cyclic).toBe(false);
    // y todas las cuentas participan
    expect(new Set(seq).size).toBe(ACCOUNTS.length);
  });

  it("hilo con autores: misma voz = misma cuenta, y nadie se responde a sí mismo", async () => {
    sent.length = 0;
    sender.setSendConfig({ replyPct: 100 });
    const hilo = [
      { n: 1, autor: "P3", reply_a: null, texto: "cual era la que paga por grupos?" },
      { n: 2, autor: "P4", reply_a: 1, texto: "por grupos, con 8 iguales cobras" },
      { n: 3, autor: "P3", reply_a: 2, texto: "y con 7 no cobro nada?" },
      { n: 4, autor: "P6", reply_a: 3, texto: "@P4 eso no era asi" },
      { n: 5, autor: "P4", reply_a: 4, texto: "que si es asi [EMOTE: KEKW]" },
    ];
    sender.enqueueKcLines(hilo, 2);
    await drain();

    expect(sent).toHaveLength(5);
    const accOf = (n: number) => sent[n - 1].account;
    expect(accOf(1)).toBe(accOf(3)); // P3 siempre la misma cuenta
    expect(accOf(2)).toBe(accOf(5)); // P4 siempre la misma cuenta
    expect(new Set([accOf(1), accOf(2), accOf(4)]).size).toBe(3);
    for (const [n, parent] of [[2, 1], [3, 2], [4, 3], [5, 4]] as const) {
      expect(accOf(n)).not.toBe(accOf(parent));
      // replyPct=100: cada respuesta sale como respuesta nativa al mensaje anterior
      expect(sent[n - 1].replyTo).toBe(sent[parent - 1].messageId);
    }
    expect(sent[0].replyTo).toBeUndefined();
  });

  it("menciones @Pn se reemplazan por el usuario real de esa voz; emotes en texto plano por defecto", async () => {
    // el mapa voz → cuenta vive en la tanda: P4 es la cuenta que escribió la línea 2
    const cuentaP4 = sent[1].account;
    expect(sent[3].content).toBe(`@${cuentaP4} eso no era asi`);
    expect(sent[4].content).toBe("que si es asi KEKW");
    expect(sent.every((s) => !/@P\d/.test(s.content))).toBe(true);
  });

  it("doble: cuando le toca al contador, 2 líneas seguidas de la misma voz salen de la misma cuenta; la 3ª no", async () => {
    const k20 = await import("../src/services/kick20.service");
    k20.resetDoublePlanner(0); // ya toca una doble
    sent.length = 0;
    sender.enqueueKcLines([
      { n: 1, autor: "P7", reply_a: null, texto: "ojo con esa" },
      { n: 2, autor: "P7", reply_a: null, texto: "mira el contador de arriba" },
      { n: 3, autor: "P7", reply_a: null, texto: "KEKW" },
      { n: 4, autor: "P2", reply_a: 1, texto: "No es asi." },
    ], 5);
    await drain();

    expect(sent).toHaveLength(4);
    expect(sent[1].account).toBe(sent[0].account); // la doble
    expect(sent[2].account).not.toBe(sent[1].account); // nunca 3 seguidos
    expect(sent[3].account).not.toBe(sent[2].account);
  });

  it("sin doble pendiente el servidor corta las rachas del modelo: nadie manda dos seguidos", async () => {
    const k20 = await import("../src/services/kick20.service");
    k20.resetDoublePlanner(1000); // falta mucho para la próxima doble
    sent.length = 0;
    sender.enqueueKcLines([
      { n: 1, autor: "P7", reply_a: null, texto: "uno" },
      { n: 2, autor: "P7", reply_a: null, texto: "dos" },
      { n: 3, autor: "P7", reply_a: null, texto: "tres" },
      { n: 4, autor: "P2", reply_a: null, texto: "cuatro" },
      { n: 5, autor: "P2", reply_a: null, texto: "cinco" },
    ], 6);
    await drain();

    expect(sent).toHaveLength(5);
    for (let i = 1; i < sent.length; i++) expect(sent[i].account).not.toBe(sent[i - 1].account);
  });

  it("el contador habilita una doble cada 12–18 mensajes", async () => {
    const k20 = await import("../src/services/kick20.service");
    const intervalos: number[] = [];
    let desde = 0;
    k20.resetDoublePlanner();
    for (let i = 0; i < 3000; i++) {
      k20.tickMessage();
      desde++;
      if (k20.takeDouble()) { intervalos.push(desde); desde = 0; }
    }
    expect(intervalos.length).toBeGreaterThan(150); // ~3000/15 = 200
    expect(Math.min(...intervalos)).toBeGreaterThanOrEqual(12);
    expect(Math.max(...intervalos)).toBeLessThanOrEqual(18);
  });

  it("reparto equilibrado: la cuenta que menos envió es la que habla en la tanda siguiente", async () => {
    const k20 = await import("../src/services/kick20.service");
    // todas las cuentas menos "fede" acumulan muchos envíos
    for (const u of ACCOUNTS.filter((a) => a !== "fede")) for (let i = 0; i < 50; i++) k20.noteAccountUsed(u);
    expect(k20.pickLeastUsed(ACCOUNTS)).toBe("fede");

    sent.length = 0;
    sender.enqueueKcLines([{ n: 1, autor: "P1", reply_a: null, texto: "hola" }], 20);
    await drain();
    expect(sent.map((s) => s.account)).toEqual(["fede"]);
  });

  it("emotes con id cuando KC_SEND_EMOTES=1", async () => {
    sent.length = 0;
    process.env.KC_SEND_EMOTES = "1";
    sender.enqueueKcLines([{ n: 1, autor: "P1", reply_a: null, texto: "jaja KEKW", raw: "jaja [EMOTE:KEKW] [EMOTE:Desconocido]" }], 3);
    await drain();
    delete process.env.KC_SEND_EMOTES;
    expect(sent[0].content).toBe("jaja [emote:37226:KEKW] Desconocido");
  });

  it("con una sola cuenta no rompe (no puede evitar responderse a sí misma)", async () => {
    sent.length = 0;
    const store = path.join(tmp, "data", "kick20.json");
    const original = fs.readFileSync(store, "utf-8");
    const d = JSON.parse(original);
    d.accounts = d.accounts.slice(0, 1);
    fs.writeFileSync(store, JSON.stringify(d));
    sender.enqueueKcLines([
      { n: 1, autor: "P1", reply_a: null, texto: "uno" },
      { n: 2, autor: "P2", reply_a: 1, texto: "dos" },
    ], 4);
    await drain();
    fs.writeFileSync(store, original);
    expect(sent.map((s) => s.account)).toEqual(["ana", "ana"]);
  });
});
