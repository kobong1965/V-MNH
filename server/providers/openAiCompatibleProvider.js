import { redactString } from '../vela/redaction.js';

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const IMAGE_REQUEST_TIMEOUT_MS = 300_000;

export class ProviderError extends Error {
  constructor(message, { code = 'PROVIDER_ERROR', status, retryable = false, safeToRetry = false } = {}) {
    super(redactString(message));
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.safeToRetry = safeToRetry;
  }
}

const providerMessage = (body, statusText) => {
  const value = body?.error?.message || body?.message || body?.error || statusText || 'Provider request failed';
  return redactString(typeof value === 'string' ? value : JSON.stringify(value));
};

const classifyStatus = (status, body, statusText, safeToRetry) => {
  const message = providerMessage(body, statusText);
  if (status === 401 || status === 403) return new ProviderError(message, { code: 'AUTH_FAILED', status });
  if (status === 404 || /model.+(not found|does not exist|不存在)/i.test(message)) {
    return new ProviderError(message, { code: 'MODEL_NOT_FOUND', status });
  }
  if (status === 429) return new ProviderError(message, { code: 'RATE_LIMITED', status, retryable: true, safeToRetry });
  if (TRANSIENT_STATUSES.has(status)) {
    return new ProviderError(message, { code: 'PROVIDER_UNAVAILABLE', status, retryable: true, safeToRetry });
  }
  return new ProviderError(message, { code: 'PROVIDER_REJECTED', status });
};

const parseJson = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { throw new ProviderError('供应商返回的不是有效 JSON', { code: 'BAD_RESPONSE', status: response.status }); }
};

const extractText = (body) => {
  const chatContent = body?.choices?.[0]?.message?.content;
  if (typeof chatContent === 'string') return chatContent.trim();
  if (Array.isArray(chatContent)) {
    const text = chatContent.map((part) => part?.text || '').join('').trim();
    if (text) return text;
  }
  if (typeof body?.output_text === 'string') return body.output_text.trim();
  const responseText = body?.output?.flatMap?.((item) => item?.content || [])
    ?.map?.((part) => part?.text || '')?.join?.('')?.trim?.();
  if (responseText) return responseText;
  throw new ProviderError('供应商响应中没有文本结果', { code: 'BAD_RESPONSE' });
};

const toImageContent = (text, imageDataUrl) => imageDataUrl ? [{
  type: 'text', text
}, {
  type: 'image_url', image_url: { url: imageDataUrl }
}] : text;

export class OpenAiCompatibleProvider {
  constructor({ fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');
    this.fetch = fetchImpl;
    this.sleep = sleep;
  }

  async request(profile, apiKey, route, {
    method = 'GET',
    body,
    headers = {},
    safeToRetry = method === 'GET',
    timeoutMs
  } = {}) {
    const attempts = safeToRetry ? 3 : 1;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const requestTimeoutMs = Math.max(1, Number(timeoutMs) || profile.timeoutMs || 60_000);
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await this.fetch(`${profile.baseUrl}${route}`, {
          method,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
            ...headers
          },
          body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal
        });
        const data = await parseJson(response);
        if (response.ok) return data;
        throw classifyStatus(response.status, data, response.statusText, safeToRetry);
      } catch (error) {
        if (error?.name === 'AbortError') {
          lastError = new ProviderError('连接供应商超时', { code: 'TIMEOUT', retryable: true, safeToRetry });
        } else if (error instanceof ProviderError) {
          lastError = error;
        } else {
          lastError = new ProviderError(`无法连接供应商：${error?.message || '网络错误'}`, {
            code: /Invalid URL/i.test(error?.message || '') ? 'BAD_URL' : 'NETWORK_ERROR',
            retryable: true,
            safeToRetry
          });
        }
      } finally {
        clearTimeout(timer);
      }
      if (!lastError.retryable || !lastError.safeToRetry || attempt === attempts - 1) throw lastError;
      await this.sleep(250 * (2 ** attempt));
    }
    throw lastError;
  }

  async listModels(profile, apiKey) {
    const body = await this.request(profile, apiKey, '/models');
    if (!Array.isArray(body.data)) throw new ProviderError('模型列表格式不兼容', { code: 'BAD_RESPONSE' });
    return body.data.map((model) => model?.id).filter((id) => typeof id === 'string').sort();
  }

  async testConnection(profile, apiKey) {
    const models = await this.listModels(profile, apiKey);
    const configured = [profile.models?.prompt, profile.models?.image].filter(Boolean);
    const missingModels = configured.filter((model) => !models.includes(model));
    if (missingModels.length) {
      throw new ProviderError(`模型不存在：${missingModels.join('、')}`, { code: 'MODEL_NOT_FOUND', status: 404 });
    }
    return { ok: true, baseUrl: profile.baseUrl, models, checkedAt: new Date().toISOString() };
  }

  async optimizePrompt(profile, apiKey, { prompt, imageDataUrl } = {}) {
    if (!prompt?.trim()) throw new ProviderError('提示词不能为空', { code: 'INVALID_INPUT' });
    if (!profile.models?.prompt) throw new ProviderError('尚未配置提示词模型', { code: 'MODEL_NOT_CONFIGURED' });
    const body = await this.request(profile, apiKey, '/chat/completions', {
      method: 'POST',
      safeToRetry: false,
      body: {
        model: profile.models.prompt,
        messages: [
          { role: 'system', content: '你是视频与商品图提示词编辑器。保留用户原意，补充主体、环境、镜头、光线、动作和限制条件；只输出可直接使用的优化提示词。' },
          { role: 'user', content: toImageContent(prompt.trim(), imageDataUrl) }
        ]
      }
    });
    return {
      text: extractText(body),
      source: { provider: 'openai-compatible', profileId: profile.id, model: profile.models.prompt }
    };
  }

  async generateImages(profile, apiKey, { prompt, count = 1, size, quality } = {}) {
    if (!prompt?.trim()) throw new ProviderError('提示词不能为空', { code: 'INVALID_INPUT' });
    if (!profile.models?.image) throw new ProviderError('尚未配置图片模型', { code: 'MODEL_NOT_CONFIGURED' });
    const body = await this.request(profile, apiKey, '/images/generations', {
      method: 'POST',
      safeToRetry: false,
      timeoutMs: Math.max(IMAGE_REQUEST_TIMEOUT_MS, Number(profile.timeoutMs) || 0),
      body: {
        model: profile.models.image,
        prompt: prompt.trim(),
        n: Math.min(10, Math.max(1, Number(count) || 1)),
        ...(size ? { size } : {}),
        ...(quality ? { quality } : {})
      }
    });
    if (!Array.isArray(body.data) || body.data.length === 0) {
      throw new ProviderError('供应商响应中没有图片结果', { code: 'BAD_RESPONSE' });
    }
    return body.data.map((item) => {
      if (typeof item?.b64_json === 'string') return { kind: 'base64', value: item.b64_json, revisedPrompt: item.revised_prompt };
      if (typeof item?.url === 'string') return { kind: 'url', value: item.url, revisedPrompt: item.revised_prompt };
      throw new ProviderError('图片结果格式不兼容', { code: 'BAD_RESPONSE' });
    });
  }

  async editImages(profile, apiKey, { prompt, referenceImages, count = 1, size, quality } = {}) {
    if (!prompt?.trim()) throw new ProviderError('提示词不能为空', { code: 'INVALID_INPUT' });
    if (!profile.models?.image) throw new ProviderError('尚未配置图片模型', { code: 'MODEL_NOT_CONFIGURED' });
    if (!Array.isArray(referenceImages) || referenceImages.length === 0) {
      throw new ProviderError('至少需要一张参考图', { code: 'INVALID_INPUT' });
    }
    const form = new FormData();
    form.set('model', profile.models.image);
    form.set('prompt', prompt.trim());
    form.set('n', String(Math.min(10, Math.max(1, Number(count) || 1))));
    if (size) form.set('size', size);
    if (quality) form.set('quality', quality);
    for (const [index, image] of referenceImages.entries()) {
      form.append('image', new Blob([image.data], { type: image.mime || 'image/png' }), image.filename || `reference-${index + 1}.png`);
    }
    const body = await this.request(profile, apiKey, '/images/edits', {
      method: 'POST',
      safeToRetry: false,
      timeoutMs: Math.max(IMAGE_REQUEST_TIMEOUT_MS, Number(profile.timeoutMs) || 0),
      body: form
    });
    if (!Array.isArray(body.data) || body.data.length === 0) {
      throw new ProviderError('供应商响应中没有图片结果', { code: 'BAD_RESPONSE' });
    }
    return body.data.map((item) => {
      if (typeof item?.b64_json === 'string') return { kind: 'base64', value: item.b64_json, revisedPrompt: item.revised_prompt };
      if (typeof item?.url === 'string') return { kind: 'url', value: item.url, revisedPrompt: item.revised_prompt };
      throw new ProviderError('图片结果格式不兼容', { code: 'BAD_RESPONSE' });
    });
  }
}
