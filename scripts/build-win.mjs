import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

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
const releaseDir = join(projectRoot, 'release');
const temporaryOutput = mkdtempSync(join(tmpdir(), 'vela-electron-release-'));
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
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build']);
  run(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    'electron-builder',
    '--win',
    'nsis',
    `--config.directories.output=${temporaryOutput}`,
  ]);

  mkdirSync(releaseDir, { recursive: true });
  const artifacts = readdirSync(temporaryOutput).filter(
    (name) => name === 'latest.yml' || /^Vela-Setup-.*-x64\.exe(?:\.blockmap)?$/.test(name),
  );

  for (const artifact of artifacts) {
    const source = join(temporaryOutput, artifact);
    copyArtifact(source, join(releaseDir, basename(source)));
  }

  console.log(`Windows installer copied to ${releaseDir}`);
  rmSync(temporaryOutput, { recursive: true, force: true });
} catch (error) {
  console.error(`Windows packaging workspace retained at ${temporaryOutput}`);
  throw error;
}
