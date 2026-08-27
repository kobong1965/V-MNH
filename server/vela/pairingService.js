import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PAIRING_CODE_TTL_MS = 30 * 60 * 1000;

const digest = (value) => createHash('sha256').update(value).digest('hex');
const safeEqual = (left, right) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export const isLoopbackRequest = (request) => {
  const address = request.socket?.remoteAddress || request.ip || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
};

export function createPairingService({ dataDirectory, now = () => Date.now(), codeFactory } = {}) {
  const storePath = path.join(dataDirectory || process.cwd(), 'storyworks-connections.json');
  const createCode = codeFactory || (() => String(randomInt(0, 1_000_000)).padStart(6, '0'));
  let pairingCode = createCode();
  let expiresAt = now() + PAIRING_CODE_TTL_MS;
  let clients = [];

  try {
    const stored = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    clients = Array.isArray(stored.clients)
      ? stored.clients.filter((client) => client && typeof client.tokenHash === 'string')
      : [];
  } catch { /* first launch or unreadable legacy file */ }

  const persist = () => {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    const temporary = `${storePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, clients }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    try { fs.renameSync(temporary, storePath); }
    catch { fs.copyFileSync(temporary, storePath); fs.unlinkSync(temporary); }
  };

  const ensureFreshCode = () => {
    if (now() < expiresAt) return;
    pairingCode = createCode();
    expiresAt = now() + PAIRING_CODE_TTL_MS;
  };

  return {
    info() {
      ensureFreshCode();
      return {
        pairingCode,
        expiresAt: new Date(expiresAt).toISOString(),
        connectedClients: clients.length,
        clients: clients.map(({ id, name, createdAt }) => ({ id, name, createdAt }))
      };
    },
    rotateCode() {
      pairingCode = createCode();
      expiresAt = now() + PAIRING_CODE_TTL_MS;
      return this.info();
    },
    pair(code, name = 'Storyworks') {
      ensureFreshCode();
      if (typeof code !== 'string' || !safeEqual(code.trim(), pairingCode) || now() >= expiresAt) {
        throw new Error('连接码无效或已过期，请在 Vela 设置页重新获取。');
      }
      const token = `vela_${randomBytes(32).toString('base64url')}`;
      const client = {
        id: randomBytes(8).toString('hex'),
        name: String(name || 'Storyworks').trim().slice(0, 80) || 'Storyworks',
        tokenHash: digest(token),
        createdAt: new Date(now()).toISOString()
      };
      clients = [...clients, client].slice(-24);
      persist();
      return { token, client: { id: client.id, name: client.name, createdAt: client.createdAt } };
    },
    verify(token) {
      if (typeof token !== 'string' || !token) return false;
      const tokenHash = digest(token);
      return clients.some((client) => safeEqual(client.tokenHash, tokenHash));
    },
    revokeAll() {
      clients = [];
      persist();
      return this.info();
    }
  };
}
