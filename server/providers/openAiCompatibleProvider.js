import { redactSecrets, redactString } from '../vela/redaction.js';

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const IMAGE_REQUEST_TIMEOUT_MS = 300_000;
const VIDEO_REQUEST_TIMEOUT_MS = 300_000;
const VIDEO_TASK_TIMEOUT_MS = 1_800_000;
const VIDEO_POLL_INTERVAL_MS = 5_000;
const SAFE_CONNECT_RETRY_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT'
]);

const FLAGSHIP_GPT_MODEL = /^gpt-(\d+)(?:\.(\d+))?(?:-(sol))?$/i;

export const selectLatestFlagshipGptModel = (models = []) => {
  const candidates = [...new Set((Array.isArray(models) ? models : [])
    .filter((model) => typeof model === 'string')
    .map((model) => {
      const match = FLAGSHIP_GPT_MODEL.exec(model.trim());
      if (!match) return null;
      return {
        model: model.trim(),
        major: Number(match[1]),
        minor: Number(match[2] || 0),
        // Prefer a family alias over its explicit Sol target when both exist so
        // provider-side rolling upgrades inside the family remain effective.
        aliasPriority: match[3] ? 0 : 1
      };
    })
    .filter(Boolean))];
  candidates.sort((left, right) => (
    right.major - left.major
    || right.minor - left.minor
    || right.aliasPriority - left.aliasPriority
    || left.model.localeCompare(right.model)
  ));
  return candidates[0]?.model || null;
};

const getNetworkCause = (error) => {
  let current = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current.code === 'string') {
      return { code: current.code, message: redactString(current.message || current.code) };
    }
    current = current.cause;
  }
  return { code: undefined, message: redactString(error?.message || '网络错误') };
};

export class ProviderError extends Error {
  constructor(message, { code = 'PROVIDER_ERROR', status, retryable = false, safeToRetry = false, details } = {}) {
    super(redactString(message));
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.safeToRetry = safeToRetry;
    this.details = details ? redactSecrets(details) : undefined;
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

const toMultiImageContent = (text, imageDataUrls = []) => {
  const images = Array.isArray(imageDataUrls) ? imageDataUrls.filter(Boolean) : [];
  if (images.length === 0) return text;
  return [
    { type: 'text', text },
    ...images.map((url) => ({ type: 'image_url', image_url: { url } }))
  ];
};

const taskBody = (body) => body?.data && !Array.isArray(body.data) ? body.data : body;
const taskIdFromBody = (body) => {
  const task = taskBody(body);
  const value = task?.id || task?.task_id || body?.id || body?.task_id;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};
const videoStatusRoute = (profile, taskId) => {
  const route = profile.endpoints?.videoStatus || '/videos/{id}';
  const encoded = encodeURIComponent(taskId);
  return route.includes('{id}') ? route.replaceAll('{id}', encoded) : `${route.replace(/\/$/, '')}/${encoded}`;
};
const normalizeVideoProgress = (value, status) => {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
  if (status === 'completed' || status === 'succeeded' || status === 'success') return 1;
  if (status === 'processing' || status === 'running' || status === 'in_progress') return 0.2;
  return 0.05;
};
const videoResultUrl = (task) => {
  const candidates = [
    task?.metadata?.url,
    task?.output?.url,
    task?.result?.url,
    task?.video_url,
    task?.url,
    task?.data?.[0]?.url
  ];
  return candidates.find((value) => typeof value === 'string' && /^https?:\/\//i.test(value)) || null;
};
const videoFailureMessage = (task) => {
  const value = task?.error?.message || task?.error || task?.message || '视频中转站返回任务失败';
  return typeof value === 'string' ? value : JSON.stringify(value);
};

export class OpenAiCompatibleProvider {
  constructor({
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    videoPollIntervalMs = VIDEO_POLL_INTERVAL_MS,
    videoTaskTimeoutMs = VIDEO_TASK_TIMEOUT_MS
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');
    this.fetch = fetchImpl;
    this.sleep = sleep;
    this.videoPollIntervalMs = Math.max(0, Number(videoPollIntervalMs) || 0);
    this.videoTaskTimeoutMs = Math.max(1, Number(videoTaskTimeoutMs) || VIDEO_TASK_TIMEOUT_MS);
  }

  async request(profile, apiKey, route, {
    method = 'GET',
    body,
    headers = {},
    safeToRetry = method === 'GET',
    timeoutMs
  } = {}) {
    const attempts = 3;
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
          const cause = getNetworkCause(error);
          const badUrl = /Invalid URL/i.test(error?.message || '');
          const definitelyNotSubmitted = SAFE_CONNECT_RETRY_CODES.has(cause.code);
          lastError = new ProviderError(`无法连接供应商：${error?.message || '网络错误'}`, {
            code: badUrl ? 'BAD_URL' : 'NETWORK_ERROR',
            retryable: !badUrl,
            safeToRetry: !badUrl && (safeToRetry || definitelyNotSubmitted),
            details: {
              networkCode: cause.code,
              networkMessage: cause.message
            }
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
    const body = await this.request(profile, apiKey, profile.endpoints?.models || '/models');
    if (!Array.isArray(body.data)) throw new ProviderError('模型列表格式不兼容', { code: 'BAD_RESPONSE' });
    return body.data.map((model) => model?.id).filter((id) => typeof id === 'string').sort();
  }

  async testConnection(profile, apiKey) {
    const models = await this.listModels(profile, apiKey);
    const configured = [profile.models?.prompt, profile.models?.image, profile.models?.video, profile.models?.analysis].filter(Boolean);
    const missingModels = configured.filter((model) => !models.includes(model));
    if (missingModels.length) {
      throw new ProviderError(`模型不存在：${missingModels.join('、')}`, {
        code: 'MODEL_NOT_FOUND',
        status: 404,
        details: { missingModels, availableModels: models }
      });
    }
    return { ok: true, baseUrl: profile.baseUrl, models, checkedAt: new Date().toISOString() };
  }

  async optimizePrompt(profile, apiKey, { prompt, imageDataUrl } = {}) {
    if (!prompt?.trim()) throw new ProviderError('提示词不能为空', { code: 'INVALID_INPUT' });
    if (!profile.models?.prompt) throw new ProviderError('尚未配置提示词模型', { code: 'MODEL_NOT_CONFIGURED' });
    const body = await this.request(profile, apiKey, profile.endpoints?.chat || '/chat/completions', {
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

  async generateDirectorScript(profile, apiKey, {
    brief,
    persona,
    productImageDataUrls = [],
    model = profile.models?.prompt
  } = {}) {
    if (!model) throw new ProviderError('尚未找到可用的 GPT 编导模型', { code: 'MODEL_NOT_CONFIGURED' });
    if (!Array.isArray(productImageDataUrls) || productImageDataUrls.length === 0) {
      throw new ProviderError('视频编导至少需要一张产品图片', { code: 'INVALID_INPUT' });
    }
    const identity = {
      name: String(persona?.name || '视频编导'),
      market: String(persona?.market || '目标市场待补充'),
      category: String(persona?.category || '通用电商产品'),
      style: String(persona?.style || '真实、自然、可信'),
      language: String(persona?.language || '简体中文')
    };
    const userText = [
      `编导身份：${identity.name}`,
      `目标市场：${identity.market}`,
      `擅长品类：${identity.category}`,
      `表达风格：${identity.style}`,
      `输出语言：${identity.language}`,
      `产品补充要求：${String(brief || '请从产品图识别可见卖点，并避免臆造无法确认的参数。')}`,
      '请根据后附产品图完成任务。'
    ].join('\n');
    const body = await this.request(profile, apiKey, profile.endpoints?.chat || '/chat/completions', {
      method: 'POST',
      safeToRetry: false,
      body: {
        model,
        messages: [
          {
            role: 'system',
            content: [
              '你是一名资深短视频带货编导。根据产品图片、目标市场和人设，创作可拍摄、可执行、真实自然的 10–15 秒短视频方案。',
              '不要杜撰产品参数、认证、价格或功效；不确定的信息要写成待确认项。',
              '输出必须依次包含：创意方向、分秒脚本、镜头表、口播或字幕、声音与光影、最终视频模型提示词、负面限制。',
              '最终视频提示词要明确主体、动作、机位、构图、环境、光线、节奏和连续性，可直接交给视频生成模型。'
            ].join('\n')
          },
          { role: 'user', content: toMultiImageContent(userText, productImageDataUrls) }
        ]
      }
    });
    return {
      text: extractText(body),
      source: { provider: 'openai-compatible', profileId: profile.id, model, modelSelection: 'latest-flagship-gpt' }
    };
  }

  async analyzeCompetitorScript(profile, apiKey, {
    brief,
    competitorFrameDataUrls = [],
    productImageDataUrls = []
  } = {}) {
    if (!profile.models?.analysis) throw new ProviderError('尚未配置 Qwen 分析模型', { code: 'MODEL_NOT_CONFIGURED' });
    if (!Array.isArray(competitorFrameDataUrls) || competitorFrameDataUrls.length === 0) {
      throw new ProviderError('竞品视频分析至少需要一帧对标视频画面', { code: 'INVALID_INPUT' });
    }
    if (!Array.isArray(productImageDataUrls) || productImageDataUrls.length === 0) {
      throw new ProviderError('竞品视频分析至少需要一张当前产品图片', { code: 'INVALID_INPUT' });
    }
    const labeledImages = [
      ...competitorFrameDataUrls.map((url, index) => ({ label: `对标视频帧 ${index + 1}/${competitorFrameDataUrls.length}`, url })),
      ...productImageDataUrls.map((url, index) => ({ label: `当前产品图 ${index + 1}/${productImageDataUrls.length}`, url }))
    ];
    const content = [
      {
        type: 'text',
        text: [
          `用户补充要求：${String(brief || '无')}`,
          `前 ${competitorFrameDataUrls.length} 张图是按时间顺序抽取的对标视频帧，后 ${productImageDataUrls.length} 张图是当前产品图。`,
          '请严格按照图片顺序分析，不要把对标商品误认为当前产品。'
        ].join('\n')
      },
      ...labeledImages.flatMap(({ label, url }) => [
        { type: 'text', text: label },
        { type: 'image_url', image_url: { url } }
      ])
    ];
    const body = await this.request(profile, apiKey, profile.endpoints?.chat || '/chat/completions', {
      method: 'POST',
      safeToRetry: false,
      timeoutMs: Math.max(180_000, Number(profile.timeoutMs) || 0),
      body: {
        model: profile.models.analysis,
        messages: [
          {
            role: 'system',
            content: [
              '你是电商短视频竞品研究员和视频编导。你会收到按时间排序的对标视频抽帧，以及用户自己的产品图。',
              '只学习对标视频的开场钩子、镜头顺序、构图、节奏、卖点表达、光影和转场方法；不得复制竞品人物、品牌、商标、水印、原句或独特画面。',
              '为当前产品重新创作 10–15 秒方案。人物动作自然，镜头可执行，卖点必须来自产品图或用户说明；不确定的参数标为待确认。',
              '输出必须依次包含：对标结构拆解、可借鉴方法、原创创意、分秒脚本、镜头表、口播或字幕、声音与光影、最终视频模型提示词、负面限制。'
            ].join('\n')
          },
          { role: 'user', content }
        ]
      }
    });
    return {
      text: extractText(body),
      source: { provider: 'openai-compatible', profileId: profile.id, model: profile.models.analysis }
    };
  }

  async generateImages(profile, apiKey, { prompt, count = 1, size, quality, idempotencyKey } = {}) {
    if (!prompt?.trim()) throw new ProviderError('提示词不能为空', { code: 'INVALID_INPUT' });
    if (!profile.models?.image) throw new ProviderError('尚未配置图片模型', { code: 'MODEL_NOT_CONFIGURED' });
    const body = await this.request(profile, apiKey, profile.endpoints?.imageGeneration || '/images/generations', {
      method: 'POST',
      safeToRetry: false,
      timeoutMs: Math.max(IMAGE_REQUEST_TIMEOUT_MS, Number(profile.timeoutMs) || 0),
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
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

  async editImages(profile, apiKey, { prompt, referenceImages, mask, count = 1, size, quality, idempotencyKey } = {}) {
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
    if (mask?.data) {
      form.append('mask', new Blob([mask.data], { type: mask.mime || 'image/png' }), mask.filename || 'mask.png');
    }
    const body = await this.request(profile, apiKey, profile.endpoints?.imageEdit || '/images/edits', {
      method: 'POST',
      safeToRetry: false,
      timeoutMs: Math.max(IMAGE_REQUEST_TIMEOUT_MS, Number(profile.timeoutMs) || 0),
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
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

  async createVideoTask(profile, apiKey, {
    prompt,
    seconds = 5,
    ratio = '16:9',
    resolution = '720p',
    imageUrls = [],
    idempotencyKey
  } = {}) {
    if (!prompt?.trim()) throw new ProviderError('视频提示词不能为空', { code: 'INVALID_INPUT' });
    if (!profile.models?.video) throw new ProviderError('尚未配置视频模型', { code: 'MODEL_NOT_CONFIGURED' });
    const duration = Number(seconds);
    if (!Number.isInteger(duration) || duration < 4 || duration > 180) {
      throw new ProviderError('Seedance 2.5 视频时长必须是 4 到 180 秒的整数', { code: 'INVALID_INPUT' });
    }
    if (!['16:9', '9:16', '1:1'].includes(ratio)) {
      throw new ProviderError('视频比例仅支持 16:9、9:16 或 1:1', { code: 'INVALID_INPUT' });
    }
    const requestedResolution = String(resolution).toLowerCase();
    if (!['480p', '720p'].includes(requestedResolution)) {
      throw new ProviderError('Seedance 2.5 输出分辨率仅支持 480p 或 720p', { code: 'INVALID_INPUT' });
    }
    const configuredResolution = /(?:^|[-_])(480p|720p)(?:$|[-_])/i.exec(profile.models.video)?.[1]?.toLowerCase();
    const outputResolution = configuredResolution || requestedResolution;
    const references = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [];
    if (references.length > 30) throw new ProviderError('参考图片不能超过 30 张', { code: 'INVALID_INPUT' });
    if (references.some((url) => !/^(https?:\/\/|data:image\/)/i.test(String(url)))) {
      throw new ProviderError('参考图片必须是公网 URL 或可兼容的内联图片', { code: 'INVALID_INPUT' });
    }
    const body = await this.request(profile, apiKey, profile.endpoints?.videoGeneration || '/videos', {
      method: 'POST',
      safeToRetry: false,
      timeoutMs: Math.max(VIDEO_REQUEST_TIMEOUT_MS, Number(profile.timeoutMs) || 0),
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
      body: {
        model: profile.models.video,
        prompt: prompt.trim(),
        seconds: duration,
        ratio,
        resolution: outputResolution,
        ...(references.length ? { image_urls: references } : {})
      }
    });
    const taskId = taskIdFromBody(body);
    if (!taskId) {
      throw new ProviderError('视频中转站未返回任务 ID，软件不会自动重复提交以避免重复扣费', {
        code: 'BAD_RESPONSE',
        safeToRetry: false
      });
    }
    return { taskId, task: taskBody(body) };
  }

  async pollVideoTask(profile, apiKey, taskId, { onProgress } = {}) {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= this.videoTaskTimeoutMs) {
      const body = await this.request(profile, apiKey, videoStatusRoute(profile, taskId), {
        method: 'GET',
        safeToRetry: true,
        timeoutMs: Math.max(60_000, Number(profile.timeoutMs) || 0)
      });
      const task = taskBody(body);
      const status = String(task?.status || '').trim().toLowerCase();
      const progress = normalizeVideoProgress(task?.progress, status);
      await onProgress?.(progress, task);
      if (['completed', 'succeeded', 'success'].includes(status)) {
        const url = videoResultUrl(task);
        if (!url) throw new ProviderError('视频任务已完成，但中转站响应中没有可下载的视频 URL', { code: 'BAD_RESPONSE' });
        return { kind: 'url', value: url, taskId };
      }
      if (['failed', 'cancelled', 'canceled'].includes(status)) {
        throw new ProviderError(videoFailureMessage(task), { code: 'VIDEO_TASK_FAILED', safeToRetry: false });
      }
      // Boundless can briefly report `unknown` while a newly-created task is
      // propagating to the status service. The task ID is already durable, so
      // keep polling the same task instead of failing and encouraging a paid
      // resubmission.
      if (!['unknown', 'queued', 'pending', 'processing', 'running', 'in_progress'].includes(status)) {
        throw new ProviderError(`视频中转站返回未知任务状态：${status || '空状态'}`, { code: 'BAD_RESPONSE' });
      }
      await this.sleep(this.videoPollIntervalMs);
    }
    throw new ProviderError('等待视频生成超过 30 分钟，可稍后通过原任务 ID 继续查询，软件不会重复提交', {
      code: 'VIDEO_POLL_TIMEOUT',
      retryable: true,
      safeToRetry: true,
      details: { taskId }
    });
  }

  async generateVideo(profile, apiKey, input = {}) {
    const created = await this.createVideoTask(profile, apiKey, input);
    await input.onSubmitted?.(created.taskId, created.task);
    return this.pollVideoTask(profile, apiKey, created.taskId, { onProgress: input.onProgress });
  }
}
