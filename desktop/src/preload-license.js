const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("license", {
  info: () => ipcRenderer.invoke("license:info"),
  submit: (token) => ipcRenderer.invoke("license:submit", token),
  copy: (text) => ipcRenderer.invoke("license:copy", text),
});
