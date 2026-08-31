# KICK-CHAT-ULTIMATE

Plataforma multi-cuenta para chat de Kick: envío de mensajes vía bots, simulador de
chat en vivo con IA, y viewer de VODs con proxies. Servidor Express + TypeScript,
SQLite embebido, panel web y cliente Electron opcional.

## Requisitos

- Node.js 20 (ver `.nvmrc`)
- Python 3.11 (solo para los workers de VOD viewer / senders Playwright)
- Opcional: cuenta OAuth en [dev.kick.com](https://dev.kick.com) y API key de OpenRouter

## Arranque rápido

```bash
cd servidor
cp .env.example .env          # completá MASTER_KEY, JWT_SECRET, KICK_* 
npm install
npm run dev                    # http://localhost:3000
```

Primer arranque: se crea el usuario `admin` con una contraseña aleatoria que se
loguea **una vez** (o fijala con `ADMIN_PASSWORD` en `.env`). Cambiala al entrar.

### Producción

```bash
cd servidor
npm ci
npm run build
npm start
```

O con Docker:

```bash
docker build -t kick-chat-ultimate servidor
docker run --env-file servidor/.env -p 3000:3000 -v kick_data:/app/data kick-chat-ultimate
```

## Scripts (`servidor/`)

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor con recarga (ts-node-dev) |
| `npm run build` | Compila TS a `dist/` + copia workers Python |
| `npm start` | Corre `dist/server-engine.js` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run format` / `format:check` | Prettier |
| `npm test` / `test:watch` | Vitest |
| `npm run check` | typecheck + lint + test (lo que corre CI) |
| `npm run encrypt-bearers` | Genera `bearers.enc` desde `bearers.plain.json` |
| `npm run create-user` / `add-bot` / `assign-bot` | Utilidades de administración |
| `npm run probe-bots` / `renew-tokens` | Mantenimiento de tokens de bots |

## Variables de entorno

Ver [`servidor/.env.example`](servidor/.env.example). Todas se validan al arrancar
(`src/config/env.ts`); si falta o es inválida algo, el proceso no levanta y lista
todos los errores juntos.

| Var | Req | Nota |
|---|---|---|
| `MASTER_KEY` | ✅ | AES-256-GCM. Ideal 64 hex (`openssl rand -hex 32`) |
| `JWT_SECRET` | ✅ | ≥16 chars, ideal ≥32 |
| `KICK_CLIENT_ID` / `KICK_CLIENT_SECRET` / `KICK_REDIRECT_URI` | ✅ | OAuth oficial |
| `OPENROUTER_API_KEY` | — | Sin esto el simulador usa el generador local |
| `ADMIN_SECRET` | — | Protege `/metrics`. Sin esto queda bloqueado |
| `APP_URL` | — | Origen CORS permitido en producción |
| `ADMIN_PASSWORD` | — | Contraseña del admin sembrado (si no, aleatoria) |
| `PYTHON_PATH` | — | Binario de Python para los workers |

## Endpoints operativos

- `GET /health` — liveness
- `GET /ready` — readiness (verifica DB); úsalo en el orquestador
- `GET /metrics` — requiere header con `ADMIN_SECRET`

## Contexto del stream (`kick-context/`)

El pipeline de contexto (ex `proyecto-kick-context`, ahora **dentro de este
repo** en `kick-context/`) captura audio/video del stream, resume con Gemini y
el Módulo 12 genera un lote de ~30 líneas de chat cada 5 min. Todo lo maneja el
servidor Node — **un solo comando arranca todo**.

**Reparto claro:** KC solo *genera* el contexto y las líneas. KCU *envía* al
chat de Kick con su pool de bearers (`kc-sender.service`), espaciado, sin
depender del navegador. KC nunca postea (el supervisor le fuerza
`KICK_COMENTARIO_POSTEAR=0`).

### Cómo funciona

```
kick-context/ (Python)                     servidor/ (Node)
  orquestador (M10)                          kc-supervisor.service  ── spawnea y reinicia el orquestador
    ├── M1/M2  captura A/V          ┐
    ├── M6     metadata Kick        │ escriben en
    ├── M8     resumen Gemini       ├─────────────►  kick-context-data/
    ├── M9     memoria histórica    │                  comentarios/lotes/lote_<ts>.json
    └── M12    genera 30 líneas     ┘                       │
                                                            ▼
                                         kc-ingest.service ── cada 300 s toma el lote nuevo
                                                            │
                                         kc-sender.service ── manda cada línea al chat de
                                              Kick (pool de bearers, 1 cada ~10 s)
```

Estado y control: `GET /api/chat/kc-context` (pipeline + ingesta + envío),
`POST /api/chat/kc-pipeline/start|stop`.

### Puesta en marcha

1. **Deps Python** (una vez): `cd servidor && npm run kc:install`
   (necesita Python 3.11 y `ffmpeg` en el PATH).
2. En `servidor/.env`:
   ```
   KC_PIPELINE_ENABLED=1
   KICK_GEMINI_API_KEY=...            # aistudio.google.com/apikey
   KICK_CANAL_SLUG=tu-canal
   KICK_CAPTURE_MODE=remote           # remote = lee el HLS; local = captura esta PC
   KICK_COMENTARIO_POSTEAR=0          # 1 = postea en el chat de Kick de verdad
   ```
3. `npm start` (o `iniciar.bat`). El server levanta el pipeline, lo supervisa,
   absorbe cada lote y lo va enviando al chat. No hay que tocar el panel.

Config fina del pipeline: `kick-context/src/.env.example` (todas las `KICK_*` se
pueden poner en `servidor/.env`, se pasan tal cual). Los datos y logs van a
`kick-context-data/` (git-ignored).

Para dejar el pipeline apagado y solo consumir lotes generados por fuera:
`KC_PIPELINE_ENABLED=0` y seteá `KC_LOTES_DIR`. Para apagar también la ingesta:
`KC_INGEST_ENABLED=0`.

### Probar sin estar en stream (modo simulación)

```
KC_PIPELINE_ENABLED=1
KC_SIMULATION=1
KICK_GEMINI_API_KEY=...        # el M12 igual usa Gemini de verdad
KC_SEND_ENABLED=1
KC_SEND_CHANNEL=tu-canal       # o un canal de prueba
```

Con `KC_SIMULATION=1` el orquestador corre **solo M8 + M9 + M12**, sin captura
ni HLS: M8 inventa un resumen del stream cada ~20 s (rotando escenarios de
casino/apuestas/IRL, opcionalmente variados por Gemini), M12 arma el lote de
30 líneas con Gemini cada ~60 s, y KCU lo absorbe y lo envía. Sirve para ver el
flujo entero — contexto → 30 líneas → envío — sin transmitir.

## Arquitectura

Ver [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Estructura

```
servidor/            API Express + TS (código principal)
  src/
    config/          Validación de entorno (zod)
    controllers/     Handlers HTTP
    routes/          Definición de rutas
    services/        Lógica de negocio (auth, crypto, senders, proxies, oauth)
    middleware/      Auth JWT, admin, rate-limit, features
    models/          SQLite (sql.js) + prepared statements
    telemetry/       Logging de requests + /metrics
  public/            Panel web (HTML/CSS/JS sin bundler)
  scripts/           Utilidades CLI
  *.py               Workers Python (VOD viewer, senders)
streamchat-client/   Cliente Electron (opcional)
kick-context/        Pipeline de contexto (12 módulos Python) — lo supervisa el server
kick-context-data/   Datos y logs del pipeline (git-ignored, se crea solo)
stream-context/      (obsoleto — reemplazado por kick-context/; se puede borrar)
```
