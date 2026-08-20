import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

import { atomicWriteFile } from './projectStore.js';

const FORMAT = 'vela-portable-backup';
const VERSION = 1;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const MIN_PASSWORD_LENGTH = 8;
const MAX_KEY_BYTES = 1024 * 1024;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const assertPassword = (password) => {
  const normalized = String(password || '');
  if (normalized.length < MIN_PASSWORD_LENGTH) throw new Error('迁移密码至少需要 8 个字符');
  return normalized;
};

const deriveKey = (password, salt) => crypto.scryptSync(password, salt, KEY_BYTES, {
  N: 32768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
});

const encryptPayload = (payload, password) => {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(assertPassword(password), salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 });
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return Buffer.from(JSON.stringify({
    format: FORMAT,
    version: VERSION,
    kdf: { name: 'scrypt', salt: salt.toString('base64'), N: 32768, r: 8, p: 1 },
    cipher: { name: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') },
    ciphertext: ciphertext.toString('base64')
  }), 'utf8');
};

const decryptPayload = (buffer, password) => {
  let envelope;
  try { envelope = JSON.parse(Buffer.from(buffer).toString('utf8')); }
  catch { throw new Error('迁移包格式无效'); }
  if (envelope?.format !== FORMAT || envelope?.version !== VERSION) throw new Error('不支持的迁移包版本');
  try {
    const salt = Buffer.from(envelope.kdf.salt, 'base64');
    const iv = Buffer.from(envelope.cipher.iv, 'base64');
    const tag = Buffer.from(envelope.cipher.tag, 'base64');
    const key = deriveKey(assertPassword(password), salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
    return JSON.parse(gunzipSync(compressed).toString('utf8'));
  } catch (error) {
    if (/至少需要/.test(error?.message || '')) throw error;
    throw new Error('迁移密码错误或迁移包已损坏');
  }
};

const profileSecretDraft = (profile) => profile.type === 'gpt'
  ? { apiKey: profile.secret?.apiKey }
  : {
    token: profile.secret?.token,
    username: profile.secret?.username,
    password: profile.secret?.password,
    customHeaders: profile.secret?.customHeaders,
    autodlDeveloperToken: profile.secret?.autodlDeveloperToken
  };

const removeUndefined = (value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

export class PortableBackupService {
  constructor({ dataDirectory, projectStore, profileRepository, ecommerceWorkflowStore }) {
    this.dataDirectory = path.resolve(dataDirectory);
    this.projectStore = projectStore;
    this.profiles = profileRepository;
    this.ecommerceWorkflows = ecommerceWorkflowStore;
    this.keysDirectory = path.join(this.dataDirectory, 'portable-keys');
  }

  export(password) {
    const profiles = this.profiles.list().map((publicProfile) => {
      const profile = this.profiles.getWithSecret(publicProfile.id);
      if (profile.credentialStatus === 'unreadable') {
        throw new Error(`账户“${profile.name}”的密钥无法解密，请先在 API 设置中重新保存`);
      }
      let sshPrivateKey;
      if (profile.type === 'comfy' && profile.transport === 'ssh' && profile.sshPrivateKeyPath) {
        if (!fs.existsSync(profile.sshPrivateKeyPath)) throw new Error(`算力“${profile.name}”的 SSH 私钥文件不存在`);
        const data = fs.readFileSync(profile.sshPrivateKeyPath);
        if (!data.length || data.length > MAX_KEY_BYTES) throw new Error(`算力“${profile.name}”的 SSH 私钥文件无效`);
        sshPrivateKey = {
          fileName: path.basename(profile.sshPrivateKeyPath),
          dataBase64: data.toString('base64'),
          sha256: sha256(data)
        };
      }
      const { secret, ...publicAndStatus } = profile;
      return {
        profile: publicAndStatus,
        secret: profile.secret || null,
        sshPrivateKey
      };
    });
    const projects = this.projectStore.listProjects().map((project) => this.projectStore.exportProject(project.id, { includeMedia: true }));
    return encryptPayload({
      format: FORMAT,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      profiles,
      projects,
      ecommerceDeletedIds: [...this.ecommerceWorkflows.deletedIds]
    }, password);
  }

  import(buffer, password) {
    const payload = decryptPayload(buffer, password);
    if (payload?.format !== FORMAT || payload?.version !== VERSION) throw new Error('迁移包内容无效');
    const restoredProfiles = [];
    const restoredProjects = [];
    fs.mkdirSync(this.keysDirectory, { recursive: true });

    for (const item of Array.isArray(payload.profiles) ? payload.profiles : []) {
      const profile = item?.profile;
      if (!profile?.id || !['gpt', 'comfy'].includes(profile.type)) throw new Error('迁移包包含无效账户');
      let sshPrivateKeyPath = profile.sshPrivateKeyPath;
      if (item.sshPrivateKey) {
        const data = Buffer.from(item.sshPrivateKey.dataBase64 || '', 'base64');
        if (!data.length || data.length > MAX_KEY_BYTES || sha256(data) !== item.sshPrivateKey.sha256) {
          throw new Error(`账户“${profile.name}”的 SSH 私钥校验失败`);
        }
        const safeName = path.basename(item.sshPrivateKey.fileName || 'id_ed25519').replace(/[^a-z0-9._-]/gi, '-');
        sshPrivateKeyPath = path.join(this.keysDirectory, `${profile.id}-${safeName}`);
        atomicWriteFile(sshPrivateKeyPath, data);
        try { fs.chmodSync(sshPrivateKeyPath, 0o600); } catch { /* Windows permissions inherit from the user data directory. */ }
      }
      const draft = removeUndefined({
        ...profile,
        sshPrivateKeyPath,
        ...profileSecretDraft({ ...profile, secret: item.secret })
      });
      const restored = this.profiles.get(profile.id)
        ? this.profiles.update(profile.id, draft)
        : this.profiles.create(draft);
      restoredProfiles.push(restored.id);
    }

    for (const archive of Array.isArray(payload.projects) ? payload.projects : []) {
      restoredProjects.push(this.projectStore.importProject(archive, { name: archive?.project?.name }));
    }

    if (Array.isArray(payload.ecommerceDeletedIds)) {
      this.ecommerceWorkflows.deletedIds = new Set(payload.ecommerceDeletedIds.filter((id) => this.ecommerceWorkflows.catalog.has(id)));
      this.ecommerceWorkflows.persist();
    }
    return {
      profiles: restoredProfiles.length,
      projects: restoredProjects.length,
      projectIds: restoredProjects.map((project) => project.id)
    };
  }
}

export const portableBackupCrypto = { encryptPayload, decryptPayload };
