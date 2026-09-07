import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const qaTempRoot = 'E:\\Codex工作盘\\temp\\vela-browser-acceptance';
const evidenceRoot = 'E:\\Codex工作盘\\artifacts\\test-builds\\vela-browser-acceptance';
mkdirSync(qaTempRoot, { recursive: true });
mkdirSync(evidenceRoot, { recursive: true });
const runRoot = mkdtempSync(path.join(qaTempRoot, 'run-'));
const startedAt = new Date();
const runId = `${startedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${randomBytes(3).toString('hex')}`;
const runEvidenceDirectory = path.join(evidenceRoot, runId);
mkdirSync(runEvidenceDirectory, { recursive: false });
const packageVersion = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version;
const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
const gitDirty = execFileSync('git', ['status', '--porcelain'], { cwd: projectRoot, encoding: 'utf8' }).trim().length > 0;

const getFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});

const waitForUrl = async (url, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
};

const backendPort = await getFreePort();
const frontendPort = await getFreePort();
const providerPort = await getFreePort();
const backendUrl = `http://127.0.0.1:${backendPort}`;
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
const providerUrl = `http://127.0.0.1:${providerPort}/v1`;
const childEnvironment = {
  ...process.env,
  TEMP: path.join(runRoot, 'temp'),
  TMP: path.join(runRoot, 'temp'),
  PORT: String(backendPort),
  VELA_TRUSTED_UI_ORIGINS: frontendUrl,
  VELA_DATA_DIR: path.join(runRoot, 'data'),
  VELA_PROJECTS_DIR: path.join(runRoot, 'projects'),
  VELA_LIBRARY_DIR: path.join(runRoot, 'library'),
  VELA_VITE_CACHE_DIR: path.join(runRoot, 'vite-cache'),
  VELA_FAKE_PROVIDER: 'true'
};
mkdirSync(childEnvironment.TEMP, { recursive: true });

const outputTails = new Map();
const start = (command, args, environment) => {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: environment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const lines = [];
  const remember = (chunk) => {
    lines.push(String(chunk));
    if (lines.length > 30) lines.shift();
  };
  child.stdout.on('data', remember);
  child.stderr.on('data', remember);
  outputTails.set(child, lines);
  return child;
};

const stop = async (child) => {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000))
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
};

let backend;
let frontend;
let provider;
let acceptanceStatus = 'failed';
try {
  provider = start(process.execPath, ['scripts/qa-openai-stub.mjs'], {
    ...childEnvironment,
    VELA_QA_PROVIDER_PORT: String(providerPort)
  });
  backend = start(process.execPath, ['server/index.js'], childEnvironment);
  frontend = start(process.execPath, [
    path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
    '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'
  ], { ...childEnvironment, VELA_BACKEND_URL: backendUrl });
  await Promise.all([
    waitForUrl(`${backendUrl}/api/vela/health`),
    waitForUrl(frontendUrl),
    waitForUrl(`${providerUrl}/models`)
  ]);

  const electronExecutable = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
  const electron = spawn(electronExecutable, [path.join(projectRoot, 'scripts', 'browser-acceptance-electron.cjs')], {
    cwd: projectRoot,
    windowsHide: true,
    stdio: 'inherit',
    env: {
      ...childEnvironment,
      VELA_QA_FRONTEND_URL: frontendUrl,
      VELA_QA_BACKEND_URL: backendUrl,
      VELA_QA_PROVIDER_URL: providerUrl,
      VELA_QA_EVIDENCE_DIR: runEvidenceDirectory,
      VELA_QA_ELECTRON_DATA: path.join(runRoot, 'electron-data')
    }
  });
  const exitCode = await new Promise((resolve) => electron.once('exit', resolve));
  if (exitCode !== 0) throw new Error(`Browser acceptance exited with code ${exitCode}`);
  acceptanceStatus = 'passed';
} catch (error) {
  for (const [child, lines] of outputTails) {
    if (lines.length) console.error(lines.join('').slice(-5000));
  }
  throw error;
} finally {
  await Promise.all([stop(frontend), stop(backend), stop(provider)]);
  const screenshots = readdirSync(runEvidenceDirectory)
    .filter((name) => name.endsWith('.png'))
    .sort()
    .map((name) => {
      const filePath = path.join(runEvidenceDirectory, name);
      return {
        file: name,
        bytes: statSync(filePath).size,
        sha256: createHash('sha256').update(readFileSync(filePath)).digest('hex')
      };
    });
  writeFileSync(path.join(runEvidenceDirectory, 'result.json'), JSON.stringify({
    status: acceptanceStatus,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    packageVersion,
    gitCommit,
    gitDirty,
    simulatedProvider: true,
    externalStoryworksConsumerVerified: false,
    scenarios: [
      'responsive layouts at 1500, 850 and 768 pixels',
      'rapid double-click idempotency',
      'failed row selectable and direct retry in original group',
      'Storyworks local outbox sync',
      'exact generated media on canvas and after reload',
      'save failure blocks navigation and preserves dirty state',
      'double-click quick add contains only prompt, image and video',
      'prompt node uses the original double-click editor and persists after reopen'
    ],
    screenshots
  }, null, 2));
  console.log(`Browser acceptance evidence: ${runEvidenceDirectory}`);
}
