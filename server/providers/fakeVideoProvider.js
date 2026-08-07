const DIMENSIONS_BY_ASPECT_RATIO = {
  '1:1': [1024, 1024],
  '16:9': [1280, 720],
  '9:16': [720, 1280]
};

const escapeXml = (value) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

export class FakeVideoProvider {
  id = 'fake-h3-video';

  async generateVideo({ prompt, aspectRatio = '16:9' }) {
    const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
    if (!normalizedPrompt) throw new Error('Prompt is required');

    const [width, height] = DIMENSIONS_BY_ASPECT_RATIO[aspectRatio]
      ?? DIMENSIONS_BY_ASPECT_RATIO['16:9'];
    const safePrompt = escapeXml(Array.from(normalizedPrompt).slice(0, 70).join(''));
    const centerX = width / 2;
    const centerY = height / 2;
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs><linearGradient id="bg" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#111318"/><stop offset="1" stop-color="#382d20"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect x="32" y="32" width="${width - 64}" height="${height - 64}" rx="28" fill="none" stroke="#F2B84B" stroke-width="4"/>
  <circle cx="${centerX}" cy="${centerY - 44}" r="64" fill="#F2B84B" fill-opacity="0.16" stroke="#F2B84B" stroke-width="3"/>
  <path d="M ${centerX - 18} ${centerY - 78} L ${centerX + 36} ${centerY - 44} L ${centerX - 18} ${centerY - 10} Z" fill="#F2B84B"/>
  <text x="50%" y="${centerY + 72}" fill="#D8DEE9" text-anchor="middle" font-family="Microsoft YaHei UI, sans-serif" font-size="28">${safePrompt}</text>
  <text x="50%" y="88%" fill="#55A7FF" text-anchor="middle" font-family="sans-serif" font-size="22">H3 FAKE PREVIEW · ${aspectRatio}</text>
</svg>`;

    return {
      providerId: this.id,
      mimeType: 'image/svg+xml',
      extension: 'svg',
      data: Buffer.from(svg, 'utf8')
    };
  }
}
