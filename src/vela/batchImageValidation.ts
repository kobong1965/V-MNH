export const MAX_BATCH_IMAGE_BYTES = 100 * 1024 * 1024;

type BatchImageRole = 'source' | 'benchmark';

export interface BatchImageFileLike {
  type: string;
  size: number;
}

export const getBatchImageValidationError = (
  file: BatchImageFileLike,
  role: BatchImageRole
): string | null => {
  if (!file.type.startsWith('image/')) {
    return role === 'benchmark'
      ? '对标图必须是 JPG、PNG、WebP 等图片文件。'
      : '已跳过非图片文件，仅支持 JPG、PNG、WebP 等图片。';
  }
  if (file.size > MAX_BATCH_IMAGE_BYTES) {
    return role === 'benchmark'
      ? '对标图不能超过 100MB。'
      : '已跳过超过 100MB 的图片。';
  }
  return null;
};
