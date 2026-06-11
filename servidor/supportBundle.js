/**
 * supportBundle.js — StreamChat Bridge
 * Fase 7: Support Bundle
 *
 * Expone:
 *   - CLI:       node supportBundle.js  →  genera support-bundle-<timestamp>.zip
 *   - Electron:  ipcMain handler para el botón "Enviar logs" de la UI
 *   - API:       createSupportBundle()  para llamar desde código
 */

'use strict';

const path = require('path');
const os   = require('os');

const { serverLogger, clientLogger, exportLogsAsZip } = require('./logger');

// ─────────────────────────────────────────────
//  Metadatos del sistema (se incluyen en el bundle)
// ─────────────────────────────────────────────
function buildSystemInfo() {
  return {
    generatedAt   : new Date().toISOString(),
    platform      : process.platform,
    arch          : process.arch,
    nodeVersion   : process.version,
    osRelease     : os.release(),
    osCpus        : os.cpus().length,
    totalMemoryMB : (os.totalmem() / 1024 / 1024).toFixed(0),
    freeMemoryMB  : (os.freemem()  / 1024 / 1024).toFixed(0),
    uptimeSeconds : Math.floor(process.uptime()),
    env           : process.env.NODE_ENV || 'unknown',
  };
}

// ─────────────────────────────────────────────
//  Creación del bundle
// ─────────────────────────────────────────────

/**
 * Genera el support bundle.
 *
 * @param {Object} [opts]
 * @param {string} [opts.outputDir]   Directorio donde guardar el ZIP.
 *                                    Por defecto: escritorio del usuario.
 * @param {boolean} [opts.returnBuffer]  Si true, devuelve Buffer en lugar de ruta.
 * @returns {Promise<{ path?: string, buffer?: Buffer, filename: string }>}
 */
async function createSupportBundle(opts = {}) {
  const ts       = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `support-bundle-${ts}.zip`;

  const outputDir = opts.outputDir
    || path.join(os.homedir(), 'Desktop')
    || os.tmpdir();

  const outputPath = path.join(outputDir, filename);

  try {
    if (opts.returnBuffer) {
      const buffer = await exportLogsAsZip(
        [serverLogger, clientLogger]
      );
      serverLogger.info('Support bundle generado (buffer)', { filename });
      return { buffer, filename };
    }

    const zipPath = await exportLogsAsZip(
      [serverLogger, clientLogger],
      { outputPath }
    );
    serverLogger.info('Support bundle guardado en disco', {
      type : 'support_bundle',
      path : zipPath,
    });
    return { path: zipPath, filename };

  } catch (err) {
    serverLogger.error('Error al generar support bundle', { error: err });
    throw err;
  }
}

// ─────────────────────────────────────────────
//  Handler para Electron IPC
// ─────────────────────────────────────────────

/**
 * Registra los handlers IPC en el proceso principal de Electron.
 * Llamar desde main.js después de que app esté lista.
 *
 * Canales:
 *   'support-bundle:create'  →  devuelve { success, path?, error? }
 *   'support-bundle:open'    →  abre la carpeta del bundle en el explorador
 */
function registerElectronHandlers() {
  let ipcMain, shell, dialog;
  try {
    ({ ipcMain, shell, dialog } = require('electron'));
  } catch {
    console.warn('[supportBundle] Electron no disponible; IPC handlers omitidos.');
    return;
  }

  ipcMain.handle('support-bundle:create', async (_event, opts = {}) => {
    try {
      // Permitir que el usuario elija dónde guardar
      const { filePath, canceled } = await dialog.showSaveDialog({
        defaultPath : `support-bundle-${Date.now()}.zip`,
        filters     : [{ name: 'ZIP Archive', extensions: ['zip'] }],
      });

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      const result = await createSupportBundle({ outputDir: path.dirname(filePath) });
      return { success: true, path: result.path };

    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('support-bundle:open-folder', async (_event, bundlePath) => {
    if (bundlePath) shell.showItemInFolder(bundlePath);
  });
}

// ─────────────────────────────────────────────
//  Uso desde CLI
// ─────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    console.log('📦  Generando Support Bundle…');
    try {
      const result = await createSupportBundle();
      console.log(`✅  Bundle generado: ${result.path}`);
    } catch (err) {
      console.error('❌  Error:', err.message);
      process.exit(1);
    }
  })();
}

module.exports = { createSupportBundle, registerElectronHandlers, buildSystemInfo };
