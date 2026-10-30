const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  getConfig: () => ipcRenderer.invoke("setup:get"),
  saveConfig: (values) => ipcRenderer.invoke("setup:save", values),
});
