/**
 * BridgeClient — Fase 5: Resiliencia (Exponential Backoff + Jitter)
 *
 * Características:
 *  - Reintento automático ante errores de red o 5xx
 *  - Espera exponencial: 2^n segundos (tope 30s) con ±10% de jitter
 *  - Soporte de Retry-After en respuestas 429
 *  - Callback onConnectionStatusChange para reflejar estado en la UI
 *  - messageFactory permanece agnóstico; solo se llama al conectar
 */

class BridgeClient {
  /**
   * @param {Object} config
   * @param {string}   config.endpoint           URL base del servidor bridge
   * @param {string}   config.sessionId          ID de sesión del usuario
   * @param {Function} config.messageFactory     () => { message, metadata }
   * @param {Function} [config.onConnectionStatusChange]  'connected' | 'reconnecting' | 'failed'
   * @param {number}   [config.maxRetries=7]     Número máximo de reintentos
   * @param {number}   [config.maxDelayMs=30000] Tope del delay en ms
   */
  constructor({
    endpoint,
    sessionId,
    messageFactory,
    onConnectionStatusChange = () => {},
    maxRetries = 7,
    maxDelayMs = 30_000,
  }) {
    this.endpoint = endpoint;
    this.sessionId = sessionId;
    this.messageFactory = messageFactory;
    this.onConnectionStatusChange = onConnectionStatusChange;
    this.maxRetries = maxRetries;
    this.maxDelayMs = maxDelayMs;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Calcula el delay con backoff exponencial y jitter ±10%.
   * delay = clamp(2^n * 1000, 0, maxDelayMs) * (0.9 + random * 0.2)
   */
  _backoffDelay(attempt) {
    const base = Math.min(Math.pow(2, attempt) * 1_000, this.maxDelayMs);
    const jitter = 0.9 + Math.random() * 0.2; // [0.9, 1.1)
    return Math.round(base * jitter);
  }

  /** Devuelve true si el error merece reintento */
  _isRetryable(error, status) {
    if (error) return true;           // fallo de red (fetch throw)
    return status >= 500 && status <= 599; // 5xx del servidor
  }

  /** Pausa asíncrona */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ─── Método principal ──────────────────────────────────────────────────────

  /**
   * Envía el mensaje producido por messageFactory a Kick vía el bridge.
   * Reintenta con backoff exponencial; nunca bloquea la app.
   *
   * @returns {Promise<{ ok: boolean, data?: any, error?: string }>}
   */
  async sendToKick() {
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      // Solo llamamos al factory cuando vamos a intentar el envío
      const payload = this.messageFactory();

      let response = null;
      let networkError = null;

      try {
        response = await fetch(`${this.endpoint}/chat/send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Session-Id": this.sessionId,
          },
          body: JSON.stringify({
            sessionId: this.sessionId,
            message: payload.message,
            metadata: payload.metadata ?? {},
          }),
        });
      } catch (err) {
        networkError = err;
      }

      // ── Éxito ──────────────────────────────────────────────────────────────
      if (response && response.ok) {
        this.onConnectionStatusChange("connected");
        const data = await response.json();
        return { ok: true, data };
      }

      // ── 429 Too Many Requests ──────────────────────────────────────────────
      if (response && response.status === 429) {
        const retryAfterHeader = response.headers.get("Retry-After");
        let waitMs;

        if (retryAfterHeader) {
          // Puede ser segundos enteros o una fecha HTTP
          const seconds = Number(retryAfterHeader);
          waitMs = Number.isFinite(seconds)
            ? seconds * 1_000
            : Math.max(0, new Date(retryAfterHeader) - Date.now());
        } else {
          waitMs = this._backoffDelay(attempt);
        }

        console.warn(
          `[BridgeClient] 429 recibido. Esperando ${waitMs}ms (Retry-After: ${retryAfterHeader ?? "no header"}).`
        );
        this.onConnectionStatusChange("reconnecting");
        await this._sleep(waitMs);
        attempt++;
        continue;
      }

      // ── Error de red o 5xx ─────────────────────────────────────────────────
      const status = response?.status ?? null;
      if (networkError || this._isRetryable(networkError, status)) {
        if (attempt >= this.maxRetries) break; // salimos del loop → fallo final

        const delay = this._backoffDelay(attempt);
        const reason = networkError
          ? `network error: ${networkError.message}`
          : `HTTP ${status}`;

        console.warn(
          `[BridgeClient] Intento ${attempt + 1}/${this.maxRetries} fallido (${reason}). ` +
            `Reintentando en ${delay}ms…`
        );
        this.onConnectionStatusChange("reconnecting");
        await this._sleep(delay);
        attempt++;
        continue;
      }

      // ── Errores no recuperables (4xx salvo 429) ────────────────────────────
      const errText = await response.text().catch(() => "");
      console.error(`[BridgeClient] Error no recuperable ${status}: ${errText}`);
      this.onConnectionStatusChange("failed");
      return { ok: false, error: `HTTP ${status}: ${errText}` };
    }

    // ── Se agotaron los reintentos ─────────────────────────────────────────
    console.error("[BridgeClient] Se agotaron todos los reintentos.");
    this.onConnectionStatusChange("failed");
    return { ok: false, error: "Max retries exceeded" };
  }
}

// ─── Ejemplo de uso ───────────────────────────────────────────────────────────

/*
const client = new BridgeClient({
  endpoint: "https://my-bridge.example.com",
  sessionId: "sess_abc123",
  messageFactory: () => ({
    message: "Hola desde el bot!",
    metadata: { channel: "general" },
  }),
  onConnectionStatusChange: (status) => {
    // Actualizar UI: 'connected' | 'reconnecting' | 'failed'
    console.log("[UI] Estado de conexión:", status);
  },
});

client.sendToKick().then(console.log);
*/

module.exports = { BridgeClient };
