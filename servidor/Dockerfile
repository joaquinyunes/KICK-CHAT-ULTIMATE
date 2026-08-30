# ─── 1. Build (TypeScript → dist/) ─────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
COPY scripts/ scripts/
COPY vod_viewer_worker.py ./
RUN npm run build

# ─── 2. Dependencias de producción (solo runtime) ─────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ─── 3. Runtime ───────────────────────────────────────────────
FROM node:20-bookworm-slim

WORKDIR /app
ENV PYTHON_PATH=/opt/venv/bin/python \
    PATH="/opt/venv/bin:$PATH" \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip curl ca-certificates \
    && python3 -m venv /opt/venv \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && mkdir -p /ms-playwright \
    && playwright install --with-deps chromium \
    && chmod -R a+rX /ms-playwright

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY public/ ./public/
COPY send_to_kick.py send_to_kick_daemon.py send_to_kick_playwright.py ./

RUN useradd --system --uid 10001 --home /app app \
    && mkdir -p /app/data && chown -R app:app /app
USER app

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD curl -fsS http://localhost:3000/ready || exit 1

CMD ["node", "dist/server-engine.js"]
