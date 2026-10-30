import http from "node:http";

// Servidor HTTP de mentira para simular Ollama, Gemini o el analizador remoto.
// `respond(req, body)` devuelve {status, json, text, delayMs}; cada petición queda en `requests`.
export async function startMock(respond) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw;
    }
    requests.push({ method: req.method, path: req.url, headers: req.headers, body, raw });
    const out = (await respond(req, body)) ?? {};
    if (out.delayMs) await new Promise((r) => setTimeout(r, out.delayMs));
    res.writeHead(out.status ?? 200, { "content-type": "application/json" });
    res.end(out.text ?? JSON.stringify(out.json ?? {}));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => (server.closeAllConnections(), server.close(resolve))),
  };
}

// Una URL en la que seguro no escucha nadie.
export async function deadUrl() {
  const mock = await startMock(() => ({}));
  const url = mock.url;
  await mock.close();
  return url;
}

export const REQ = {
  mediaType: "image/jpeg",
  imageBase64: "QUJDRA==",
  mode: "casino",
  language: "es",
  note: "casino online",
  history: [{ title: "Antes", summary: "Menú" }],
};

export const GOOD_RESULT = {
  category: "casino",
  title: "Jugando Sweet Bonanza",
  summary: "Ronda de giros gratis.",
  entities: [{ label: "Juego", value: "Sweet Bonanza" }],
  chat_line: "Sweet Bonanza en giros gratis",
  confidence: "high",
};
