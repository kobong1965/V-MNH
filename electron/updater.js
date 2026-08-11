import fs from 'node:fs';
import path from 'node:path';

import updaterPackage from 'electron-updater';

import { buildFeedOptions, DEFAULT_UPDATE_CONFIG, normalizeUpdateConfig, redactUpdateError } from './updateConfig.js';

const { autoUpdater } = updaterPackage;

export class VelaUpdater {
  constructor({ app, ipcMain, safeStorage, getWindow, log }) {
    this.app = app;
    this.ipcMain = ipcMain;
    this.safeStorage = safeStorage;
    this.getWindow = getWindow;
    this.log = log;
    this.configPath = path.join(app.getPath('userData'), 'update-config.json');
    this.config = DEFAULT_UPDATE_CONFIG;
    this.token = '';
    this.state = {
      supported: app.isPackaged,
      currentVersion: app.getVersion(),
      status: 'idle',
      owner: DEFAULT_UPDATE_CONFIG.owner,
      repo: DEFAULT_UPDATE_CONFIG.repo,
      privateRepository: false,
      tokenConfigured: false
    };
    this.loadConfig();
    this.configureUpdater();
    this.registerEvents();
    this.registerIpc();
  }

  loadConfig() {
    try {
      if (!fs.existsSync(this.configPath)) return;
      const stored = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      this.config = normalizeUpdateConfig(stored, DEFAULT_UPDATE_CONFIG);
      if (stored.encryptedToken && this.safeStorage.isEncryptionAvailable()) {
        this.token = this.safeStorage.decryptString(Buffer.from(stored.encryptedToken, 'base64'));
      }
      this.syncPublicConfig();
    } catch (error) {
      this.log(`更新配置读取失败：${redactUpdateError(error)}`);
    }
  }

  syncPublicConfig() {
    Object.assign(this.state, this.config, { tokenConfigured: Boolean(this.token) });
  }

  configureUpdater() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    if (this.app.isPackaged) autoUpdater.setFeedURL(buildFeedOptions(this.config, this.token));
  }

  registerEvents() {
    autoUpdater.on('checking-for-update', () => this.update({ status: 'checking', message: '正在连接 GitHub Releases…' }));
    autoUpdater.on('update-available', (info) => this.update({ status: 'available', latestVersion: info.version, message: `发现新版本 v${info.version}` }));
    autoUpdater.on('update-not-available', (info) => this.update({ status: 'not-available', latestVersion: info.version, message: '当前已经是最新版' }));
    autoUpdater.on('download-progress', (progress) => this.update({ status: 'downloading', progress: progress.percent, message: `已下载 ${Math.round(progress.percent)}%` }));
    autoUpdater.on('update-downloaded', (info) => this.update({ status: 'downloaded', progress: 100, latestVersion: info.version, message: '更新包已验证，点击“重启并安装”完成升级' }));
    autoUpdater.on('error', (error) => this.update({ status: 'error', message: redactUpdateError(error, [this.token]) }));
  }

  registerIpc() {
    const trusted = (event) => event.sender === this.getWindow()?.webContents;
    this.ipcMain.handle('vela-updater:get-state', (event) => trusted(event) ? this.state : Promise.reject(new Error('不受信任的更新请求')));
    this.ipcMain.handle('vela-updater:save-config', (event, input) => {
      if (!trusted(event)) throw new Error('不受信任的更新请求');
      return this.saveConfig(input);
    });
    this.ipcMain.handle('vela-updater:check', async (event) => {
      if (!trusted(event)) throw new Error('不受信任的更新请求');
      if (!this.app.isPackaged) return this.update({ status: 'error', message: '开发预览版不能下载安装更新，请使用 Windows 安装版' });
      try {
        await autoUpdater.checkForUpdates();
      } catch (error) {
        return this.update({ status: 'error', message: redactUpdateError(error, [this.token]) });
      }
      return this.state;
    });
    this.ipcMain.handle('vela-updater:download', async (event) => {
      if (!trusted(event)) throw new Error('不受信任的更新请求');
      try {
        await autoUpdater.downloadUpdate();
      } catch (error) {
        return this.update({ status: 'error', message: redactUpdateError(error, [this.token]) });
      }
      return this.state;
    });
    this.ipcMain.handle('vela-updater:install', (event) => {
      if (!trusted(event)) throw new Error('不受信任的更新请求');
      autoUpdater.quitAndInstall(false, true);
    });
  }

  saveConfig(input = {}) {
    const next = normalizeUpdateConfig(input, this.config);
    if (next.privateRepository && input.token) {
      if (!this.safeStorage.isEncryptionAvailable()) throw new Error('当前 Windows 环境无法安全保存 GitHub Token');
      this.token = String(input.token).trim();
    } else if (!next.privateRepository) {
      this.token = '';
    }
    const stored = {
      ...next,
      ...(this.token ? { encryptedToken: this.safeStorage.encryptString(this.token).toString('base64') } : {})
    };
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(stored, null, 2), { mode: 0o600 });
    this.config = next;
    this.syncPublicConfig();
    this.configureUpdater();
    return this.update({ status: 'idle', latestVersion: undefined, progress: undefined, message: '更新来源已保存' });
  }

  update(patch) {
    this.state = { ...this.state, ...patch };
    this.getWindow()?.webContents.send('vela-updater:state', this.state);
    this.log(`更新状态：${this.state.status}${this.state.message ? ` - ${this.state.message}` : ''}`);
    return this.state;
  }
}
