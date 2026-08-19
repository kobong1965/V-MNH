export const WINDOW_CHANNELS = Object.freeze({
  getState: 'vela-window:get-state',
  minimize: 'vela-window:minimize',
  toggleMaximize: 'vela-window:toggle-maximize',
  close: 'vela-window:close',
  state: 'vela-window:state'
});

const resolveWindow = (getWindow) => {
  const window = getWindow?.();
  return window && !window.isDestroyed?.() ? window : null;
};

export const readWindowState = (window) => ({
  maximized: Boolean(window?.isMaximized?.())
});

export const registerWindowControlHandlers = ({ ipcMain, getWindow }) => {
  ipcMain.handle(WINDOW_CHANNELS.getState, () => readWindowState(resolveWindow(getWindow)));
  ipcMain.handle(WINDOW_CHANNELS.minimize, () => {
    resolveWindow(getWindow)?.minimize();
    return { ok: true };
  });
  ipcMain.handle(WINDOW_CHANNELS.toggleMaximize, () => {
    const window = resolveWindow(getWindow);
    if (!window) return readWindowState(null);
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return readWindowState(window);
  });
  ipcMain.handle(WINDOW_CHANNELS.close, () => {
    resolveWindow(getWindow)?.close();
    return { ok: true };
  });
};

export const bindWindowStateEvents = (window) => {
  const publish = () => window.webContents?.send(WINDOW_CHANNELS.state, readWindowState(window));
  window.on('maximize', publish);
  window.on('unmaximize', publish);
  return publish;
};
