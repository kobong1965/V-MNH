const parseError = async (response: Response, fallback: string) => {
  const data = await response.json().catch(() => ({}));
  return new Error(data.error || `${fallback}：${response.status}`);
};

const encodeFileAsBase64 = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return window.btoa(binary);
};

export const exportPortableBackup = async (password: string): Promise<void> => {
  const response = await fetch('/api/vela/portable-backup/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  if (!response.ok) throw await parseError(response, '迁移包导出失败');
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `Vela-跨电脑迁移-${new Date().toISOString().slice(0, 10)}.vela-backup`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
};

export const importPortableBackup = async (file: File, password: string): Promise<{ profiles: number; projects: number }> => {
  const response = await fetch('/api/vela/portable-backup/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, packageBase64: await encodeFileAsBase64(file) })
  });
  if (!response.ok) throw await parseError(response, '迁移包导入失败');
  return response.json();
};
