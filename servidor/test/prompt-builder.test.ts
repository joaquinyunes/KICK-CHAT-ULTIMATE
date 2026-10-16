import { describe, it, expect } from "vitest";
import { composePrompt, normalizarDatos, normalizarOpciones, esVideo, MAX_CANT_VIDEO } from "../src/prompts/prompt-builder";

const armar = (opts: Record<string, unknown>, datos: Record<string, unknown> = {}) => {
  const o = normalizarOpciones(opts);
  return { o, prompt: composePrompt(normalizarDatos(datos), o) };
};

describe("prompt-builder: modo video", () => {
  it("sin duración o sin comentarios por minuto no es modo video", () => {
    expect(esVideo(normalizarOpciones({ duracion: 30 }))).toBe(false);
    expect(esVideo(normalizarOpciones({ porMinuto: 8 }))).toBe(false);
    expect(esVideo(normalizarOpciones({ duracion: 30, porMinuto: 8 }))).toBe(true);
  });

  it("la cantidad es minutos × comentarios por minuto", () => {
    const { o } = armar({ duracion: 30, porMinuto: 8 });
    expect(o.cantidad).toBe(240);
    expect(o.minutoDesde).toBe(1);
    expect(o.minutoHasta).toBe(30);
  });

  it("respeta el tramo Desde/Hasta y lo acota a la duración", () => {
    const { o } = armar({ duracion: 30, porMinuto: 6, minutoDesde: 11, minutoHasta: 99 });
    expect(o.minutoDesde).toBe(11);
    expect(o.minutoHasta).toBe(30);
    expect(o.cantidad).toBe(20 * 6);
    const b = armar({ duracion: 30, porMinuto: 6, minutoDesde: 20, minutoHasta: 5 }).o;
    expect(b.minutoHasta).toBeGreaterThanOrEqual(b.minutoDesde);
  });

  it("corta el tramo si superaría el tope de mensajes por tanda", () => {
    const { o } = armar({ duracion: 600, porMinuto: 60 });
    expect(o.cantidad).toBeLessThanOrEqual(MAX_CANT_VIDEO);
    expect(o.cantidad).toBe((o.minutoHasta - o.minutoDesde + 1) * 60);
  });

  it("el prompt pide encabezados MIN y la cantidad exacta por minuto", () => {
    const { prompt } = armar({ duracion: 30, porMinuto: 8, minutoDesde: 1, minutoHasta: 10 });
    expect(prompt).toContain("HILOS POR MINUTO");
    expect(prompt).toContain("MIN 1");
    expect(prompt).toContain("EXACTAMENTE 8 mensajes");
    expect(prompt).toContain("del minuto 1 al 10");
    expect(prompt).toContain("80 mensajes en total");
    expect(prompt).toContain("CADA MINUTO SOLO CONOCE EL VIDEO");
  });

  it("un tramo que no empieza en el minuto 1 avisa que continúa", () => {
    const { prompt } = armar({ duracion: 30, porMinuto: 8, minutoDesde: 11, minutoHasta: 20 });
    expect(prompt).toContain("CONTINUANDO");
    expect(prompt).toContain("MIN 11");
  });
});

describe("prompt-builder: estructura por hilos", () => {
  it("el formato hilos pide mensaje + respuestas separados por ---", () => {
    const { prompt } = armar({ formato: "hilos", cantidad: 40 });
    expect(prompt).toContain("ESTRUCTURA POR HILOS");
    expect(prompt).toContain("FORMATO DE SALIDA — HILOS");
    expect(prompt).toContain("EXACTAMENTE 40");
    expect(prompt).not.toContain("KICKCHAT123456");
  });

  it("los demás formatos no cambian de estructura", () => {
    const { prompt } = armar({ formato: "lineas", cantidad: 40 });
    expect(prompt).not.toContain("ESTRUCTURA POR HILOS");
    expect(prompt).toContain("KICKCHAT123456");
  });

  it("los mensajes ya no son telegráficos ni repetidos", () => {
    const { prompt } = armar({ formato: "hilos", cantidad: 40 });
    expect(prompt).toContain("mediana de 7-9 palabras");
    expect(prompt).toContain("BANCO DE TEMAS");
  });
});

describe("prompt-builder: ráfagas", () => {
  const FORMATOS = ["hilos", "mensajes", "json", "json_delay", "lineas", "usuario_texto"];

  it("todos los formatos piden un mensaje por turno y una doble cada ~15 mensajes, nunca 3", () => {
    for (const formato of FORMATOS) {
      const { prompt } = armar({ formato });
      expect(prompt, formato).toContain("RÁFAGAS");
      expect(prompt, formato).toContain("una vez cada ~15 mensajes");
      expect(prompt, formato).toContain("nunca 3 ni más seguidos de la misma persona");
      expect(prompt, formato).not.toContain("son los únicos que pueden escribir dos veces seguidas");
    }
  });

  it("el modo video las pide igual", () => {
    const { prompt } = armar({ duracion: 20, porMinuto: 6 });
    expect(prompt).toContain("RÁFAGAS");
  });

  it("con json_delay la ráfaga sale con menos pausa", () => {
    const { prompt } = armar({ formato: "json_delay" });
    expect(prompt).toContain("continúa la ráfaga");
  });

  it("sin la regla de voces también hay ráfagas", () => {
    const { prompt } = armar({ formato: "mensajes", reglas: { voces: false } });
    expect(prompt).toContain("RÁFAGAS");
  });
});
