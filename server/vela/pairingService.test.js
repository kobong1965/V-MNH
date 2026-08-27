import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createPairingService } from './pairingService.js';

test('pairing code issues a token and persists only its hash', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-pairing-'));
  try {
    const service = createPairingService({ dataDirectory: directory, codeFactory: () => '123456' });
    const paired = service.pair('123456', 'Storyworks test');
    assert.match(paired.token, /^vela_/);
    assert.equal(service.verify(paired.token), true);
    assert.equal(service.verify('vela_invalid'), false);

    const reloaded = createPairingService({ dataDirectory: directory, codeFactory: () => '654321' });
    assert.equal(reloaded.verify(paired.token), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('expired or incorrect pairing codes are rejected', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-pairing-'));
  let current = 1_000;
  try {
    const service = createPairingService({ dataDirectory: directory, now: () => current, codeFactory: () => current === 1_000 ? '111111' : '222222' });
    assert.throws(() => service.pair('000000'), /无效或已过期/);
    current += 31 * 60 * 1000;
    assert.equal(service.info().pairingCode, '222222');
    assert.throws(() => service.pair('111111'), /无效或已过期/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
