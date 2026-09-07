import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const acceptanceTemp = 'E:\\Codex工作盘\\temp\\vela-acceptance';
const npmCache = 'E:\\Codex工作盘\\caches\\npm';
mkdirSync(acceptanceTemp, { recursive: true });
mkdirSync(npmCache, { recursive: true });

const environment = {
  ...process.env,
  TEMP: acceptanceTemp,
  TMP: acceptanceTemp,
  npm_config_cache: npmCache,
  VELA_VITE_CACHE_DIR: path.join(acceptanceTemp, 'vite-cache')
};
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is unavailable; run this entry through npm run test:acceptance');
const scripts = ['test:node', 'test:frontend', 'typecheck', 'test:browser'];

for (const script of scripts) {
  const child = spawn(process.execPath, [npmCli, 'run', script], {
    cwd: projectRoot,
    env: environment,
    stdio: 'inherit',
    windowsHide: true
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (exitCode !== 0) process.exit(exitCode || 1);
}
