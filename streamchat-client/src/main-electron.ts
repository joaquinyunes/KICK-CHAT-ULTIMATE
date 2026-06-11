/**
 * main-electron.ts — Integración de Fase 3
 * * Responsabilidades:
 * 1. Inicializar BridgeClient al arrancar la app.
 * 2. Manejar el ciclo de vida: before-quit → cleanup() → app.exit(0).
 * 3. Exponer control vía IPC para el front-end (botones Iniciar/Detener).
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { BridgeClient } from './modules/bridge-client';
import 'dotenv/config'; // Asegúrate de tener instalado dotenv

let mainWindow: BrowserWindow | null = null;
let bridge: BridgeClient | null = null;

// Configuración inicial del Bridge
const initBridge = () => {
  bridge = new BridgeClient({
    serverUrl:    process.env.SERVER_URL || 'http://localhost:3000',
    serverSecret: process.env.SERVER_SECRET || 'streamchat-dev-secret',
    kickApiToken: process.env.KICK_API_TOKEN || '',
    kickChannel:  process.env.KICK_CHANNEL || '',
    intervalMs:   35_000, // 35 segundos para respetar los 30s del servidor
    messageFactory: () => '¡Gracias por el follow! 🎮', // Ejemplo
  });
};

app.whenReady().then(() => {
  initBridge();
  
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // preload: path.join(__dirname, 'preload.js') // Asegúrate de tener tu preload
    },
  });

  mainWindow.loadFile('index.html');
});

// ─── Lógica de Cierre Seguro (Fase 3) ──────────────────────────────────────────

app.on('before-quit', async (event) => {
  if (!bridge) return;

  // 1. Evitar que la app se cierre instantáneamente
  event.preventDefault();

  console.log('[Electron] Cierre detectado. Iniciando limpieza...');

  try {
    // 2. Ejecutar cleanup (detiene interval + DELETE /session/:id)
    await bridge.cleanup();
  } catch (err) {
    console.error('[Electron] Error en cleanup:', err);
  } finally {
    // 3. Forzar el cierre definitivo
    console.log('[Electron] Limpieza finalizada. Saliendo...');
    app.exit(0);
  }
});

// ─── Control desde la UI (IPC) ───────────────────────────────────────────────

ipcMain.handle('bridge:start', async () => {
  bridge?.startAutomation();
  return { success: true };
});

ipcMain.handle('bridge:stop', async () => {
  bridge?.stopAutomation();
  return { success: true };
});

ipcMain.handle('bridge:status', () => {
  return { running: bridge?.running ?? false };
});