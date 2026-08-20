const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('velaDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
  windowControls: Object.freeze({
    getState: () => ipcRenderer.invoke('vela-window:get-state'),
    minimize: () => ipcRenderer.invoke('vela-window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('vela-window:toggle-maximize'),
    close: () => ipcRenderer.invoke('vela-window:close'),
    onState: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('vela-window:state', handler);
      return () => ipcRenderer.removeListener('vela-window:state', handler);
    }
  }),
  updater: Object.freeze({
    getState: () => ipcRenderer.invoke('vela-updater:get-state'),
    saveConfig: (config) => ipcRenderer.invoke('vela-updater:save-config', config),
    check: () => ipcRenderer.invoke('vela-updater:check'),
    download: () => ipcRenderer.invoke('vela-updater:download'),
    install: () => ipcRenderer.invoke('vela-updater:install'),
    onState: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('vela-updater:state', handler);
      return () => ipcRenderer.removeListener('vela-updater:state', handler);
    }
  })
}));
