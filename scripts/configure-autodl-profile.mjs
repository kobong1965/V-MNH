import path from 'node:path';

import { VelaDatabase } from '../server/vela/database.js';
import { ProfileRepository } from '../server/vela/profileRepository.js';
import { SecretProtector } from '../server/vela/secretProtector.js';

const [dataDirectory, profileId, instanceUuid, sshHost, sshPortText, sshPrivateKeyPath] = process.argv.slice(2);
const developerToken = String(process.env.VELA_AUTODL_DEVELOPER_TOKEN || '').trim();

if (!dataDirectory || !profileId || !instanceUuid || !sshHost || !sshPortText || !sshPrivateKeyPath) {
  throw new Error('Usage: configure-autodl-profile.mjs <data-dir> <profile-id> <instance-uuid> <ssh-host> <ssh-port> <private-key>');
}
if (!developerToken) throw new Error('VELA_AUTODL_DEVELOPER_TOKEN is required');

const resolvedDataDirectory = path.resolve(dataDirectory);
const database = new VelaDatabase(path.join(resolvedDataDirectory, 'database', 'vela.sqlite'));
const secretProtector = new SecretProtector({
  keyPath: path.join(resolvedDataDirectory, 'secrets', 'profile-master.key')
});
const profiles = new ProfileRepository(database, secretProtector);

try {
  const updated = profiles.update(profileId, {
    name: 'AutoDL MiniMax H3 Pro',
    platform: 'autodl',
    baseUrl: 'http://127.0.0.1:18188',
    websocketUrl: 'ws://127.0.0.1:18188/ws',
    transport: 'ssh',
    sshHost,
    sshPort: Number(sshPortText),
    sshUsername: 'root',
    sshPrivateKeyPath: path.resolve(sshPrivateKeyPath),
    sshLocalPort: 18188,
    sshRemoteHost: '127.0.0.1',
    sshRemotePort: 6006,
    sshStartScript: '/root/autodl-tmp/vela-h3/deploy/start-comfy.sh',
    autoPowerEnabled: true,
    autodlInstanceUuid: instanceUuid,
    idleShutdownMinutes: 5,
    powerOnTimeoutMs: 10 * 60_000,
    autodlDeveloperToken: developerToken,
    authType: 'none',
    timeoutMs: 30_000,
    maxConcurrency: 1,
    workflowVersion: 'minimax-h3-pro-v1',
    tags: ['AutoDL Pro', 'MiniMax H3', 'RTX PRO 6000'],
    notes: 'AutoDL 容器实例 Pro；任务到达自动开机，连续空闲 5 分钟后安全关机。'
  });
  console.log(JSON.stringify({
    id: updated.id,
    name: updated.name,
    baseUrl: updated.baseUrl,
    sshHost: updated.sshHost,
    sshPort: updated.sshPort,
    autodlInstanceUuid: updated.autodlInstanceUuid,
    autoPowerEnabled: updated.autoPowerEnabled,
    autoPowerCredentialStatus: updated.autoPowerCredentialStatus
  }));
} finally {
  database.close();
}
