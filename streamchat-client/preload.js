/**
 * preload.js – Puente seguro entre proceso principal y renderer.
 * Expone SOLO las funciones necesarias. El renderer no tiene acceso a Node.js.
 * contextBridge garantiza que el objeto window.bridge no pueda ser modificado
 * desde el contexto del renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {

  /** Navega a otra página de la aplicación */
  navigate: (page) =>
    ipcRenderer.invoke('navigate', page),

  /** Abre diálogo nativo para seleccionar un .txt */
  openTxtFile: () =>
    ipcRenderer.invoke('open-txt-file'),

  /** Lee la configuración local */
  settingsRead: () =>
    ipcRenderer.invoke('settings-read'),

  /** Guarda la configuración local */
  settingsWrite: (payload) =>
    ipcRenderer.invoke('settings-write', payload),

});