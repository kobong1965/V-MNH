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

const splitPrompt = (prompt, maxLength = 24) => {
  const characters = Array.from(prompt);
  const lines = [];

  for (let index = 0; index < characters.length; index += maxLength) {
    lines.push(characters.slice(index, index + maxLength).join(''));
  }

  return lines.slice(0, 5);
};

export class FakeImageProvider {
  id = 'fake-image';

  async generateImage({ prompt, aspectRatio = '1:1' }) {
    const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
    if (!normalizedPrompt) {
      throw new Error('Prompt is required');
    }

    const [width, height] = DIMENSIONS_BY_ASPECT_RATIO[aspectRatio]
      ?? DIMENSIONS_BY_ASPECT_RATIO['1:1'];
    const promptLines = splitPrompt(normalizedPrompt)
      .map((line, index) => `<tspan x="50%" dy="${index === 0 ? 0 : 44}">${escapeXml(line)}</tspan>`)
      .join('');

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#111318"/>
      <stop offset="100%" stop-color="#273249"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#background)"/>
  <rect x="32" y="32" width="${width - 64}" height="${height - 64}" rx="28" fill="none" stroke="#55A7FF" stroke-width="4"/>
  <text x="50%" y="42%" fill="#D8DEE9" text-anchor="middle" font-family="Microsoft YaHei UI, sans-serif" font-size="32">${promptLines}</text>
  <text x="50%" y="82%" fill="#F2B84B" text-anchor="middle" font-family="sans-serif" font-size="24">VELA FAKE PROVIDER · ${aspectRatio}</text>
</svg>`;

    return {
      providerId: this.id,
      mimeType: 'image/svg+xml',
      extension: 'svg',
      data: Buffer.from(svg, 'utf8')
    };
  }
}
