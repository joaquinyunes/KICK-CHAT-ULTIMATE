FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc
COPY vod_viewer_worker.py dist/

FROM python:3.11-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist /app/dist
COPY --from=build /app/node_modules /app/node_modules
COPY package.json /app/package.json

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

RUN playwright install chromium --with-deps

COPY send_to_kick.py /app/send_to_kick.py
COPY send_to_kick_daemon.py /app/send_to_kick_daemon.py
COPY send_to_kick_playwright.py /app/send_to_kick_playwright.py
COPY public/ /app/public/

ENV NODE_ENV=production

VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "dist/server-engine.js"]
