import sharp from 'sharp';

const OUTPAINT_CANVASES = Object.freeze({
  '16:9': { width: 1536, height: 1024, size: '1536x1024' },
  '9:16': { width: 1024, height: 1536, size: '1024x1536' },
  '1:1': { width: 1024, height: 1024, size: '1024x1024' }
});

const parseAspectRatio = (value) => {
  const [width, height] = String(value || '').split(':').map(Number);
  if (!(width > 0) || !(height > 0)) throw new Error(`Unsupported aspect ratio: ${value}`);
  return width / height;
};

const centeredTargetRect = (canvasWidth, canvasHeight, targetRatio) => {
  const canvasRatio = canvasWidth / canvasHeight;
  if (canvasRatio > targetRatio) {
    const width = Math.max(1, Math.round(canvasHeight * targetRatio));
    return { left: Math.floor((canvasWidth - width) / 2), top: 0, width, height: canvasHeight };
  }
  const height = Math.max(1, Math.round(canvasWidth / targetRatio));
  return { left: 0, top: Math.floor((canvasHeight - height) / 2), width: canvasWidth, height };
};

export const inspectReferenceAspect = async (data, aspectRatio) => {
  const metadata = await sharp(data).rotate().metadata();
  const width = Number(metadata.width) || 0;
  const height = Number(metadata.height) || 0;
  if (!width || !height) throw new Error('Reference image dimensions could not be read');
  const actualRatio = width / height;
  const targetRatio = parseAspectRatio(aspectRatio);
  return {
    width,
    height,
    actualRatio,
    targetRatio,
    matches: Math.abs(actualRatio - targetRatio) / targetRatio <= 0.005
  };
};

export const createH3OutpaintInput = async (data, aspectRatio) => {
  const canvas = OUTPAINT_CANVASES[aspectRatio];
  if (!canvas) throw new Error(`Unsupported H3 aspect ratio: ${aspectRatio}`);

  const source = sharp(data).rotate();
  const metadata = await source.metadata();
  const sourceWidth = Number(metadata.width) || 0;
  const sourceHeight = Number(metadata.height) || 0;
  if (!sourceWidth || !sourceHeight) throw new Error('Reference image dimensions could not be read');

  // GPT Image currently exposes portrait/landscape/square output sizes rather than
  // a literal 9:16 or 16:9 size. Keep the complete source inside the centered
  // target-ratio safe area, then crop only the AI-generated guard area afterward.
  const targetRect = centeredTargetRect(canvas.width, canvas.height, parseAspectRatio(aspectRatio));
  const scale = Math.min(targetRect.width / sourceWidth, targetRect.height / sourceHeight);
  const placedWidth = Math.max(1, Math.round(sourceWidth * scale));
  const placedHeight = Math.max(1, Math.round(sourceHeight * scale));
  const placedLeft = targetRect.left + Math.floor((targetRect.width - placedWidth) / 2);
  const placedTop = targetRect.top + Math.floor((targetRect.height - placedHeight) / 2);
  const resizedSource = await source
    .resize(placedWidth, placedHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();

  const image = await sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  }).composite([{ input: resizedSource, left: placedLeft, top: placedTop }]).png().toBuffer();

  const opaqueRegion = await sharp({
    create: {
      width: placedWidth,
      height: placedHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  }).png().toBuffer();
  const mask = await sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  }).composite([{ input: opaqueRegion, left: placedLeft, top: placedTop }]).png().toBuffer();

  return {
    image,
    mask,
    size: canvas.size,
    canvas: { width: canvas.width, height: canvas.height },
    targetRect,
    sourceRect: { left: placedLeft, top: placedTop, width: placedWidth, height: placedHeight }
  };
};

export const finalizeH3Outpaint = async (data, aspectRatio, { width, height }) => {
  const targetRatio = parseAspectRatio(aspectRatio);
  const metadata = await sharp(data).rotate().metadata();
  const sourceWidth = Number(metadata.width) || 0;
  const sourceHeight = Number(metadata.height) || 0;
  if (!sourceWidth || !sourceHeight) throw new Error('Expanded image dimensions could not be read');
  const crop = centeredTargetRect(sourceWidth, sourceHeight, targetRatio);
  return sharp(data)
    .rotate()
    .extract(crop)
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
};

export const composeH3OutpaintPrompt = ({ aspectRatio, scenePrompt } = {}) => [
  `智能扩展这张参考图，生成完整的 ${aspectRatio} 视频首帧画面。`,
  '中央原始画面已由蒙版锁定：必须逐像素保留，不得重绘、拉伸、压缩、裁切或改变其人物比例。',
  '只生成透明的新增区域。根据原图自然推断并延续背景、地面、墙面、光线、阴影和空间透视；如画幅需要延伸人物或服装，只补全原图之外缺失的部分，并保持身份、身材、裤型、面料、颜色、褶皱、鞋子和接地关系一致。',
  '最终必须是一张连续的单幅照片，不要边框、黑边、模糊填充、镜像复制、拼贴、文字、水印或界面元素。',
  scenePrompt ? `场景与后续视频语义仅供补全区域参考：${String(scenePrompt).trim().slice(0, 1200)}` : ''
].filter(Boolean).join('\n');
