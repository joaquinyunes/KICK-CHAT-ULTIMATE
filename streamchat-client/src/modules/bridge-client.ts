/**
 * bridge-client.ts – StreamChat Bridge (Fase 3)
 * * Responsabilidades:
 * 1. Gestión de sesiones (JWT) y peticiones base.
 * 2. Automatización cliente-side (setInterval + sendToKick).
 * 3. Limpieza de sesión en el servidor al desconectar.
 */

import { v4 as uuidv4 } from 'uuid';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type ConnectionStatus = 'connected' | 'disconnected' | 'checking';

export interface BridgeResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
}

export interface BridgeClientConfig {
  serverUrl: string;
  serverSecret: string;
  kickApiToken: string;
  kickChannel: string;
  intervalMs?: number;
  messageFactory: () => string;
}

// ── Almacén de estado (Singleton) ─────────────────────────────────────────────

type StatusListener = (status: ConnectionStatus) => void;
let _status: ConnectionStatus = 'disconnected';
const _listeners: Set<StatusListener> = new Set();

function setStatus(next: ConnectionStatus): void {
  if (_status === next) return;
  _status = next;
  _listeners.forEach(fn => fn(next));
}

// ── Clase para Automatización (Fase 3) ───────────────────────────────────────

const SERVER_INTERVAL_MS = 30_000;
const DEFAULT_INTERVAL_MS = 35_000;

export class BridgeClient {
  private readonly sessionId: string;
  private readonly config: Required<BridgeClientConfig>;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(config: BridgeClientConfig) {
    this.sessionId = uuidv4();
    const requestedInterval = config.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.config = { 
      ...config, 
      intervalMs: Math.max(requestedInterval, SERVER_INTERVAL_MS) 
    };
  }

  startAutomation(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.sendToKick();
    this.intervalHandle = setInterval(() => this.sendToKick(), this.config.intervalMs);
  }

  stopAutomation(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.isRunning = false;
  }

  async cleanup(): Promise<void> {
    this.stopAutomation();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      await fetch(`${this.config.serverUrl}/session/${this.sessionId}`, {
        method: 'DELETE',
        headers: { 'x-server-secret': this.config.serverSecret },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (err) {
      console.warn(`[BridgeClient] Fallo en cleanup: ${err}`);
    }
  }

  private async sendToKick(): Promise<void> {
    try {
      const response = await fetch(`${this.config.serverUrl}/chat/send`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-server-secret': this.config.serverSecret 
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          message: this.config.messageFactory(),
          channel: this.config.kickChannel,
          apiToken: this.config.kickApiToken,
        }),
      });
      setStatus(response.ok ? 'connected' : 'disconnected');
    } catch {
      setStatus('disconnected');
    }
  }
}

// ── API pública original ──────────────────────────────────────────────────────

export function onStatusChange(fn: StatusListener): () => void {
  _listeners.add(fn);
  fn(_status);
  return () => _listeners.delete(fn);
}

export async function ping(): Promise<boolean> {
  setStatus('checking');
  try {
    const res = await fetch(`${sessionStorage.getItem('scb_server_url')}/health`);
    const ok = res.ok;
    setStatus(ok ? 'connected' : 'disconnected');
    return ok;
  } catch {
    setStatus('disconnected');
    return false;
  }
}