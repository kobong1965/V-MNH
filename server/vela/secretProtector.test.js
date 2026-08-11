import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { SecretProtector } from './secretProtector.js';

test('disk key backup keeps saved credentials readable if the primary key is replaced', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-secret-backup-'));
  const keyPath = path.join(directory, 'profile-master.key');
  try {
    const original = new SecretProtector({ keyPath });
    const envelope = original.encrypt({ apiKey: 'sk-backup-test' });
    assert.ok(fs.existsSync(`${keyPath}.backup`));

    fs.writeFileSync(keyPath, Buffer.alloc(32, 3));
    const recovered = new SecretProtector({ keyPath });
    assert.deepEqual(recovered.decrypt(envelope), { apiKey: 'sk-backup-test' });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
