import path from 'node:path';

import { AutoDlPowerProvider } from '../server/providers/autodlPowerProvider.js';
import { VelaDatabase } from '../server/vela/database.js';
import { ProfileRepository } from '../server/vela/profileRepository.js';
import { SecretProtector } from '../server/vela/secretProtector.js';

const [dataDirectoryArg, profileId, action, instanceUuidOverride] = process.argv.slice(2);
if (!dataDirectoryArg || !profileId || !['status', 'power-on', 'power-off', 'snapshot', 'refresh-ssh'].includes(action)) {
  throw new Error('Usage: autodl-instance-control.mjs <data-dir> <profile-id> <status|power-on|power-off|snapshot|refresh-ssh>');
}

const dataDirectory = path.resolve(dataDirectoryArg);
const database = new VelaDatabase(path.join(dataDirectory, 'database', 'vela.sqlite'));
const profiles = new ProfileRepository(database, new SecretProtector({
  keyPath: path.join(dataDirectory, 'secrets', 'profile-master.key')
}));
const provider = new AutoDlPowerProvider();

try {
  const storedProfile = profiles.getWithSecret(profileId);
  if (!storedProfile?.secret?.autodlDeveloperToken) throw new Error('AutoDL profile 或加密凭据不可用');
  const profile = instanceUuidOverride
    ? { ...storedProfile, autodlInstanceUuid: instanceUuidOverride }
    : storedProfile;
  if (action === 'power-on') {
    await provider.powerOn(profile, profile.secret);
    await provider.waitForState(profile, profile.secret, ['running'], { timeoutMs: profile.powerOnTimeoutMs });
  } else if (action === 'power-off') {
    const current = String(await provider.getStatus(profile, profile.secret)).toLowerCase();
    if (!['shutdown', 'stopped'].includes(current)) {
      await provider.powerOff(profile, profile.secret);
      await provider.waitForState(profile, profile.secret, ['shutdown', 'stopped'], { timeoutMs: 15 * 60_000 });
    }
  }
  const status = await provider.getStatus(profile, profile.secret);
  if (['snapshot', 'refresh-ssh'].includes(action)) {
    const snapshot = await provider.getSnapshot(profile, profile.secret);
    const sshHost = String(snapshot?.proxy_host || '');
    const sshPort = Number(snapshot?.ssh_port) || 0;
    if (action === 'refresh-ssh') {
      if (!sshHost || !sshPort) throw new Error('AutoDL 快照尚未返回 SSH 连接信息');
      profiles.update(storedProfile.id, { sshHost, sshPort });
    }
    console.log(JSON.stringify({
      profileId: profile.id,
      instanceUuid: profile.autodlInstanceUuid,
      status,
      gpuName: String(snapshot?.snapshot_gpu_alias_name || ''),
      sshHost,
      sshPort,
      refreshed: action === 'refresh-ssh',
      rootFsUsedBytes: Math.max(0, Number(snapshot?.usage_info?.root_fs_used_size) || 0),
      rootFsTotalBytes: Math.max(0, Number(snapshot?.usage_info?.root_fs_total_size) || 0),
      dataDiskTotalBytes: Math.max(0, Number(snapshot?.usage_info?.data_disk_total_size) || 0)
    }));
  } else {
    console.log(JSON.stringify({
      profileId: profile.id,
      instanceUuid: profile.autodlInstanceUuid,
      status
    }));
  }
} finally {
  database.close();
}
