import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';

export const PAIRING_CODE_TTL_MS = 30 * 60 * 1000;
export const VELA_FULL_ACCESS_SCOPE = 'vela:full';
export const MATERIALS_READ_SCOPE = 'materials:read';
export const REMOTE_PAIRING_MAX_FAILURES = 6;
export const REMOTE_PAIRING_WINDOW_MS = 60 * 1000;
export const REMOTE_PAIRING_BLOCK_MS = 10 * 60 * 1000;

const SUPPORTED_CLIENT_SCOPES = new Set([VELA_FULL_ACCESS_SCOPE, MATERIALS_READ_SCOPE]);
const CLIENT_KEY = /^[a-z0-9][a-z0-9._-]{0,79}$/i;

export const isMaterialsReadOnlyClient = (client) => (
  Array.isArray(client?.scopes)
  && client.scopes.includes(MATERIALS_READ_SCOPE)
  && !client.scopes.includes(VELA_FULL_ACCESS_SCOPE)
);

// A LAN pairing code proves physical-network proximity, not permission to run
// generation or destructive project actions. Remote companion applications
// must request the single read-only material scope explicitly.
export const isValidRemotePairingScopes = (scopes) => (
  Array.isArray(scopes)
  && scopes.length === 1
  && scopes[0] === MATERIALS_READ_SCOPE
);

export function createRemotePairingAttemptLimiter({
  now = () => Date.now(),
  maxFailures = REMOTE_PAIRING_MAX_FAILURES,
  windowMs = REMOTE_PAIRING_WINDOW_MS,
  blockMs = REMOTE_PAIRING_BLOCK_MS
} = {}) {
  const attempts = new Map();
  const keyFor = (address) => String(address || 'unknown').trim().slice(0, 128) || 'unknown';
  const status = (address) => {
    const key = keyFor(address);
    const currentTime = now();
    const entry = attempts.get(key);
    if (!entry) return { allowed: true, retryAfterMs: 0 };
    if (entry.blockedUntil > currentTime) {
      return { allowed: false, retryAfterMs: entry.blockedUntil - currentTime };
    }
    if (currentTime - entry.windowStartedAt >= windowMs) attempts.delete(key);
    return { allowed: true, retryAfterMs: 0 };
  };
  return {
    check(address) {
      return status(address);
    },
    recordFailure(address) {
      const key = keyFor(address);
      const currentTime = now();
      const existing = attempts.get(key);
      const entry = !existing || currentTime - existing.windowStartedAt >= windowMs
        ? { windowStartedAt: currentTime, failures: 0, blockedUntil: 0 }
        : existing;
      entry.failures += 1;
      if (entry.failures >= maxFailures) entry.blockedUntil = currentTime + blockMs;
      attempts.set(key, entry);
      if (attempts.size > 512) {
        for (const [candidateKey, candidate] of attempts) {
          if (candidate.blockedUntil <= currentTime && currentTime - candidate.windowStartedAt >= windowMs) {
            attempts.delete(candidateKey);
          }
        }
      }
      return status(key);
    },
    recordSuccess(address) {
      attempts.delete(keyFor(address));
    }
  };
}

export const isMaterialsReadRouteAllowed = (method, requestPath) => {
  if (method === 'GET' && requestPath === '/capabilities') return true;
  if (method === 'GET' && requestPath === '/sync-inbox') return true;
  if (method === 'POST' && /^\/sync-inbox\/[^/]+\/ack$/.test(requestPath)) return true;
  if (method === 'GET' && /^\/batches\/[^/]+\/sync-manifest$/.test(requestPath)) return true;
  return method === 'GET' && /^\/projects\/[^/]+\/media\/[^/]+\/file$/.test(requestPath);
};

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

const requestHeader = (request, name) => String(
  request.get?.(name)
  || request.headers?.[name.toLowerCase()]
  || ''
).trim();

/**
 * Reject browser cross-site requests while keeping same-origin Vela UI and
 * native desktop clients (which do not send browser Origin metadata) working.
 */
export const isTrustedVelaRequestOrigin = (request, additionalTrustedOrigins = []) => {
  const origin = requestHeader(request, 'origin');
  const fetchSite = requestHeader(request, 'sec-fetch-site').toLowerCase();
  if (!origin) return !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none';
  try {
    const parsed = new URL(origin);
    const host = requestHeader(request, 'host').toLowerCase();
    if (parsed.protocol !== 'http:') return false;
    if (
      Boolean(host)
      && parsed.host.toLowerCase() === host
      && (parsed.hostname === 'localhost' || isIP(parsed.hostname) > 0)
    ) return true;
    if (additionalTrustedOrigins.some((candidate) => candidate === parsed.origin)) return true;
    return false;
  } catch {
    return false;
  }
};

const isMissingFile = (error) => error && typeof error === 'object' && error.code === 'ENOENT';

const normalizeStoredClients = (stored) => {
  if (!stored || typeof stored !== 'object' || !Array.isArray(stored.clients) || stored.clients.length > 24) {
    throw new Error('连接记录格式无效');
  }
  return stored.clients.map((client) => {
    if (
      !client
      || typeof client !== 'object'
      || typeof client.id !== 'string'
      || !client.id
      || client.id.length > 128
      || typeof client.name !== 'string'
      || !client.name.trim()
      || client.name.length > 80
      || typeof client.tokenHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(client.tokenHash)
      || typeof client.createdAt !== 'string'
      || !Number.isFinite(Date.parse(client.createdAt))
      || (client.clientKey !== undefined && !CLIENT_KEY.test(String(client.clientKey)))
    ) {
      throw new Error('连接记录中的客户端无效');
    }
    const scopes = client.scopes === undefined
      ? [VELA_FULL_ACCESS_SCOPE]
      : Array.isArray(client.scopes)
        ? [...new Set(client.scopes)]
        : [];
    if (!scopes.length || scopes.some((scope) => !SUPPORTED_CLIENT_SCOPES.has(scope))) {
      throw new Error('连接记录中的权限无效');
    }
    return {
      ...client,
      name: client.name.trim(),
      scopes,
      ...(client.clientKey === undefined ? {} : { clientKey: String(client.clientKey) })
    };
  });
};

const readClientStore = (filePath) => normalizeStoredClients(JSON.parse(fs.readFileSync(filePath, 'utf8')));

const writeClientStore = (filePath, clients) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ version: 2, clients }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.renameSync(temporary, filePath);
  } catch {
    try {
      fs.copyFileSync(temporary, filePath);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
};

export function createPairingService({ dataDirectory, now = () => Date.now(), codeFactory } = {}) {
  const storePath = path.join(dataDirectory || process.cwd(), 'storyworks-connections.json');
  const backupPath = `${storePath}.bak`;
  const createCode = codeFactory || (() => String(randomInt(0, 1_000_000)).padStart(6, '0'));
  let pairingCode = createCode();
  let expiresAt = now() + PAIRING_CODE_TTL_MS;
  let clients = [];
  let loadedPrimary = false;
  let recoveredFromBackup = false;
  try {
    clients = readClientStore(storePath);
    loadedPrimary = true;
  } catch (primaryError) {
    if (isMissingFile(primaryError)) {
      try {
        clients = readClientStore(backupPath);
        recoveredFromBackup = true;
      } catch (backupError) {
        if (!isMissingFile(backupError)) {
          throw new Error('Vela 连接记录备份已损坏，原文件已保留', { cause: backupError });
        }
      }
    } else {
      try {
        clients = readClientStore(backupPath);
        recoveredFromBackup = true;
        fs.copyFileSync(storePath, `${storePath}.corrupt-${String(now())}-${randomBytes(4).toString('hex')}`);
      } catch (backupError) {
        throw new Error('Vela 连接记录已损坏且无法从备份恢复，原文件已保留', {
          cause: isMissingFile(backupError) ? primaryError : backupError
        });
      }
    }
  }

  if (loadedPrimary) {
    // Refresh the last-known-good copy on every clean start. This gives an
    // existing installation recovery protection before its next pairing.
    writeClientStore(backupPath, clients);
  } else if (recoveredFromBackup) {
    // A valid backup was used. Restore the primary atomically without deleting
    // the preserved corrupt copy above.
    writeClientStore(storePath, clients);
    writeClientStore(backupPath, clients);
  }

  const persist = (nextClients) => {
    // Commit to memory only after both durable files are written. If the disk
    // is full or locked, the currently valid token must keep working.
    writeClientStore(backupPath, nextClients);
    writeClientStore(storePath, nextClients);
    clients = nextClients;
  };

  const ensureFreshCode = () => {
    if (now() < expiresAt) return;
    pairingCode = createCode();
    expiresAt = now() + PAIRING_CODE_TTL_MS;
  };

  const normalizeScopes = (value) => {
    if (value === undefined) return [VELA_FULL_ACCESS_SCOPE];
    if (!Array.isArray(value) || value.length === 0 || value.length > SUPPORTED_CLIENT_SCOPES.size) {
      throw new Error('客户端权限无效');
    }
    const scopes = [...new Set(value.map((scope) => String(scope || '').trim()))];
    if (!scopes.length || scopes.some((scope) => !SUPPORTED_CLIENT_SCOPES.has(scope))) {
      throw new Error('客户端权限无效');
    }
    if (scopes.includes(VELA_FULL_ACCESS_SCOPE)) {
      throw new Error('全权限连接必须由 Vela 兼容客户端按旧版手动流程建立');
    }
    return scopes;
  };
  const normalizeClientKey = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const clientKey = String(value).trim();
    if (!CLIENT_KEY.test(clientKey)) throw new Error('客户端标识无效');
    return clientKey;
  };
  const publicClient = ({ id, name, createdAt, scopes }) => ({
    id,
    name,
    createdAt,
    scopes: [...scopes]
  });
  const identify = (token) => {
    if (typeof token !== 'string' || !token) return null;
    const tokenHash = digest(token);
    const client = clients.find((candidate) => safeEqual(candidate.tokenHash, tokenHash));
    return client ? publicClient(client) : null;
  };

  return {
    listClients() {
      return clients.map(publicClient);
    },
    info() {
      ensureFreshCode();
      return {
        pairingCode,
        expiresAt: new Date(expiresAt).toISOString(),
        connectedClients: clients.length,
        clients: this.listClients()
      };
    },
    rotateCode() {
      pairingCode = createCode();
      expiresAt = now() + PAIRING_CODE_TTL_MS;
      return this.info();
    },
    pair(code, name = 'Storyworks', options = {}) {
      ensureFreshCode();
      if (typeof code !== 'string' || !safeEqual(code.trim(), pairingCode) || now() >= expiresAt) {
        throw new Error('连接码无效或已过期，请在 Vela 设置页重新获取。');
      }
      const token = `vela_${randomBytes(32).toString('base64url')}`;
      const scopes = normalizeScopes(options?.scopes);
      const clientKey = normalizeClientKey(options?.clientKey);
      const existing = clientKey ? clients.find((candidate) => candidate.clientKey === clientKey) : null;
      const client = {
        id: existing?.id || randomBytes(8).toString('hex'),
        name: String(name || 'Storyworks').trim().slice(0, 80) || 'Storyworks',
        tokenHash: digest(token),
        createdAt: existing?.createdAt || new Date(now()).toISOString(),
        scopes,
        ...(clientKey ? { clientKey } : {})
      };
      if (!existing && clients.length >= 24) {
        throw new Error('已达到 24 个外部软件连接上限，请先断开不再使用的连接。');
      }
      const nextClients = existing
        ? clients.map((candidate) => candidate === existing ? client : candidate)
        : [...clients, client];
      persist(nextClients);
      return { token, client: publicClient(client) };
    },
    verify(token) {
      return Boolean(identify(token));
    },
    identify(token) {
      return identify(token);
    },
    revokeAll() {
      persist([]);
      return this.info();
    }
  };
}
