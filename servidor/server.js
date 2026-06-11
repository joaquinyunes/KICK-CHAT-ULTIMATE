/**
 * server.js (fragmento de integración) — StreamChat Bridge
 * Fase 7: Ejemplo de integración completa
 *
 * Muestra cómo usar logger + telemetría + support bundle
 * en un servidor Express / Socket.io real.
 */

'use strict';

const express = require('express');
const http    = require('http');
// const { Server } = require('socket.io');   // Descomentar si se usa Socket.io

const { serverLogger }                              = require('./logger');
const { telemetryMiddleware,
        attachSocketTelemetry,
        registerGlobalErrorHandlers,
        startSystemMetrics }                        = require('./telemetry');
const { registerElectronHandlers, createSupportBundle } = require('./supportBundle');

// ── Arranque ─────────────────────────────────────────────────────────────────
registerGlobalErrorHandlers();          // captura uncaughtException / unhandledRejection
startSystemMetrics(60_000);            // métricas cada 1 minuto
// registerElectronHandlers();          // solo en proceso principal de Electron

const app    = express();
const server = http.createServer(app);
// const io  = new Server(server);
// attachSocketTelemetry(io);

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(telemetryMiddleware({
  ignorePaths : ['/health'],
  logBody     : process.env.NODE_ENV !== 'production',
}));

// ── Rutas de ejemplo ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/stream/start', (req, res) => {
  serverLogger.info('Stream iniciado', {
    type     : 'stream_event',
    streamId : req.body.streamId,
    platform : req.body.platform,
  });
  res.json({ success: true });
});

app.post('/api/stream/stop', (req, res) => {
  serverLogger.info('Stream detenido', {
    type     : 'stream_event',
    streamId : req.body.streamId,
  });
  res.json({ success: true });
});

// ── Endpoint de soporte (solo en dev / acceso autenticado en prod) ────────────
app.get('/admin/support-bundle', async (req, res) => {
  try {
    const { buffer, filename } = await createSupportBundle({ returnBuffer: true });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    serverLogger.error('No se pudo generar support bundle', { error: err });
    res.status(500).json({ error: err.message });
  }
});

// ── Arranque del servidor ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  serverLogger.info(`Servidor iniciado en puerto ${PORT}`, {
    type : 'server_start',
    port : PORT,
    env  : process.env.NODE_ENV || 'development',
  });
});

module.exports = { app, server };
