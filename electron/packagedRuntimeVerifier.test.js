import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertProjectOwnedNodeModules,
  verifyPackagedRuntime
} from './packagedRuntimeVerifier.js';

const writePackage = async (directory, packageJson, entry = 'index.js') => {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ main: entry, ...packageJson }));
  await mkdir(path.dirname(path.join(directory, entry)), { recursive: true });
  await writeFile(path.join(directory, entry), 'export default {};\n');
};

test('packaged runtime verification rejects a missing electron-updater dependency', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-packaged-runtime-missing-'));
  try {
    await writePackage(
      path.join(directory, 'node_modules', 'electron-updater'),
      { name: 'electron-updater', version: '1.0.0', main: 'out/main.js', dependencies: { 'fs-extra': '^10.0.0' } },
      'out/main.js'
    );

    assert.throws(
      () => verifyPackagedRuntime(directory),
      /electron-updater dependencies are incomplete: fs-extra/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('packaged runtime verification accepts dependencies resolvable inside the app', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-packaged-runtime-complete-'));
  try {
    await writePackage(
      path.join(directory, 'node_modules', 'electron-updater'),
      { name: 'electron-updater', version: '6.8.9', main: 'out/main.js', dependencies: { 'fs-extra': '^10.0.0' } },
      'out/main.js'
    );
    await writePackage(
      path.join(directory, 'node_modules', 'fs-extra'),
      { name: 'fs-extra', version: '10.1.0' }
    );

    assert.deepEqual(verifyPackagedRuntime(directory), {
      updaterVersion: '6.8.9',
      dependencies: ['fs-extra']
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('packaging rejects node_modules that resolves outside the project', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-packaging-root-'));
  const projectRoot = path.join(directory, 'project');
  const externalNodeModules = path.join(directory, 'external-node-modules');
  try {
    await mkdir(projectRoot, { recursive: true });
    await mkdir(externalNodeModules, { recursive: true });
    await symlink(
      externalNodeModules,
      path.join(projectRoot, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    assert.throws(
      () => assertProjectOwnedNodeModules(projectRoot),
      /requires a real node_modules directory inside the project/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
