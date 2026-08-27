import https from 'node:https';

import { redactString } from '../vela/redaction.js';

const API_ORIGIN = 'https://api.autodl.com';
const DEFAULT_TIMEOUT_MS = 30_000;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const requestJson = (url, { method, headers, body, timeoutMs }) => new Promise((resolve, reject) => {
  const hasBody = method !== 'GET' && body !== undefined;
  const encodedBody = hasBody ? Buffer.from(JSON.stringify(body)) : null;
  const request = https.request(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(hasBody ? {
        'Content-Type': 'application/json',
        'Content-Length': String(encodedBody.length)
      } : {}),
      ...headers
    }
  }, (response) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    response.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let parsed = {};
      try { parsed = text ? JSON.parse(text) : {}; }
      catch {
        reject(new AutoDlPowerError('AutoDL 返回了无法识别的数据', {
          code: 'BAD_RESPONSE', status: response.statusCode
        }));
        return;
      }
      resolve({ status: response.statusCode || 0, body: parsed });
    });
  });
  request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error('AutoDL request timeout'), { code: 'ETIMEDOUT' })));
  request.once('error', reject);
  request.end(encodedBody || undefined);
});

export class AutoDlPowerError extends Error {
  constructor(message, { code = 'AUTODL_POWER_FAILED', status, retryable = false, details } = {}) {
    super(redactString(message));
    this.name = 'AutoDlPowerError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.safeToRetry = true;
    this.details = details;
  }
}

const requireInstanceUuid = (profile) => {
  const value = String(profile?.autodlInstanceUuid || '').trim();
  if (!/^pro-[a-z0-9]+$/i.test(value)) {
    throw new AutoDlPowerError('AutoDL 容器实例 Pro UUID 无效，应以 pro- 开头', {
      code: 'AUTODL_INSTANCE_INVALID'
    });
  }
  return value;
};

const requireDeveloperToken = (secret) => {
  const value = String(secret?.autodlDeveloperToken || '').trim();
  if (!value) {
    throw new AutoDlPowerError('尚未配置 AutoDL Developer Token', {
      code: 'AUTODL_TOKEN_MISSING'
    });
  }
  return value;
};

const requireImageUuid = (value) => {
  const normalized = String(value || '').trim();
  if (!/^(?:base-)?image-[a-z0-9-]+$/i.test(normalized)) {
    throw new AutoDlPowerError('AutoDL 镜像 UUID 无效，应以 image- 或 base-image- 开头', {
      code: 'AUTODL_IMAGE_INVALID'
    });
  }
  return normalized;
};

const normalizePage = ({ pageIndex = 1, pageSize = 12 } = {}) => ({
  page_index: Math.max(1, Math.floor(Number(pageIndex) || 1)),
  page_size: Math.max(1, Math.min(50, Math.floor(Number(pageSize) || 12)))
});

const classifyApiFailure = (status, body) => {
  const message = String(body?.msg || body?.message || `AutoDL HTTP ${status || '错误'}`);
  if ([401, 403].includes(status) || /token|auth|鉴权|登录/i.test(message)) {
    return new AutoDlPowerError('AutoDL Developer Token 无效或没有容器实例 Pro 权限', {
      code: 'AUTODL_AUTH_FAILED', status
    });
  }
  if (status === 429 || /频繁|限流|稍后/i.test(message)) {
    return new AutoDlPowerError('AutoDL 控制接口请求过于频繁，请稍后重试', {
      code: 'AUTODL_RATE_LIMITED', status, retryable: true
    });
  }
  if (status >= 500) {
    return new AutoDlPowerError('AutoDL 控制服务暂时不可用', {
      code: 'AUTODL_UNAVAILABLE', status, retryable: true
    });
  }
  return new AutoDlPowerError(message || 'AutoDL 控制请求失败', {
    code: 'AUTODL_REJECTED', status,
    retryable: /库存|空闲|调度|稍后/i.test(message)
  });
};

export class AutoDlPowerProvider {
  constructor({
    requestImpl = requestJson,
    sleep = delay,
    pollIntervalMs = 5_000,
    requestIntervalMs = requestImpl === requestJson ? 1_100 : 0,
    rateLimitRetries = 4
  } = {}) {
    this.request = requestImpl;
    this.sleep = sleep;
    this.pollIntervalMs = Math.max(250, Number(pollIntervalMs) || 5_000);
    this.requestIntervalMs = Math.max(0, Number(requestIntervalMs) || 0);
    this.rateLimitRetries = Math.max(0, Math.min(8, Math.floor(Number(rateLimitRetries) || 0)));
    this.requestGate = Promise.resolve();
    this.lastRequestAt = 0;
  }

  enqueueRequest(operation) {
    const queued = this.requestGate.then(async () => {
      const remaining = this.requestIntervalMs - (Date.now() - this.lastRequestAt);
      if (remaining > 0) await this.sleep(remaining);
      try {
        return await operation();
      } finally {
        this.lastRequestAt = Date.now();
      }
    });
    this.requestGate = queued.catch(() => {});
    return queued;
  }

  async call(profile, secret, route, method, payload) {
    const token = requireDeveloperToken(secret);
    for (let attempt = 0; attempt <= this.rateLimitRetries; attempt += 1) {
      try {
        const response = await this.enqueueRequest(() => this.request(`${API_ORIGIN}${route}`, {
          method,
          body: payload,
          timeoutMs: Math.max(1_000, Number(profile?.timeoutMs) || DEFAULT_TIMEOUT_MS),
          headers: { Authorization: token }
        }));
        if (response.status < 200 || response.status >= 300 || response.body?.code !== 'Success') {
          throw classifyApiFailure(response.status, response.body);
        }
        return response.body?.data;
      } catch (error) {
        const normalized = error instanceof AutoDlPowerError
          ? error
          : (() => {
              const networkCode = String(error?.code || error?.cause?.code || '');
              if (networkCode === 'ETIMEDOUT') {
                return new AutoDlPowerError('连接 AutoDL 控制接口超时', {
                  code: 'AUTODL_TIMEOUT', retryable: true
                });
              }
              return new AutoDlPowerError(`无法连接 AutoDL 控制接口：${error?.message || '网络错误'}`, {
                code: 'AUTODL_NETWORK_ERROR', retryable: true,
                details: networkCode ? { networkCode } : undefined
              });
            })();
        if (normalized.code !== 'AUTODL_RATE_LIMITED' || attempt >= this.rateLimitRetries) throw normalized;
        await this.sleep(750 * (2 ** attempt));
      }
    }
    throw new AutoDlPowerError('AutoDL 控制接口请求过于频繁，请稍后重试', {
      code: 'AUTODL_RATE_LIMITED', retryable: true
    });
  }

  async getStatus(profile, secret) {
    const instanceUuid = requireInstanceUuid(profile);
    const query = new URLSearchParams({ instance_uuid: instanceUuid });
    return this.call(profile, secret, `/api/v1/dev/instance/pro/status?${query}`, 'GET');
  }

  async getSnapshot(profile, secret) {
    const instanceUuid = requireInstanceUuid(profile);
    const query = new URLSearchParams({ instance_uuid: instanceUuid });
    return this.call(profile, secret, `/api/v1/dev/instance/pro/snapshot?${query}`, 'GET');
  }

  async getWalletBalance(profile, secret) {
    return this.call(profile, secret, '/api/v1/dev/wallet/balance', 'POST');
  }

  async listPrivateImages(profile, secret, { pageIndex = 1, pageSize = 12 } = {}) {
    return this.call(
      profile,
      secret,
      '/api/v1/dev/instance/pro/image/private/list',
      'POST',
      normalizePage({ pageIndex, pageSize })
    );
  }

  async listInstances(profile, secret, { pageIndex = 1, pageSize = 50 } = {}) {
    return this.call(
      profile,
      secret,
      '/api/v1/dev/instance/pro/list',
      'POST',
      normalizePage({ pageIndex, pageSize })
    );
  }

  async savePrivateImage(profile, secret, { imageName }) {
    const instanceUuid = requireInstanceUuid(profile);
    const normalizedName = String(imageName || '').trim();
    if (!normalizedName || normalizedName.length > 80) {
      throw new AutoDlPowerError('AutoDL 镜像名称必须是 1-80 个字符', {
        code: 'AUTODL_IMAGE_NAME_INVALID'
      });
    }
    return this.call(profile, secret, '/api/v1/dev/instance/pro/image/save', 'POST', {
      instance_uuid: instanceUuid,
      image_name: normalizedName
    });
  }

  async createInstance(profile, secret, {
    imageUuid,
    instanceName,
    gpuSpecUuid = 'pro6000-p',
    reqGpuAmount = 1,
    expandSystemDiskByGb = 0,
    cudaVersionFrom = 128,
    dataCenterList,
    startCommand
  } = {}) {
    const normalizedImageUuid = requireImageUuid(imageUuid);
    const normalizedGpuSpec = String(gpuSpecUuid || '').trim();
    if (!/^[a-z0-9-]+$/i.test(normalizedGpuSpec)) {
      throw new AutoDlPowerError('AutoDL GPU 规格无效', { code: 'AUTODL_GPU_SPEC_INVALID' });
    }
    const normalizedName = String(instanceName || '').trim();
    if (normalizedName.length > 80) {
      throw new AutoDlPowerError('AutoDL 实例名称不能超过 80 个字符', {
        code: 'AUTODL_INSTANCE_NAME_INVALID'
      });
    }
    const normalizedDataCenters = Array.isArray(dataCenterList)
      ? [...new Set(dataCenterList.map((item) => String(item || '').trim()).filter(Boolean))]
      : [];
    const normalizedStartCommand = String(startCommand || '').trim();
    return this.call(profile, secret, '/api/v1/dev/instance/pro/create', 'POST', {
      ...(normalizedDataCenters.length ? { data_center_list: normalizedDataCenters } : {}),
      req_gpu_amount: Math.max(1, Math.min(4, Math.floor(Number(reqGpuAmount) || 1))),
      expand_system_disk_by_gb: Math.max(0, Math.min(500, Math.floor(Number(expandSystemDiskByGb) || 0))),
      gpu_spec_uuid: normalizedGpuSpec,
      image_uuid: normalizedImageUuid,
      cuda_v_from: Math.max(100, Math.floor(Number(cudaVersionFrom) || 128)),
      ...(normalizedName ? { instance_name: normalizedName } : {}),
      ...(normalizedStartCommand ? { start_command: normalizedStartCommand } : {})
    });
  }

  async powerOn(profile, secret) {
    const instanceUuid = requireInstanceUuid(profile);
    const startScript = String(profile?.sshStartScript || '').trim();
    await this.call(profile, secret, '/api/v1/dev/instance/pro/power_on', 'POST', {
      instance_uuid: instanceUuid,
      payload: 'gpu',
      ...(startScript ? { start_command: `bash ${startScript}` } : {})
    });
    return { ok: true, instanceUuid, requestedAt: new Date().toISOString() };
  }

  async powerOff(profile, secret) {
    const instanceUuid = requireInstanceUuid(profile);
    await this.call(profile, secret, '/api/v1/dev/instance/pro/power_off', 'POST', {
      instance_uuid: instanceUuid
    });
    return { ok: true, instanceUuid, requestedAt: new Date().toISOString() };
  }

  async waitForState(profile, secret, acceptedStates, { timeoutMs } = {}) {
    const expected = new Set(acceptedStates);
    const startedAt = Date.now();
    const effectiveTimeout = Math.max(1_000, Number(timeoutMs) || Number(profile?.powerOnTimeoutMs) || 600_000);
    let lastState = 'unknown';
    while (Date.now() - startedAt < effectiveTimeout) {
      lastState = String(await this.getStatus(profile, secret) || 'unknown').toLowerCase();
      if (expected.has(lastState)) return lastState;
      await this.sleep(this.pollIntervalMs);
    }
    throw new AutoDlPowerError(`等待 AutoDL 实例状态超时，当前状态：${lastState}`, {
      code: 'AUTODL_STATE_TIMEOUT', retryable: true,
      details: { lastState }
    });
  }
}
