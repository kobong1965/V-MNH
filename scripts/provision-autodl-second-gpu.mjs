import path from 'node:path';

import { AutoDlPowerProvider } from '../server/providers/autodlPowerProvider.js';
import { VelaDatabase } from '../server/vela/database.js';
import { ProfileRepository } from '../server/vela/profileRepository.js';
import { SecretProtector } from '../server/vela/secretProtector.js';

const IMAGE_NAME = 'Vela MiniMax H3 Dual GPU 20260820';
const INSTANCE_NAME = 'Vela MiniMax H3 GPU 2';
const PROFILE_NAME = 'AutoDL MiniMax H3 Pro GPU 2';
const GiB = 1024 ** 3;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const [dataDirectoryArg, sourceProfileId, mode = '--inspect'] = process.argv.slice(2);
if (!dataDirectoryArg || !sourceProfileId || !['--inspect', '--create', '--create-base'].includes(mode)) {
  throw new Error('Usage: provision-autodl-second-gpu.mjs <data-dir> <source-profile-id> [--inspect|--create|--create-base]');
}

const dataDirectory = path.resolve(dataDirectoryArg);
const database = new VelaDatabase(path.join(dataDirectory, 'database', 'vela.sqlite'));
const secretProtector = new SecretProtector({
  keyPath: path.join(dataDirectory, 'secrets', 'profile-master.key')
});
const profiles = new ProfileRepository(database, secretProtector);
const provider = new AutoDlPowerProvider();

const safeInstance = (instance) => ({
  uuid: String(instance?.uuid || ''),
  name: String(instance?.name || ''),
  status: String(instance?.status || 'unknown'),
  gpuSpecUuid: String(instance?.gpu_spec_uuid || ''),
  regionName: String(instance?.region_name || '')
});

const waitForImage = async (source, imageUuid, timeoutMs = 4 * 60 * 60_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const repository = await provider.listPrivateImages(source, source.secret, { pageSize: 50 });
    const image = (repository?.list || []).find((item) => item?.image_uuid === imageUuid);
    const status = String(image?.status || 'pending').toLowerCase();
    if (status === 'finished') return image;
    if (['failed', 'error', 'cancelled'].includes(status)) {
      throw new Error(`AutoDL 私有镜像保存失败，状态：${status}`);
    }
    await delay(30_000);
  }
  throw new Error('等待 AutoDL 私有镜像完成超时');
};

const waitForSnapshot = async (source, instanceUuid, timeoutMs = 20 * 60_000) => {
  const target = { ...source, autodlInstanceUuid: instanceUuid };
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const snapshot = await provider.getSnapshot(target, source.secret);
      if (snapshot?.proxy_host && snapshot?.ssh_port) return snapshot;
    } catch (error) {
      lastError = error;
    }
    await delay(10_000);
  }
  throw new Error(`等待第二实例连接信息超时：${lastError?.message || 'snapshot unavailable'}`);
};

const registerSecondaryProfile = (source, instanceUuid, snapshot) => {
  const existing = profiles.list({ type: 'comfy' })
    .find((profile) => profile.autodlInstanceUuid === instanceUuid || profile.name === PROFILE_NAME);
  const draft = {
    name: PROFILE_NAME,
    platform: 'autodl',
    baseUrl: 'http://127.0.0.1:18189',
    websocketUrl: 'ws://127.0.0.1:18189/ws',
    transport: 'ssh',
    sshHost: String(snapshot.proxy_host),
    sshPort: Number(snapshot.ssh_port),
    sshUsername: source.sshUsername || 'root',
    sshPrivateKeyPath: source.sshPrivateKeyPath,
    sshLocalPort: 18189,
    sshRemoteHost: source.sshRemoteHost || '127.0.0.1',
    sshRemotePort: source.sshRemotePort || 6006,
    sshStartScript: source.sshStartScript || '/root/autodl-tmp/vela-h3/deploy/start-comfy.sh',
    autoPowerEnabled: true,
    autodlInstanceUuid: instanceUuid,
    idleShutdownMinutes: 5,
    powerOnTimeoutMs: source.powerOnTimeoutMs || 10 * 60_000,
    autodlDeveloperToken: source.secret.autodlDeveloperToken,
    authType: source.authType || 'none',
    timeoutMs: source.timeoutMs || 30_000,
    maxConcurrency: 1,
    workflowVersion: source.workflowVersion || 'minimax-h3-pro-v1',
    tags: ['AutoDL Pro', 'MiniMax H3', 'RTX PRO 6000', 'GPU 2'],
    notes: '第二台 AutoDL MiniMax H3；任务到达自动开机，独立空闲 5 分钟后安全关机。'
  };
  return existing
    ? profiles.update(existing.id, draft)
    : profiles.create({ type: 'comfy', ...draft });
};

try {
  const source = profiles.getWithSecret(sourceProfileId);
  if (!source || source.type !== 'comfy' || source.platform !== 'autodl') {
    throw new Error('未找到指定的 AutoDL ComfyUI 源 profile');
  }
  if (!source.secret?.autodlDeveloperToken) {
    throw new Error('源 profile 的 AutoDL Developer Token 不可用');
  }

  const [balance, instanceRepository, imageRepository, sourceStatus, sourceSnapshot] = await Promise.all([
    provider.getWalletBalance(source, source.secret),
    provider.listInstances(source, source.secret, { pageSize: 50 }),
    provider.listPrivateImages(source, source.secret, { pageSize: 50 }),
    provider.getStatus(source, source.secret),
    provider.getSnapshot(source, source.secret)
  ]);
  const allInstances = Array.isArray(instanceRepository?.list) ? instanceRepository.list : [];
  const duplicateTargets = allInstances.filter((item) => item?.name === INSTANCE_NAME && item?.uuid !== source.autodlInstanceUuid);
  if (duplicateTargets.length > 1) {
    throw new Error('检测到多台同名第二实例，已停止以避免继续创建');
  }
  let targetInstance = duplicateTargets[0] || null;
  let image = (imageRepository?.list || []).find((item) => item?.name === IMAGE_NAME) || null;

  console.log(JSON.stringify({
    mode,
    sourceInstanceUuid: source.autodlInstanceUuid,
    sourceStatus,
    accountInstanceCount: Number(instanceRepository?.result_total) || allInstances.length,
    accountImageCount: Number(imageRepository?.result_total) || 0,
    availableBalanceYuan: Math.round((Number(balance?.assets) || 0) * 100) / 100000,
    sourceSnapshot: {
      regionSign: String(sourceSnapshot?.region_sign || ''),
      gpuName: String(sourceSnapshot?.snapshot_gpu_alias_name || ''),
      paygPriceYuan: Math.round((Number(sourceSnapshot?.payg_price) || 0) * 100) / 100000,
      systemDiskTotalBytes: Math.max(0, Number(sourceSnapshot?.usage_info?.root_fs_total_size) || 0),
      systemDiskUsedBytes: Math.max(0, Number(sourceSnapshot?.usage_info?.root_fs_used_size) || 0),
      dataDiskTotalBytes: Math.max(0, Number(sourceSnapshot?.usage_info?.data_disk_total_size) || 0),
      expandedSystemDiskBytes: Math.max(0, Number(sourceSnapshot?.expand_system_disk_size) || 0),
      imageUuid: String(sourceSnapshot?.image_uuid || sourceSnapshot?.snapshot_image_uuid || ''),
      imageName: String(sourceSnapshot?.image_name || sourceSnapshot?.snapshot_image_name || '')
    },
    reusableImage: image ? { imageUuid: image.image_uuid, status: image.status, sizeBytes: Number(image.image_size) || 0 } : null,
    reusableTarget: targetInstance ? safeInstance(targetInstance) : null
  }));

  if (mode === '--inspect') process.exitCode = 0;
  else {
    if (mode === '--create-base') {
      image = {
        image_uuid: 'base-image-l2t43iu6uk',
        name: 'PyTorch 2.0 CUDA 11.8 Ubuntu 20.04 base',
        status: 'finished',
        image_size: 0
      };
    } else if (!image) {
      if (!['shutdown', 'stopped'].includes(String(sourceStatus).toLowerCase())) {
        throw new Error(`保存镜像前源实例必须关机，当前状态：${sourceStatus}`);
      }
      const saved = await provider.savePrivateImage(source, source.secret, { imageName: IMAGE_NAME });
      image = await waitForImage(source, saved?.image_uuid);
    } else if (String(image.status).toLowerCase() !== 'finished') {
      image = await waitForImage(source, image.image_uuid);
    }

    if (!targetInstance) {
      const sourceDataDiskBytes = Math.max(0, Number(sourceSnapshot?.usage_info?.data_disk_total_size) || 0);
      if (mode !== '--create-base' && sourceDataDiskBytes > 0) {
        throw new Error('源实例存在独立数据盘；私有镜像不会复制数据盘，已停止创建第二实例');
      }
      const expandSystemDiskByGb = Math.max(
        0,
        Math.round((Number(sourceSnapshot?.expand_system_disk_size) || 0) / GiB)
      );
      const createdInstance = await provider.createInstance(source, source.secret, {
        imageUuid: image.image_uuid,
        instanceName: INSTANCE_NAME,
        gpuSpecUuid: 'pro6000-p',
        reqGpuAmount: 1,
        expandSystemDiskByGb,
        cudaVersionFrom: 128,
        startCommand: `bash ${source.sshStartScript || '/root/autodl-tmp/vela-h3/deploy/start-comfy.sh'}`
      });
      const instanceUuid = typeof createdInstance === 'string'
        ? createdInstance
        : String(createdInstance?.instance_uuid || createdInstance?.uuid || '');
      if (!/^pro-[a-z0-9]+$/i.test(instanceUuid)) {
        throw new Error('AutoDL 创建成功但未返回可识别的第二实例 UUID');
      }
      targetInstance = { uuid: instanceUuid, name: INSTANCE_NAME, status: 'creating', gpu_spec_uuid: 'pro6000-p' };
    }

    const targetSnapshot = await waitForSnapshot(source, targetInstance.uuid);
    const secondaryProfile = registerSecondaryProfile(source, targetInstance.uuid, targetSnapshot);
    const targetProfile = { ...source, autodlInstanceUuid: targetInstance.uuid };
    const targetStatus = await provider.getStatus(targetProfile, source.secret);
    if (!['shutdown', 'stopped'].includes(String(targetStatus).toLowerCase())) {
      await provider.powerOff(targetProfile, source.secret);
      await provider.waitForState(targetProfile, source.secret, ['shutdown', 'stopped'], { timeoutMs: 15 * 60_000 });
    }

    console.log(JSON.stringify({
      createdOrReused: true,
      imageUuid: image.image_uuid,
      targetInstanceUuid: targetInstance.uuid,
      targetStatus: 'shutdown',
      secondaryProfile: {
        id: secondaryProfile.id,
        name: secondaryProfile.name,
        sshHost: secondaryProfile.sshHost,
        sshPort: secondaryProfile.sshPort,
        sshLocalPort: secondaryProfile.sshLocalPort,
        autoPowerEnabled: secondaryProfile.autoPowerEnabled,
        idleShutdownMinutes: secondaryProfile.idleShutdownMinutes,
        maxConcurrency: secondaryProfile.maxConcurrency,
        credentialStatus: secondaryProfile.autoPowerCredentialStatus
      }
    }));
  }
} finally {
  database.close();
}
