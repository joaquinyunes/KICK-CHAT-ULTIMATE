/**
 * logger.js — StreamChat Bridge
 * Fase 7: Persistencia de Logs y Auditoría
 *
 * Logger estructurado en JSON con rotación de archivos y niveles.
 * Compatible con Node.js puro (sin dependencias externas) y con Electron.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ─────────────────────────────────────────────
//  Constantes
// ─────────────────────────────────────────────
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;   // 5 MB
const MAX_ROTATED_FILES   = 5;
const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

// ─────────────────────────────────────────────
//  Resolución de la ruta de logs según contexto
// ─────────────────────────────────────────────
function resolveLogDir(context = 'server') {
  if (context === 'client') {
    // Electron renderer / main process
    try {
      const { app } = require('electron');
      return path.join(app.getPath('userData'), 'logs');
    } catch {
      // Fallback si no hay Electron disponible en tests
      return path.join(process.cwd(), 'logs', 'client');
    }
  }
  return path.join(process.cwd(), 'logs');
}

// ─────────────────────────────────────────────
//  Utilidades de filesystem
// ─────────────────────────────────────────────
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function fileSizeBytes(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────
//  Rotación de logs
// ─────────────────────────────────────────────
function rotateIfNeeded(filePath) {
  if (fileSizeBytes(filePath) < MAX_FILE_SIZE_BYTES) return;

  // Elimina el archivo más antiguo si ya alcanzamos el máximo
  const oldest = `${filePath}.${MAX_ROTATED_FILES}`;
  if (fs.existsSync(oldest)) fs.unlinkSync(oldest);

  // Rota: archivo.log.4 → archivo.log.5, etc.
  for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
    const src  = `${filePath}.${i}`;
    const dest = `${filePath}.${i + 1}`;
    if (fs.existsSync(src)) fs.renameSync(src, dest);
  }

  // El archivo activo pasa a ser .1
  if (fs.existsSync(filePath)) fs.renameSync(filePath, `${filePath}.1`);
}

// ─────────────────────────────────────────────
//  Escritura atómica (append)
// ─────────────────────────────────────────────
function writeEntry(filePath, entry) {
  rotateIfNeeded(filePath);
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
}

// ─────────────────────────────────────────────
//  Fábrica de Logger
// ─────────────────────────────────────────────

/**
 * @param {Object} options
 * @param {'server'|'client'} [options.context='server']   Contexto de ejecución
 * @param {string}  [options.logDir]       Sobrescribe el directorio de logs
 * @param {string}  [options.filename]     Nombre del archivo (sin extensión)
 * @param {string}  [options.minLevel]     Nivel mínimo a registrar ('DEBUG'|'INFO'|'WARN'|'ERROR')
 * @param {boolean} [options.consoleEcho]  También escribe en console (default: true en dev)
 */
function createLogger(options = {}) {
  const context    = options.context  || 'server';
  const logDir     = options.logDir   || resolveLogDir(context);
  const filename   = options.filename || (context === 'client' ? 'client' : 'server');
  const minLevel   = options.minLevel || 'INFO';
  const consoleEcho = options.consoleEcho !== undefined
    ? options.consoleEcho
    : process.env.NODE_ENV !== 'production';

  ensureDir(logDir);
  const logFile = path.join(logDir, `${filename}.log`);

  // ── Métodos internos ─────────────────────────
  function log(level, message, meta = {}) {
    if (LEVELS[level] < LEVELS[minLevel]) return;

    const entry = {
      timestamp : new Date().toISOString(),
      level,
      message,
      ...meta,
    };

    // Si es ERROR y hay instancia de Error, adjuntar stack
    if (level === 'ERROR' && meta.error instanceof Error) {
      entry.stack   = meta.error.stack;
      entry.errName = meta.error.name;
      entry.errMsg  = meta.error.message;
      delete entry.error;   // no serializar el objeto nativo
    }

    writeEntry(logFile, entry);

    if (consoleEcho) {
      const prefix = `[${entry.timestamp}] [${level}]`;
      if (level === 'ERROR') console.error(prefix, message, entry.stack || '');
      else if (level === 'WARN') console.warn(prefix, message);
      else console.log(prefix, message);
    }
  }

  // ── API pública ──────────────────────────────
  return {
    /** Ruta al archivo de log activo */
    logFile,
    /** Directorio de logs */
    logDir,

    debug : (msg, meta) => log('DEBUG', msg, meta),
    info  : (msg, meta) => log('INFO',  msg, meta),
    warn  : (msg, meta) => log('WARN',  msg, meta),
    error : (msg, meta) => log('ERROR', msg, meta),

    /**
     * Registra una entrada con nivel y metadatos arbitrarios.
     * Útil para el middleware de telemetría.
     */
    write : (level, msg, meta) => log(level.toUpperCase(), msg, meta),

    /**
     * Colecta todos los archivos de log del directorio activo
     * (archivo actual + rotados).
     */
    collectLogFiles() {
      const files = [];
      if (fs.existsSync(logFile)) files.push(logFile);
      for (let i = 1; i <= MAX_ROTATED_FILES; i++) {
        const rotated = `${logFile}.${i}`;
        if (fs.existsSync(rotated)) files.push(rotated);
      }
      return files;
    },
  };
}

// ─────────────────────────────────────────────
//  Support Bundle — exportLogsAsZip()
// ─────────────────────────────────────────────

/**
 * Comprime todos los archivos de log en un ZIP en memoria.
 *
 * @param {Object|Array} loggers  Un logger o array de loggers creados con `createLogger()`
 * @param {Object}       [opts]
 * @param {string}       [opts.outputPath]  Si se provee, escribe el ZIP en disco y devuelve la ruta.
 *                                           Si no, devuelve un Buffer en memoria.
 * @returns {Promise<Buffer|string>}
 */
async function exportLogsAsZip(loggers, opts = {}) {
  // Normalizar a array
  const loggerList = Array.isArray(loggers) ? loggers : [loggers];

  // Recopilar archivos únicos
  const allFiles = [];
  for (const logger of loggerList) {
    if (typeof logger.collectLogFiles === 'function') {
      allFiles.push(...logger.collectLogFiles());
    }
  }
  const uniqueFiles = [...new Set(allFiles)].filter(f => fs.existsSync(f));

  if (uniqueFiles.length === 0) {
    throw new Error('No se encontraron archivos de log para exportar.');
  }

  // ── Construcción manual del ZIP (formato PKZIP sin dependencias) ──────────
  //
  // Usamos gzip individual + un archivo ZIP "store" sin compresión adicional
  // para máxima compatibilidad.  Implementamos un ZIP mínimo válido:
  //   Local file headers + file data + Central directory + End of central dir.

  const localHeaders   = [];
  const centralEntries = [];
  let   offset         = 0;

  function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
  function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }

  // CRC-32 tabla
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })();

  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  for (const filePath of uniqueFiles) {
    const content  = fs.readFileSync(filePath);
    const name     = path.basename(filePath);
    const nameUtf8 = Buffer.from(name, 'utf8');
    const crc      = crc32(content);
    const size     = content.length;

    // Local file header
    const lfh = Buffer.concat([
      Buffer.from([0x50, 0x4B, 0x03, 0x04]),  // signature
      u16(20),       // version needed
      u16(0x0800),   // general purpose (UTF-8 flag)
      u16(0),        // compression: stored
      u16(0), u16(0),// mod time, mod date
      u32(crc),
      u32(size),
      u32(size),
      u16(nameUtf8.length),
      u16(0),        // extra field length
    ]);

    localHeaders.push(Buffer.concat([lfh, nameUtf8, content]));

    // Central directory entry
    const cde = Buffer.concat([
      Buffer.from([0x50, 0x4B, 0x01, 0x02]),  // signature
      u16(20), u16(20),
      u16(0x0800),
      u16(0),
      u16(0), u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameUtf8.length),
      u16(0), u16(0), u16(0), u16(0),
      u32(0),
      u32(offset),
      nameUtf8,
    ]);
    centralEntries.push(cde);
    offset += lfh.length + nameUtf8.length + size;
  }

  const centralDir    = Buffer.concat(centralEntries);
  const centralOffset = offset;
  const eocd = Buffer.concat([
    Buffer.from([0x50, 0x4B, 0x05, 0x06]),
    u16(0), u16(0),
    u16(centralEntries.length),
    u16(centralEntries.length),
    u32(centralDir.length),
    u32(centralOffset),
    u16(0),
  ]);

  const zipBuffer = Buffer.concat([...localHeaders, centralDir, eocd]);

  // ── Salida ────────────────────────────────────────────────────────────────
  if (opts.outputPath) {
    ensureDir(path.dirname(opts.outputPath));
    fs.writeFileSync(opts.outputPath, zipBuffer);
    return opts.outputPath;
  }
  return zipBuffer;
}

// ─────────────────────────────────────────────
//  Instancias por defecto (singleton)
// ─────────────────────────────────────────────
const serverLogger = createLogger({ context: 'server' });
const clientLogger = createLogger({ context: 'client' });

module.exports = {
  createLogger,
  exportLogsAsZip,
  serverLogger,
  clientLogger,
  // Alias convenientes para el servidor
  logger: serverLogger,
};
