const MODEL_FILES = Object.freeze({
  diffusion: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
  clip: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
  videoVae: 'minimax_h3_video_vae_fp16.safetensors',
  audioVae: 'minimax_h3_audio_vae_fp32.safetensors',
  upscaler: 'RealESRGAN_x2plus.pth',
  turbo8: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors',
  turbo4: 'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors'
});

const BASE_DIMENSIONS = Object.freeze({
  '480p': [864, 480],
  '720p': [1152, 640],
  '1080p': [1152, 640],
  '2K': [1344, 768]
});

const TARGET_DIMENSIONS = Object.freeze({
  '1080p': [1920, 1080],
  '2K': [2560, 1440]
});

const orient = ([width, height], ratio) => {
  if (ratio === '9:16') return [height, width];
  if (ratio === '1:1') return [Math.min(width, height), Math.min(width, height)];
  return [width, height];
};

export const minimaxH3FrameCount = (seconds = 5) => {
  const raw = Math.max(5, Math.round(Math.max(1, Number(seconds) || 5) * 24));
  return raw + ((5 - (raw % 17)) + 17) % 17;
};

export const resolveMiniMaxH3Dimensions = ({ resolution = '720p', aspectRatio = '16:9' } = {}) => {
  const normalizedResolution = Object.hasOwn(BASE_DIMENSIONS, resolution) ? resolution : '720p';
  const [width, height] = orient(BASE_DIMENSIONS[normalizedResolution], aspectRatio);
  const target = TARGET_DIMENSIONS[normalizedResolution]
    ? orient(TARGET_DIMENSIONS[normalizedResolution], aspectRatio)
    : null;
  return { width, height, targetWidth: target?.[0], targetHeight: target?.[1] };
};

const node = (class_type, inputs) => ({ class_type, inputs });

export const buildMiniMaxH3Prompt = ({
  prompt,
  seed = 0,
  duration = 5,
  aspectRatio = '16:9',
  resolution = '720p',
  acceleration = 'turbo-8',
  upscale = 'auto',
  firstFrame,
  lastFrame,
  referenceFit = 'cover',
  filenamePrefix = 'vela/minimax-h3'
} = {}) => {
  const graph = {};
  const dimensions = resolveMiniMaxH3Dimensions({ resolution, aspectRatio });
  const accelerationConfig = acceleration === 'standard'
    ? { steps: 20, lora: null }
    : acceleration === 'turbo-4'
      ? { steps: 4, lora: MODEL_FILES.turbo4 }
      : { steps: 8, lora: MODEL_FILES.turbo8 };

  graph['1'] = node('UNETLoader', { unet_name: MODEL_FILES.diffusion, weight_dtype: 'default' });
  let modelLink = ['1', 0];
  if (accelerationConfig.lora) {
    graph['2'] = node('LoraLoaderModelOnly', {
      model: modelLink,
      lora_name: accelerationConfig.lora,
      strength_model: 1
    });
    modelLink = ['2', 0];
  }
  graph['3'] = node('CLIPLoader', { clip_name: MODEL_FILES.clip, type: 'minimax', device: 'default' });
  graph['4'] = node('VAELoader', { vae_name: MODEL_FILES.videoVae });
  graph['5'] = node('VAELoader', { vae_name: MODEL_FILES.audioVae });

  const conditioningInputs = {
    clip: ['3', 0],
    vae: ['4', 0],
    prompt: String(prompt || '').trim() || 'cinematic video',
    width: dimensions.width,
    height: dimensions.height,
    length: minimaxH3FrameCount(duration)
  };
  if (firstFrame) {
    graph['20'] = node('LoadImage', { image: firstFrame });
    if (referenceFit === 'cover') {
      graph['22'] = node('ImageScale', {
        image: ['20', 0],
        upscale_method: 'lanczos',
        width: dimensions.width,
        height: dimensions.height,
        crop: 'center'
      });
      conditioningInputs.first_frame = ['22', 0];
    } else conditioningInputs.first_frame = ['20', 0];
  }
  if (lastFrame) {
    graph['21'] = node('LoadImage', { image: lastFrame });
    if (referenceFit === 'cover') {
      graph['23'] = node('ImageScale', {
        image: ['21', 0],
        upscale_method: 'lanczos',
        width: dimensions.width,
        height: dimensions.height,
        crop: 'center'
      });
      conditioningInputs.last_frame = ['23', 0];
    } else conditioningInputs.last_frame = ['21', 0];
  }
  graph['6'] = node('MiniMaxH3ImageToVideo', conditioningInputs);
  graph['7'] = node('RandomNoise', { noise_seed: Math.max(0, Math.trunc(Number(seed) || 0)) });
  graph['8'] = node('BasicGuider', { model: modelLink, conditioning: ['6', 0] });
  graph['9'] = node('KSamplerSelect', { sampler_name: 'res_multistep' });
  graph['10'] = node('BasicScheduler', {
    model: modelLink,
    scheduler: 'simple',
    steps: accelerationConfig.steps,
    denoise: 1
  });
  graph['11'] = node('SamplerCustomAdvanced', {
    noise: ['7', 0],
    guider: ['8', 0],
    sampler: ['9', 0],
    sigmas: ['10', 0],
    latent_image: ['6', 1]
  });
  graph['12'] = node('VAEDecode', { samples: ['11', 0], vae: ['4', 0] });
  graph['13'] = node('VAEDecodeAudio', { samples: ['11', 0], vae: ['5', 0] });

  let imageLink = ['12', 0];
  if (upscale !== 'off' && dimensions.targetWidth && dimensions.targetHeight) {
    graph['14'] = node('UpscaleModelLoader', { model_name: MODEL_FILES.upscaler });
    graph['17'] = node('ImageUpscaleWithModel', {
      upscale_model: ['14', 0],
      image: imageLink
    });
    graph['18'] = node('ImageScale', {
      image: ['17', 0],
      upscale_method: 'lanczos',
      width: dimensions.targetWidth,
      height: dimensions.targetHeight,
      crop: 'disabled'
    });
    imageLink = ['18', 0];
  }
  graph['15'] = node('CreateVideo', { images: imageLink, fps: 24, audio: ['13', 0], bit_depth: 8 });
  graph['16'] = node('SaveVideo', {
    video: ['15', 0],
    filename_prefix: filenamePrefix,
    format: 'mp4',
    codec: 'auto'
  });
  return graph;
};

export { MODEL_FILES as MINIMAX_H3_MODEL_FILES };
