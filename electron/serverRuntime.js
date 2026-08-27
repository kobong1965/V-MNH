import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const VELA_RUNTIME_DISCOVERY_FILE = 'runtime-discovery.json';

const normalizeLocalBaseUrl = (value) => {
  const url = new URL(value);
  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (url.protocol !== 'http:' || !localHosts.has(url.hostname) || !url.port || url.username || url.password) {
    throw new Error('Vela runtime discovery only accepts a local HTTP localhost address');
  }
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
};

export const writeRuntimeDiscovery = async ({
  userDataDirectory,
  baseUrl,
  pid = process.pid,
  now = new Date()
}) => {
  if (!userDataDirectory) throw new Error('userDataDirectory is required');
  const payload = {
    schemaVersion: 1,
    service: 'vela-control',
    baseUrl: normalizeLocalBaseUrl(baseUrl),
    pid: Number(pid),
    updatedAt: now.toISOString()
  };
  await mkdir(userDataDirectory, { recursive: true });
  await writeFile(
    path.join(userDataDirectory, VELA_RUNTIME_DISCOVERY_FILE),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8'
  );
  return payload;
};

export const findAvailablePort = (host = '127.0.0.1') => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.unref();
  probe.once('error', reject);
  probe.listen(0, host, () => {
    const address = probe.address();
    const port = typeof address === 'object' && address ? address.port : null;
    probe.close((error) => error ? reject(error) : resolve(port));
  });
});

export const waitForHealth = async (baseUrl, {
  attempts = 120,
  intervalMs = 250,
  fetchImpl = globalThis.fetch
} = {}) => {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(`${baseUrl}/api/vela/health`);
      if (response.ok && (await response.json()).ok === true) return true;
      lastError = new Error(`Health check returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Vela control service did not become ready: ${lastError?.message || 'unknown error'}`);
};

export const buildControlServiceArguments = ({
  serverEntry,
  dataDirectory,
  projectsDirectory,
  libraryDirectory
}) => [
  serverEntry,
  `--vela-data-dir=${encodeURIComponent(dataDirectory)}`,
  `--vela-projects-dir=${encodeURIComponent(projectsDirectory)}`,
  `--vela-library-dir=${encodeURIComponent(libraryDirectory)}`
];

export const getRuntimeDiscoveryUserDataDirectory = ({
  dataDirectory,
  processArguments = process.argv
} = {}) => {
  if (!dataDirectory || !Array.isArray(processArguments)) return null;
  const isDesktopChild = processArguments.some((argument) =>
    String(argument || '').startsWith('--vela-data-dir=')
  );
  return isDesktopChild ? path.dirname(path.resolve(dataDirectory)) : null;
};

export const startControlService = ({
  electronExecutable,
  serverEntry,
  port,
  dataDirectory,
  projectsDirectory,
  libraryDirectory,
  onOutput = () => {}
}) => {
  const child = spawn(electronExecutable, buildControlServiceArguments({
    serverEntry,
    dataDirectory,
    projectsDirectory,
    libraryDirectory
  }), {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(port),
      VELA_DATA_DIR: dataDirectory,
      VELA_PROJECTS_DIR: projectsDirectory,
      VELA_LIBRARY_DIR: libraryDirectory,
      LIBRARY_DIR: libraryDirectory,
      LOCAL_MODELS_DIR: `${dataDirectory}/models`,
      VELA_LAN_ENABLED: 'false'
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout?.on('data', (chunk) => onOutput(String(chunk)));
  child.stderr?.on('data', (chunk) => onOutput(String(chunk)));
  return child;
};

export const stopControlService = async (child, timeoutMs = 12_000) => {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs))
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
};
