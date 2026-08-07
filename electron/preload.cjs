const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('velaDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform
}));
