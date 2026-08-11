import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, safeStorage, shell, Tray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findAvailablePort, startControlService, stopControlService, waitForHealth } from './serverRuntime.js';
import { VelaUpdater } from './updater.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gotSingleInstanceLock = app.requestSingleInstanceLock();

let mainWindow = null;
let tray = null;
let controlService = null;
let serviceBaseUrl = null;
let isQuitting = false;
let stoppingForQuit = false;
let updateController = null;

const appRoot = () => app.getAppPath();
const iconPath = () => path.join(appRoot(), 'build', 'icon.png');

const showMainWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
};

const activeJobCount = async () => {
  if (!serviceBaseUrl) return 0;
  try {
    const response = await fetch(`${serviceBaseUrl}/api/vela/jobs?limit=500`);
    if (!response.ok) return 0;
    const jobs = await response.json();
    return jobs.filter((job) => ['queued', 'submitting', 'running', 'reconnecting', 'downloading'].includes(job.status)).length;
  } catch { return 0; }
};

const requestFullQuit = async () => {
  const count = await activeJobCount();
  if (count > 0) {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['继续后台运行', '完全退出'],
      defaultId: 0,
      cancelId: 0,
      title: '仍有任务在运行',
      message: `当前还有 ${count} 个任务未结束。完全退出会停止尚未提交的本地任务。`
    });
    if (result.response !== 1) return;
  }
  isQuitting = true;
  app.quit();
};

const createTray = () => {
  const image = nativeImage.createFromPath(iconPath()).resize({ width: 20, height: 20 });
  tray = new Tray(image);
  tray.setToolTip('Vela AI视频画布');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 Vela', click: showMainWindow },
    { type: 'separator' },
    { label: '完全退出', click: () => void requestFullQuit() }
  ]));
  tray.on('double-click', showMainWindow);
};

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1050,
    minHeight: 700,
    show: false,
    backgroundColor: '#111318',
    icon: iconPath(),
    autoHideMenuBar: true,
    title: 'Vela AI视频画布',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!serviceBaseUrl || !url.startsWith(serviceBaseUrl)) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.hide();
    tray?.displayBalloon({ title: 'Vela 仍在运行', content: '任务和下载会继续在后台执行。双击托盘图标可重新打开。' });
  });
  await mainWindow.loadURL(serviceBaseUrl);
};

const boot = async () => {
  const port = await findAvailablePort();
  serviceBaseUrl = `http://127.0.0.1:${port}`;
  const userData = app.getPath('userData');
  for (const directory of ['data', 'library', 'logs']) fs.mkdirSync(path.join(userData, directory), { recursive: true });
  const logPath = path.join(userData, 'logs', 'desktop-service.log');
  controlService = startControlService({
    electronExecutable: process.execPath,
    serverEntry: path.join(appRoot(), 'server', 'index.js'),
    port,
    dataDirectory: path.join(userData, 'data'),
    projectsDirectory: path.join(app.getPath('documents'), 'Vela Projects'),
    libraryDirectory: path.join(userData, 'library'),
    onOutput: (line) => fs.appendFileSync(logPath, line)
  });
  const exitedEarly = new Promise((_, reject) => controlService.once('exit', (code) => reject(new Error(`本机服务提前退出（代码 ${code}）`))));
  await Promise.race([waitForHealth(serviceBaseUrl), exitedEarly]);
  createTray();
  await createWindow();
  updateController = new VelaUpdater({
    app,
    ipcMain,
    safeStorage,
    getWindow: () => mainWindow,
    log: (line) => fs.appendFileSync(logPath, `[updater] ${line}\n`)
  });
};

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
  app.whenReady().then(boot).catch(async (error) => {
    await dialog.showMessageBox({
      type: 'error', title: 'Vela 启动失败', message: error.message,
      detail: `日志目录：${path.join(app.getPath('userData'), 'logs')}`
    });
    isQuitting = true;
    app.quit();
  });
  app.on('window-all-closed', () => {});
  app.on('before-quit', (event) => {
    isQuitting = true;
    if (stoppingForQuit || !controlService || controlService.exitCode !== null) return;
    event.preventDefault();
    stoppingForQuit = true;
    void stopControlService(controlService).finally(() => app.quit());
  });
}
