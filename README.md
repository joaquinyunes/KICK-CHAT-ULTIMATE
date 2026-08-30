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
stream-context/      Extractor de contexto de stream (audio/video → texto) — Python
```
