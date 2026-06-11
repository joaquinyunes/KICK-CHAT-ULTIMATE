/**
 * telemetry.js — StreamChat Bridge
 * Fase 4 (actualizado en Fase 7)
 *
 * Middleware de telemetría que ahora persiste todos los eventos
 * en el sistema de logs de archivo en lugar de solo console.log.
 */

'use strict';

const { serverLogger } = require('./logger');

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────
function hrToMs(hrtime) {
  return (hrtime[0] * 1e3 + hrtime[1] / 1e6).toFixed(2);
}

// ─────────────────────────────────────────────
//  Middleware HTTP (Express / compatible)
// ─────────────────────────────────────────────

/**
 * Middleware de telemetría para Express.
 * Registra cada petición con latencia, status y metadatos útiles.
 *
 * @param {Object} [opts]
 * @param {string[]} [opts.ignorePaths]  Rutas que NO se registran (ej: /health)
 * @param {boolean}  [opts.logBody]      Incluir body en el log (default: false)
 */
function telemetryMiddleware(opts = {}) {
  const ignorePaths = opts.ignorePaths || ['/health', '/favicon.ico'];
  const logBody     = opts.logBody     || false;

  return function telemetry(req, res, next) {
    if (ignorePaths.includes(req.path)) return next();

    const start = process.hrtime();

    // Capturar el fin de la respuesta
    res.on('finish', () => {
      const duration = hrToMs(process.hrtime(start));
      const level    = res.statusCode >= 500 ? 'ERROR'
                     : res.statusCode >= 400 ? 'WARN'
                     : 'INFO';

      const meta = {
        type       : 'http_request',
        method     : req.method,
        path       : req.path,
        status     : res.statusCode,
        durationMs : parseFloat(duration),
        ip         : req.ip || req.connection?.remoteAddress,
        userAgent  : req.get('user-agent'),
      };

      if (logBody && req.body && Object.keys(req.body).length) {
        // Nunca loguear contraseñas u otros campos sensibles
        const safeBody = { ...req.body };
        ['password', 'token', 'secret', 'apiKey', 'api_key'].forEach(
          k => { if (safeBody[k]) safeBody[k] = '[REDACTED]'; }
        );
        meta.requestBody = safeBody;
      }

      serverLogger.write(
        level,
        `${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`,
        meta
      );
    });

    next();
  };
}

// ─────────────────────────────────────────────
//  Telemetría de WebSocket / Socket.io
// ─────────────────────────────────────────────

/**
 * Envuelve un servidor Socket.io o ws para registrar eventos clave.
 *
 * @param {Object} io  Instancia de Socket.io (o ws.Server compatible)
 */
function attachSocketTelemetry(io) {
  io.on('connection', (socket) => {
    serverLogger.info('Socket conectado', {
      type     : 'socket_connect',
      socketId : socket.id,
      address  : socket.handshake?.address,
    });

    // Registrar cada evento emitido hacia el servidor
    const originalEmit = socket.emit.bind(socket);
    socket.onAny((event, ...args) => {
      if (event === 'disconnect') return; // manejado abajo
      serverLogger.info(`Socket evento: ${event}`, {
        type     : 'socket_event',
        socketId : socket.id,
        event,
        // No loguear el payload completo por defecto (puede contener datos privados)
        hasPayload: args.length > 0,
      });
    });

    socket.on('disconnect', (reason) => {
      serverLogger.info('Socket desconectado', {
        type     : 'socket_disconnect',
        socketId : socket.id,
        reason,
      });
    });

    socket.on('error', (err) => {
      serverLogger.error('Error en socket', {
        type     : 'socket_error',
        socketId : socket.id,
        error    : err,
      });
    });
  });
}

// ─────────────────────────────────────────────
//  Telemetría de errores no capturados
// ─────────────────────────────────────────────

/**
 * Registra excepciones y rechazos de promesas no manejados.
 * Llamar UNA VEZ al arrancar el servidor.
 */
function registerGlobalErrorHandlers() {
  process.on('uncaughtException', (err) => {
    serverLogger.error('uncaughtException — el proceso puede terminar', { error: err });
    // No relanzamos; el proceso principal decide si salir
  });

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    serverLogger.error('unhandledRejection', { error: err });
  });
}

// ─────────────────────────────────────────────
//  Telemetría de métricas del sistema (periódica)
// ─────────────────────────────────────────────

/**
 * Registra métricas de memoria y CPU cada `intervalMs` ms.
 *
 * @param {number} [intervalMs=60000]
 * @returns {NodeJS.Timeout}  El ID del intervalo para poder detenerlo.
 */
function startSystemMetrics(intervalMs = 60_000) {
  return setInterval(() => {
    const mem = process.memoryUsage();
    serverLogger.info('Métricas del sistema', {
      type          : 'system_metrics',
      heapUsedMB    : (mem.heapUsed  / 1024 / 1024).toFixed(2),
      heapTotalMB   : (mem.heapTotal / 1024 / 1024).toFixed(2),
      rssMMB        : (mem.rss       / 1024 / 1024).toFixed(2),
      externalMB    : (mem.external  / 1024 / 1024).toFixed(2),
      uptimeSeconds : Math.floor(process.uptime()),
    });
  }, intervalMs);
}

module.exports = {
  telemetryMiddleware,
  attachSocketTelemetry,
  registerGlobalErrorHandlers,
  startSystemMetrics,
};
