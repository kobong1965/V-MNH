import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { bindWindowStateEvents, registerWindowControlHandlers, WINDOW_CHANNELS } from './windowControls.js';

test('desktop window IPC minimizes, toggles maximize and closes the active window', async () => {
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const calls = [];
  let maximized = false;
  const window = {
    isDestroyed: () => false,
    isMaximized: () => maximized,
    minimize: () => calls.push('minimize'),
    maximize: () => { maximized = true; calls.push('maximize'); },
    unmaximize: () => { maximized = false; calls.push('unmaximize'); },
    close: () => calls.push('close')
  };
  registerWindowControlHandlers({ ipcMain, getWindow: () => window });

  assert.deepEqual(await handlers.get(WINDOW_CHANNELS.getState)(), { maximized: false });
  await handlers.get(WINDOW_CHANNELS.minimize)();
  assert.deepEqual(await handlers.get(WINDOW_CHANNELS.toggleMaximize)(), { maximized: true });
  assert.deepEqual(await handlers.get(WINDOW_CHANNELS.toggleMaximize)(), { maximized: false });
  await handlers.get(WINDOW_CHANNELS.close)();
  assert.deepEqual(calls, ['minimize', 'maximize', 'unmaximize', 'close']);
});

test('desktop window state events publish maximize and restore state', () => {
  const window = new EventEmitter();
  let maximized = false;
  const messages = [];
  window.isMaximized = () => maximized;
  window.webContents = { send: (...args) => messages.push(args) };
  bindWindowStateEvents(window);
  maximized = true;
  window.emit('maximize');
  maximized = false;
  window.emit('unmaximize');
  assert.deepEqual(messages, [
    [WINDOW_CHANNELS.state, { maximized: true }],
    [WINDOW_CHANNELS.state, { maximized: false }]
  ]);
});
