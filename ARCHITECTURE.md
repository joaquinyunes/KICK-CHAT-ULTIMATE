# Arquitectura

## Panorama

```
┌─────────────┐      ┌──────────────────────────────────────────────┐
│  Panel web  │◄────►│  servidor/ (Express + TS)                     │
│  (public/)  │ JWT  │                                              │
└─────────────┘      │  ┌────────────┐  ┌──────────────┐            │
┌─────────────┐      │  │ auth /     │  │ stream-      │            │
│  Electron   │◄────►│  │ admin API  │  │ simulator    │──► OpenRouter
│  client     │      │  └────────────┘  └──────────────┘            │
└─────────────┘      │  ┌────────────┐  ┌──────────────┐            │
                     │  │ chat send  │  │ vod-viewer   │──► proxies │
                     │  └─────┬──────┘  └──────┬───────┘            │
                     │        │                │  spawn             │
                     │        ▼                ▼                    │
                     │   Kick API      workers Python (*.py)        │
                     │   (2 caminos)                                │
                     │        │                                     │
                     │   SQLite (data/streamchat.db vía sql.js)     │
                     └──────────────────────────────────────────────┘
```

## Componentes

### HTTP (`src/server-engine.ts`)
Monta helmet + CORS + cookie-parser, `trust proxy = 1`, rate-limit global (120/min)
y dedicado para `/api/admin`. Sirve `public/` estático y las rutas de páginas admin
protegidas por cookie JWT. `bootstrap()` inicializa la DB, carga bearers y hace
`markReady()`. `gracefulShutdown` cierra el server y hace `flushDb()` antes de salir.

### Auth (`services/auth-manager.ts`, `middleware/`)
- bcrypt (12 rounds) + JWT HS256 con expiración fija de 24 h.
- `requireAuth` acepta `Authorization: Bearer` o cookie `scb_jwt`.
- `requireAdmin` chequea `role === "admin"`.
- Anti fuerza-bruta en memoria: 8 intentos / 15 min por `usuario|IP` → 429.
- **Pendiente**: refresh token, revocación, lockout persistente.

### Cripto (`services/security.ts`)
AES-256-GCM. Dos usos:
1. `bearers.enc` — archivo `[IV|Tag|CT]` con un JSON array de tokens de bot,
   descifrado una vez y cacheado en memoria.
2. `encryptToHex` / `decryptFromHex` — tokens OAuth guardados en la tabla `bots`.

`decryptFromHex` tiene fallback a clave utf-8 por tokens cifrados antes de la
migración a clave hex. **Objetivo**: `MASTER_KEY` siempre 64 hex y borrar el fallback.

### Envío de mensajes — DOS caminos
| Camino | Archivo | Mecanismo | Estado |
|---|---|---|---|
| **Oficial** | `services/kick-oauth.ts` | `api.kick.com/public/v1/chat` con token OAuth por bot (PKCE, refresh) | preferido |
| **Bearer pool** | `services/bearer-sender.service.ts` | `kick.com/api/v2` (API privada) con pool de bearers scrapeados, rotación round-robin, UA por token, cooldown 60 s, `deadTokens` | frágil, sujeto a cambios/baneos de Kick |
| Playwright | `services/playwright-sender.service.ts` + `send_to_kick_playwright.py` | navegador headless | fallback |

Estado del pool de bearers (`deadTokens`, cooldowns, round-robin, contadores) vive
**en memoria del proceso**: se pierde al reiniciar y no se comparte entre instancias.
**Objetivo**: persistir a DB con TTL de recuperación y exponerlo en el panel.

### Simulador de chat (`controllers/stream-simulator.controller.ts`)
Genera chat sintético "realista". Si hay `OPENROUTER_API_KEY`, llama al modelo con un
system-prompt largo y N agentes en paralelo; si no, usa un generador procedural local.
Persiste en `sim_*` y mantiene "memoria" por usuario simulado.
**Deuda**: 1300+ líneas, prompt inline, `parseMessages` con 4 fallbacks por JSON
truncado, `userApiKey` como global de módulo compartido entre requests.

### VOD viewer (`services/vod-viewer.service.ts` + `vod_viewer_worker.py`)
Spawnea un worker Python por vista, rota proxies desde la tabla `proxies`, respeta
`hourly_view_limit` por usuario, loguea en `view_log`.

### Persistencia (`models/database.ts`)
SQLite vía **sql.js** (WASM, sin binario nativo). Toda la base se serializa y se
reescribe a disco en cada write (debounce 200 ms, escritura atómica con rename).
`flushDb()` fuerza el guardado en el shutdown.
Migraciones: `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... catch {}` (sin versión).
**Objetivo**: migrar a `better-sqlite3` (nativo, WAL, transacciones) + runner de
migraciones con tabla `schema_version`.

### Telemetría (`src/telemetry/`)
`requestLogger` (pino) + store en memoria + `/metrics` protegido por `ADMIN_SECRET`.

## Tablas principales

`users`, `bots`, `bot_assignments`, `proxies`, `client_vods`, `view_log`,
`message_log`, `activity_log`, `admin_audit_log`,
`triggers` / `actions` / `action_steps` (motor de triggers, **a medio construir**),
`sim_sessions` / `sim_mensajes` / `sim_usuarios` / `sim_noticias_cache`.

## Deuda técnica priorizada

1. `better-sqlite3` en vez de sql.js (reescritura completa del archivo por write).
2. Partir `stream-simulator.controller.ts` en service + repo + prompt en archivo.
3. Persistir estado del pool de bearers; panel de salud de tokens.
4. Terminar o eliminar el motor de triggers (`trigger-engine.ts` + `fireChatMessage`
   espera un webhook que hoy nadie invoca).
5. Consolidar los 3 caminos de envío detrás de una interfaz `ChatSender`.
6. Unificar `MASTER_KEY` a 64 hex y borrar el fallback utf-8.
7. Bundler para `public/` para poder sacar `'unsafe-inline'` del CSP.
8. Dedupe: `streamchat-client/src/chat-ui.js` vs `servidor/public/js/chat-ui.js`.
