// Importes que lee el OCR («€148.30», «$1,200.50», «1.200,50 €», «R$ 12,00») -> número.
// Lo usa el seguimiento de la actividad para calcular diferencias de saldo.

// En este orden: «R$» antes que «$», que está dentro de él.
const SYMBOLS = { "R$": "BRL", "€": "EUR", "£": "GBP", $: "USD" };
const CODES = ["USD", "EUR", "GBP", "MXN", "ARS", "COP", "CLP", "PEN", "BRL", "BTC", "ETH", "USDT"];

// Con un solo separador (coma o punto) se decide por lo que sigue: «,50» al final son decimales y «,200» son miles.
function toNumber(digits) {
  const lastDot = digits.lastIndexOf(".");
  const lastComma = digits.lastIndexOf(",");
  let normalized;
  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSep = lastDot > lastComma ? "." : ",";
    const thousandSep = decimalSep === "." ? "," : ".";
    normalized = digits.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? "." : ",";
    const parts = digits.split(sep);
    const tail = parts[parts.length - 1];
    // «1.200» / «1,200,000» son miles; «148.30» / «0,5» son decimales.
    normalized = parts.length > 2 || (tail.length === 3 && parts[0].length <= 3 && parts[0] !== "0") ? parts.join("") : `${parts[0]}.${tail}`;
  } else {
    normalized = digits;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

// Devuelve { value, currency } o null si no hay ningún número.
export function parseAmount(raw) {
  const text = String(raw ?? "");
  const match = /\d[\d.,]*/.exec(text);
  if (!match) return null;
  const value = toNumber(match[0].replace(/[.,]+$/, ""));
  if (value === null) return null;

  // El signo puede ir antes del símbolo («-€3.50») o pegado al número («€-3.50»).
  const negative = /[-−]\s*(?:R\$|[€$£])?\s*$/.test(text.slice(0, match.index));
  const symbol = Object.keys(SYMBOLS).find((s) => text.includes(s));
  const currency = symbol ? SYMBOLS[symbol] : (CODES.find((c) => new RegExp(`\\b${c}\\b`, "i").test(text)) ?? null);
  return { value: negative ? -value : value, currency };
}

export function formatDelta(delta, currency) {
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const symbol = Object.entries(SYMBOLS).find(([, code]) => code === currency)?.[0] ?? (currency ? ` ${currency}` : "");
  const abs = Math.abs(delta).toFixed(2);
  return currency && symbol.length === 1 ? `${sign}${symbol}${abs}` : `${sign}${abs}${symbol}`;
}
