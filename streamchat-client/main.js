/**
 * StreamChat Bridge – Proceso Principal Electron (FASE 2)
 * Arquitectura de seguridad: nodeIntegration=false, contextIsolation=true
 * Toda la comunicación con APIs externas ocurre en el renderer vía fetch HTTPS.
 * NUNCA se importa crypto, bearers ni tokens de plataforma aquí.
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path  = require('path');
const fs    = require('fs');

// ──────────────────────────────────────────────
// Rutas de recursos
// ──────────────────────────────────────────────
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
const PRELOAD_PATH  = path.join(__dirname, 'preload.js');

// ──────────────────────────────────────────────
// Ventana principal
// ──────────────────────────────────────────────
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width:           960,
    height:          640,
    minWidth:        720,
    minHeight:       480,
    frame:           true,
    titleBarStyle:   'default',
    backgroundColor: '#0d0f14',
    title:           'StreamChat Bridge',
    icon:            path.join(__dirname, 'assets', 'icon.png'),

    webPreferences: {
      // ── Seguridad crítica ──────────────────────
      nodeIntegration:             false,   // Renderer SIN acceso a Node.js
      contextIsolation:            true,    // Contexto JS aislado del proceso principal
      sandbox:                     true,    // Sandbox de Chromium activado
      enableRemoteModule:          false,   // remote module desactivado (deprecated, por si acaso)
      allowRunningInsecureContent: false,   // Sin contenido HTTP mixto
      webSecurity:                 true,    // Políticas de seguridad web activas
      // ── Preload ───────────────────────────────
      preload: PRELOAD_PATH,
    },
  });

  // Carga la pantalla de login por defecto
  mainWindow.loadFile(path.join(__dirname, 'src', 'login.html'));

  // Abre DevTools solo en desarrollo
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Evita que links externos abran nuevas ventanas de Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ──────────────────────────────────────────────
// Ciclo de vida de la app
// ──────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ──────────────────────────────────────────────
// IPC Handlers – expuestos de forma segura al renderer via preload.js
// Solo operaciones de sistema de archivos y navegación. NUNCA tokens.
// ──────────────────────────────────────────────

/**
 * Navega a una página HTML del renderer.
 * El renderer llama: window.bridge.navigate('chat.html')
 */
ipcMain.handle('navigate', (_event, page) => {
  const ALLOWED_PAGES = ['login.html', 'chat.html'];
  if (!ALLOWED_PAGES.includes(page)) {
    return { ok: false, error: 'Página no permitida.' };
  }
  const target = path.join(__dirname, 'src', page);
  mainWindow?.loadFile(target);
  return { ok: true };
});

/**
 * Abre un diálogo nativo para seleccionar un archivo .txt
 * Retorna el contenido del archivo al renderer.
 */
ipcMain.handle('open-txt-file', async (_event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title:       'Seleccionar archivo de mensajes',
    filters:     [{ name: 'Texto', extensions: ['txt'] }],
    properties:  ['openFile'],
  });

  if (canceled || filePaths.length === 0) {
    return { ok: false, error: 'Selección cancelada.' };
  }

  const filePath = filePaths[0];

  try {
    const stat = fs.statSync(filePath);

    // Límite de tamaño: 2 MB para evitar lecturas maliciosas
    if (stat.size > 2 * 1024 * 1024) {
      return { ok: false, error: 'El archivo supera el límite de 2 MB.' };
    }

    const raw = fs.readFileSync(filePath, 'utf-8').trim();

    if (!raw || raw.length === 0) {
      return { ok: false, error: 'El archivo está vacío.' };
    }

    // Divide por líneas, filtra vacías
    const lines = raw
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (lines.length === 0) {
      return { ok: false, error: 'El archivo no contiene mensajes válidos.' };
    }

    return { ok: true, lines, total: lines.length, fileName: path.basename(filePath) };

  } catch (err) {
    const msg = err.code === 'ENOENT'
      ? 'El archivo ya no existe en esa ruta.'
      : `Error al leer el archivo: ${err.message}`;
    return { ok: false, error: msg };
  }
});

/**
 * Lee la configuración local (settings.json).
 */
ipcMain.handle('settings-read', (_event) => {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return { ok: true, settings: null };
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    return { ok: true, settings: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: `No se pudo leer la configuración: ${err.message}` };
  }
});

/**
 * Guarda la configuración local (settings.json).
 * Solo acepta campos definidos – nunca almacena tokens ni credenciales.
 */
ipcMain.handle('settings-write', (_event, payload) => {
  try {
    const ALLOWED_KEYS = ['serverUrl', 'channelName', 'sendInterval'];
    const safe = {};
    for (const key of ALLOWED_KEYS) {
      if (payload[key] !== undefined) safe[key] = payload[key];
    }
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(safe, null, 2), 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `No se pudo guardar la configuración: ${err.message}` };
  }
});