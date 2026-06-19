import { stmts, type ProxyRow } from "../models/database";

interface ProxyInput {
  host: string;
  port: number;
  username: string;
  password: string;
  protocol?: string;
  is_active?: number;
}

export function getAllProxies(): ProxyRow[] {
  return stmts.listProxies.all();
}

export function getProxyById(id: number): ProxyRow | undefined {
  return stmts.findProxyById.get([id]);
}

export function createProxy(data: ProxyInput): { id: number } {
  const result = stmts.insertProxy.run([
    data.host, data.port, data.username, data.password,
    data.protocol || "http",
    data.is_active !== undefined ? data.is_active : 1,
  ]);
  return { id: result.lastInsertRowid };
}

export function updateProxy(id: number, data: Partial<ProxyInput>): void {
  stmts.updateProxy.run([
    data.host ?? null, data.port ?? null, data.username ?? null,
    data.password ?? null, data.protocol ?? null,
    data.is_active !== undefined ? data.is_active : null,
    id,
  ]);
}

export function deleteProxy(id: number): void {
  stmts.deleteProxy.run([id]);
}

export function getRandomActiveProxy(): ProxyRow | undefined {
  return stmts.getRandomActiveProxy.get();
}

export function bulkImportProxies(text: string): number {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  let count = 0;
  for (const line of lines) {
    try {
      // Format: user:pass@host:port
      const match = line.match(/^([^:]+):([^@]+)@([^:]+):(\d+)$/);
      if (match) {
        createProxy({ host: match[3], port: parseInt(match[4], 10), username: match[1], password: match[2] });
        count++;
      }
    } catch { /* skip invalid */ }
  }
  return count;
}
