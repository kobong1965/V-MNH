import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const VERSION = 1;
const IV_BYTES = 12;
const BACKUP_SUFFIX = '.backup';

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

const loadKeyRing = (keyPath) => {
  const primary = loadOrCreateKey(keyPath);
  const backupPath = `${keyPath}${BACKUP_SUFFIX}`;
  let backup;
  try {
    fs.writeFileSync(backupPath, primary, { flag: 'wx', mode: 0o600 });
    try { fs.chmodSync(backupPath, 0o600); } catch { /* Windows ACLs are handled by the user profile. */ }
    backup = primary;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    backup = ensureKey(fs.readFileSync(backupPath));
  }
  return [primary, backup].filter((key, index, keys) =>
    keys.findIndex((candidate) => candidate.equals(key)) === index
  );
};

export class SecretProtector {
  constructor({ key, keyPath } = {}) {
    if (!key && !keyPath) throw new Error('key or keyPath is required');
    this.keys = key ? [ensureKey(key)] : loadKeyRing(path.resolve(keyPath));
    this.key = this.keys[0];
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
    for (const key of this.keys) {
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
      } catch { /* Try the protected backup key before declaring the credential unreadable. */ }
    }
    const error = new Error('已保存的账户密钥无法解密，请重新输入 API Key');
    error.code = 'CREDENTIAL_UNREADABLE';
    throw error;
  }
}
