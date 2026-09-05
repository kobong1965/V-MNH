import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  assertProjectOwnedNodeModules,
  verifyPackagedRuntime
} from '../electron/packagedRuntimeVerifier.js';

const wait = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

function copyArtifact(source, destination) {
  let lastError;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      copyFileSync(source, destination);
      return;
    } catch (error) {
      lastError = error;
      if (!['EBUSY', 'EPERM'].includes(error?.code) || attempt === 12) throw error;
      wait(1_000);
    }
  }
  throw lastError;
}

const projectRoot = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
const releaseDir = resolve(process.env.VELA_RELEASE_DIR || join(projectRoot, 'release'));
const temporaryRoot = resolve(process.env.VELA_BUILD_TEMP_DIR || tmpdir());
mkdirSync(temporaryRoot, { recursive: true });
const temporaryOutput = mkdtempSync(join(temporaryRoot, 'vela-electron-release-'));
const commandOptions = {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
};

function run(command, args) {
  const result = spawnSync(command, args, commandOptions);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

try {
  assertProjectOwnedNodeModules(projectRoot);
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build']);
  run(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    'electron-builder',
    '--win',
    'nsis',
    `--config.directories.output=${temporaryOutput}`,
  ]);

  const runtime = verifyPackagedRuntime(join(temporaryOutput, 'win-unpacked', 'resources', 'app'));
  console.log(
    `Packaged runtime verified: electron-updater ${runtime.updaterVersion}, `
    + `${runtime.dependencies.length} dependencies resolvable inside the app`
  );

  mkdirSync(releaseDir, { recursive: true });
  const installerName = `Vela-Setup-${packageJson.version}-x64.exe`;
  const artifacts = [installerName, `${installerName}.blockmap`, 'latest.yml'];

  for (const artifact of artifacts) {
    const source = join(temporaryOutput, artifact);
    copyArtifact(source, join(releaseDir, artifact));
  }

  console.log(`Windows installer copied to ${releaseDir}`);
  rmSync(temporaryOutput, { recursive: true, force: true });
} catch (error) {
  console.error(`Windows packaging workspace retained at ${temporaryOutput}`);
  throw error;
}
