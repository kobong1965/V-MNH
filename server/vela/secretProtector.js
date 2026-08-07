import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const VERSION = 1;
const IV_BYTES = 12;

const ensureKey = (value) => {
  const key = Buffer.isBuffer(value) ? value : Buffer.from(value || '');
  if (key.length !== 32) throw new Error('Profile encryption key must be 32 bytes');
  return key;
};

const loadOrCreateKey = (keyPath) => {
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  if (fs.existsSync(keyPath)) return ensureKey(fs.readFileSync(keyPath));
  const key = crypto.randomBytes(32);
  try {
    fs.writeFileSync(keyPath, key, { flag: 'wx', mode: 0o600 });
    try { fs.chmodSync(keyPath, 0o600); } catch { /* Windows ACLs are handled by the user profile. */ }
    return key;
  } catch (error) {
    if (error?.code === 'EEXIST') return ensureKey(fs.readFileSync(keyPath));
    throw error;
  }
};

export class SecretProtector {
  constructor({ key, keyPath } = {}) {
    if (!key && !keyPath) throw new Error('key or keyPath is required');
    this.key = key ? ensureKey(key) : loadOrCreateKey(path.resolve(keyPath));
  }

  encrypt(value) {
    const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]);
  }

  decrypt(envelope) {
    const buffer = Buffer.from(envelope || []);
    if (buffer.length < 1 + IV_BYTES + 16 || buffer[0] !== VERSION) {
      throw new Error('Unsupported encrypted profile secret');
    }
    const iv = buffer.subarray(1, 1 + IV_BYTES);
    const tag = buffer.subarray(1 + IV_BYTES, 1 + IV_BYTES + 16);
    const ciphertext = buffer.subarray(1 + IV_BYTES + 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
  }
}
