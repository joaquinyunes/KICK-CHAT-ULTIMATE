// Los modelos pequeños a veces envuelven el JSON en ```json ... ``` o añaden texto alrededor.
// Devuelve el objeto, o null si no hay forma de sacar un objeto JSON del texto.
export function parseModelJson(text) {
  const s = String(text ?? "").trim();
  const candidates = [s];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fenced) candidates.push(fenced[1].trim());
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(s.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value !== null && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
      // probamos con el siguiente candidato
    }
  }
  return null;
}
