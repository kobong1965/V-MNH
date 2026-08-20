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
  constructor({ requestImpl = requestJson, sleep = delay, pollIntervalMs = 5_000 } = {}) {
    this.request = requestImpl;
    this.sleep = sleep;
    this.pollIntervalMs = Math.max(250, Number(pollIntervalMs) || 5_000);
  }

  async call(profile, secret, route, method, payload) {
    const token = requireDeveloperToken(secret);
    try {
      const response = await this.request(`${API_ORIGIN}${route}`, {
        method,
        body: payload,
        timeoutMs: Math.max(1_000, Number(profile?.timeoutMs) || DEFAULT_TIMEOUT_MS),
        headers: { Authorization: token }
      });
      if (response.status < 200 || response.status >= 300 || response.body?.code !== 'Success') {
        throw classifyApiFailure(response.status, response.body);
      }
      return response.body?.data;
    } catch (error) {
      if (error instanceof AutoDlPowerError) throw error;
      const networkCode = String(error?.code || error?.cause?.code || '');
      if (networkCode === 'ETIMEDOUT') {
        throw new AutoDlPowerError('连接 AutoDL 控制接口超时', {
          code: 'AUTODL_TIMEOUT', retryable: true
        });
      }
      throw new AutoDlPowerError(`无法连接 AutoDL 控制接口：${error?.message || '网络错误'}`, {
        code: 'AUTODL_NETWORK_ERROR', retryable: true,
        details: networkCode ? { networkCode } : undefined
      });
    }
  }

  async getStatus(profile, secret) {
    const instanceUuid = requireInstanceUuid(profile);
    const query = new URLSearchParams({ instance_uuid: instanceUuid });
    return this.call(profile, secret, `/api/v1/dev/instance/pro/status?${query}`, 'GET');
  }

  async getWalletBalance(profile, secret) {
    return this.call(profile, secret, '/api/v1/dev/wallet/balance', 'POST');
  }

  async listPrivateImages(profile, secret, { pageIndex = 1, pageSize = 12 } = {}) {
    const safePageIndex = Math.max(1, Math.floor(Number(pageIndex) || 1));
    const safePageSize = Math.max(1, Math.min(50, Math.floor(Number(pageSize) || 12)));
    return this.call(profile, secret, '/api/v1/dev/instance/pro/image/private/list', 'POST', {
      page_index: safePageIndex,
      page_size: safePageSize
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
