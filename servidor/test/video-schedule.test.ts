import { describe, it, expect } from "vitest";
// @ts-expect-error módulo JS del front (sin tipos)
import { parseVideoText, buildSchedule, fmtClock, parseClock, MIN_MS } from "../public/js/video-schedule.js";

const TEXTO = `MIN 1
abre el primero
responde uno
responde dos
---
suelto
MIN 2
otro hilo
le contestan
---
[MIN 3]
tercero
---
cuarto`;

describe("video-schedule: parseo", () => {
  it("separa minutos y hilos", () => {
    const p = parseVideoText(TEXTO);
    expect(p.hasHeaders).toBe(true);
    expect(p.threads.map((t: any) => [t.minute, t.lines.length])).toEqual([[1, 3], [1, 1], [2, 2], [3, 1], [3, 1]]);
  });

  it("acepta encabezados con decoración y en cualquier caja", () => {
    for (const h of ["MIN 4", "min 4", "Minuto 4", "[MIN 4]", "--- MIN 4 ---", "## MIN 4", "MIN 4:", "**MIN 4**"]) {
      const p = parseVideoText(`${h}\nhola`);
      expect(p.threads[0].minute, h).toBe(4);
    }
  });

  it("una lista plana (sin separadores) es un mensaje por hilo", () => {
    const p = parseVideoText("uno\ndos\ntres");
    expect(p.hasHeaders).toBe(false);
    expect(p.threads.length).toBe(3);
  });

  it("las líneas en blanco y KICKCHAT123456 también separan hilos", () => {
    const p = parseVideoText("MIN 1\na\nb\n\nc\nd\nKICKCHAT123456\ne");
    expect(p.threads.map((t: any) => t.lines.length)).toEqual([2, 2, 1]);
  });
});

describe("video-schedule: agenda", () => {
  it("cada mensaje queda dentro de su minuto y ordenado", () => {
    const s = buildSchedule(parseVideoText(TEXTO));
    expect(s.total).toBe(8);
    expect(s.events.length).toBe(8);
    for (const e of s.events) {
      expect(e.t).toBeGreaterThanOrEqual((e.minute - 1) * MIN_MS);
      expect(e.t).toBeLessThan(e.minute * MIN_MS);
    }
    const ts = s.events.map((e: any) => e.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(s.minutes.get(1)).toBe(4);
    expect(s.maxMinute).toBe(3);
  });

  it("las respuestas salen después del mensaje que abre, en orden", () => {
    const s = buildSchedule(parseVideoText("MIN 5\nabre\nr1\nr2\nr3\nr4"));
    const ord = s.events.map((e: any) => e.text);
    expect(ord).toEqual(["abre", "r1", "r2", "r3", "r4"]);
  });

  it("un hilo largo cabe en el minuto aunque sea de muchas líneas", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `m${i}`).join("\n");
    const s = buildSchedule(parseVideoText(`MIN 2\n${lines}`));
    expect(s.events.length).toBe(30);
    for (const e of s.events) expect(e.t).toBeLessThan(2 * MIN_MS);
  });

  it("es determinista: el mismo texto da la misma agenda", () => {
    const a = buildSchedule(parseVideoText(TEXTO)).events.map((e: any) => [e.t, e.key]);
    const b = buildSchedule(parseVideoText(TEXTO)).events.map((e: any) => [e.t, e.key]);
    expect(a).toEqual(b);
  });

  it("agregar un minuto al final no mueve los mensajes ya programados", () => {
    const a = buildSchedule(parseVideoText(TEXTO)).events;
    const b = buildSchedule(parseVideoText(TEXTO + "\nMIN 4\nnuevo")).events;
    const bKeys = new Map(b.map((e: any) => [e.key, e.t]));
    for (const e of a) expect(bKeys.get(e.key)).toBe(e.t);
  });

  it("sin encabezados reparte parejo por la duración", () => {
    const txt = Array.from({ length: 60 }, (_, i) => `msg ${i}`).join("\n");
    const s = buildSchedule(parseVideoText(txt), 10);
    expect(s.needsDuration).toBe(false);
    expect(s.maxMinute).toBe(10);
    for (let m = 1; m <= 10; m++) expect(s.minutes.get(m)).toBe(6);
  });

  it("sin encabezados y sin duración pide la duración", () => {
    expect(buildSchedule(parseVideoText("a\nb"), 0).needsDuration).toBe(true);
  });
});

describe("video-schedule: reloj", () => {
  it("formatea y parsea mm:ss", () => {
    expect(fmtClock(0)).toBe("0:00");
    expect(fmtClock(754000)).toBe("12:34");
    expect(fmtClock(3723000)).toBe("1:02:03");
    expect(parseClock("12:34")).toBe(754000);
    expect(parseClock("1:02:03")).toBe(3723000);
    expect(parseClock("90")).toBe(90000);
    expect(parseClock("abc")).toBeNaN();
    expect(parseClock("")).toBeNaN();
  });
});
