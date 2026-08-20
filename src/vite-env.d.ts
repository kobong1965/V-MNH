/// <reference types="vite/client" />

interface VelaUpdateState {
  supported: boolean;
  currentVersion: string;
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  latestVersion?: string;
  progress?: number;
  message?: string;
  owner: string;
  repo: string;
  privateRepository: boolean;
  tokenConfigured: boolean;
}

interface VelaDesktopBridge {
  isDesktop: true;
  platform: string;
  windowControls: {
    getState: () => Promise<{ maximized: boolean }>;
    minimize: () => Promise<{ ok: boolean }>;
    toggleMaximize: () => Promise<{ maximized: boolean }>;
    close: () => Promise<{ ok: boolean }>;
    onState: (listener: (state: { maximized: boolean }) => void) => () => void;
  };
  updater: {
    getState: () => Promise<VelaUpdateState>;
    saveConfig: (config: { owner: string; repo: string; privateRepository: boolean; token?: string }) => Promise<VelaUpdateState>;
    check: () => Promise<VelaUpdateState>;
    download: () => Promise<VelaUpdateState>;
    install: () => Promise<void>;
    onState: (listener: (state: VelaUpdateState) => void) => () => void;
  };
}

interface Window {
  velaDesktop?: VelaDesktopBridge;
}
