import { describe, it, expect } from "vitest";
// @ts-expect-error módulo JS del front (sin tipos)
import { SECCIONES } from "../public/js/tematicas/index.js";
// @ts-expect-error módulo JS del front (sin tipos)
import { parseHilos, resolveHilo, buildHilos, countMsgs, pickHilo, parseNoticias, norm } from "../public/js/tematicas/engine.js";

type Sec = { id: string; textos: Record<string, string>; usaNoticias?: boolean };
const pozos = () => (SECCIONES as Sec[]).flatMap((s) => Object.entries(s.textos).map(([modo, t]) => ({ s, modo, t })));

describe("secciones de fábrica", () => {
  it("están Saludos, Noticias, Slots (3 modos), las de juego y Cierre, en ese orden", () => {
    expect((SECCIONES as Sec[]).map((s) => s.id)).toEqual(["saludos", "noticias", "slots", "bonus", "premio", "apuestas", "pedidos", "charla", "sorteo", "pausa", "cierre"]);
    expect(Object.keys((SECCIONES as Sec[])[2].textos)).toEqual(["pendiente", "bien", "mal"]);
  });

  it("más de 100 mensajes por sección y modo, aunque no se complete ningún campo", () => {
    for (const { s, modo, t } of pozos()) {
      const n = countMsgs(buildHilos(t, {}, s.usaNoticias ? "subio la nafta" : ""));
      expect(n, `${s.id}/${modo}`).toBeGreaterThan(100);
    }
  });

  it("ningún mensaje se repite en ninguna sección", () => {
    const seen = new Map<string, string>();
    const dups: string[] = [];
    for (const { s, modo, t } of pozos()) {
      for (const l of parseHilos(t).flat() as string[]) {
        const k = norm(l);
        if (seen.has(k)) dups.push(`${s.id}/${modo}: "${l}" (ya en ${seen.get(k)})`);
        else seen.set(k, `${s.id}/${modo}`);
      }
    }
    expect(dups).toEqual([]);
  });

  it("sin tildes, ñ, comas, signos de apertura, punto final ni muletillas de IA", () => {
    const MAL = /[áéíóúÁÉÍÓÚñÑ,¿¡;"“”]|\.$|\b(increible|excelente|interesante|basicamente|definitivamente|lamentablemente|ademas)\b|^(claro|exacto|tal cual|asi es|tenes razon|ojo que|fijate que|la verdad|entiendo|por supuesto)\b/i;
    for (const { s, modo, t } of pozos()) {
      for (const l of parseHilos(t).flat() as string[]) expect(l, `${s.id}/${modo}`).not.toMatch(MAL);
    }
  });
});

describe("motor", () => {
  it("hilos separados por ---; sin separador cada renglón es un mensaje", () => {
    expect(parseHilos("a\nb\n---\nc\n# nota")).toEqual([["a", "b"], ["c"]]);
    expect(parseHilos("a\nb\n\nc")).toEqual([["a"], ["b"], ["c"]]);
  });

  it("falta el campo en la apertura: no sale el hilo; en una respuesta: se saltea esa línea", () => {
    expect(resolveHilo(["pago {multi}", "que locura"], {})).toBeNull();
    expect(resolveHilo(["que locura", "pago {multi}", "no puede ser"], {})).toEqual(["que locura", "no puede ser"]);
    expect(resolveHilo(["pago {multi}"], { multi: "x500" })).toEqual(["pago x500"]);
  });

  it("noticias: una por renglón y {noticia} se completa", () => {
    expect(parseNoticias("subio la nafta.\n\n se corto la luz ")).toEqual(["subio la nafta", "se corto la luz"]);
    expect(buildHilos("viste que {noticia}\nno sabia\n---", {},"subio la nafta")[0].lines).toEqual(["viste que subio la nafta", "no sabia"]);
    expect(buildHilos("viste que {noticia}", {}, "")).toEqual([]);
  });

  it("no repite un hilo hasta agotarlos y después reinicia", () => {
    const hs = buildHilos("a\n---\nb\n---\nc", {});
    const used = new Set<string>();
    const salen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const p = pickHilo(hs, used);
      expect(p.reset).toBe(false);
      used.add(p.hilo.key);
      salen.push(p.hilo.lines[0]);
    }
    expect(new Set(salen).size).toBe(3);
    expect(pickHilo(hs, used).reset).toBe(true);
  });

  it("en orden: salen como están escritos y al terminar vuelve al primero", () => {
    const hs = buildHilos("a\n---\nb\n---\nc", {});
    const used = new Set<string>();
    const salen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = pickHilo(hs, used, new Set(), { enOrden: true });
      used.add(p.hilo.key);
      salen.push(p.hilo.lines[0]);
    }
    expect(salen).toEqual(["a", "b", "c", "a"]);
    expect(pickHilo(hs, new Set(), new Set([hs[0].key]), { enOrden: true }).hilo.lines[0]).toBe("b");
  });
});
