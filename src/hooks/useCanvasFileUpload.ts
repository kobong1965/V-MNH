import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { NodeData, NodeStatus, NodeType, Viewport } from '../types';

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const IMAGE_NODE_WIDTH = 656;
const VIDEO_NODE_WIDTH = 656;
const NODE_HEIGHT = 370;
const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'webp']);
const VIDEO_EXTENSIONS = new Set(['m4v', 'mov', 'mp4', 'webm']);

type CanvasPoint = { x: number; y: number };

interface CanvasFileUploadOptions {
  projectId?: string | null;
  nodes: NodeData[];
  viewport: Viewport;
  setNodes: Dispatch<SetStateAction<NodeData[]>>;
  setSelectedNodeIds: Dispatch<SetStateAction<string[]>>;
  onFeedback: (message: string) => void;
}

type MediaKind = 'image' | 'video';

const getFileExtension = (fileName: string) => fileName.split('.').pop()?.toLowerCase() || '';

const getMediaKind = (file: File): MediaKind | null => {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  const extension = getFileExtension(file.name);
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return null;
};

const readAsDataUrl = (file: File, onProgress: (progress: number) => void) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error || new Error('无法读取文件'));
  reader.onprogress = (event) => {
    if (event.lengthComputable) onProgress(Math.max(4, Math.min(36, Math.round((event.loaded / event.total) * 36))));
  };
  reader.onload = () => resolve(reader.result as string);
  reader.readAsDataURL(file);
});

const persistAsset = (
  projectId: string,
  data: string,
  fileName: string,
  onProgress: (progress: number) => void
) => new Promise<{ url: string }>((resolve, reject) => {
  const request = new XMLHttpRequest();
  request.open('POST', `/api/vela/projects/${encodeURIComponent(projectId)}/media`);
  request.setRequestHeader('Content-Type', 'application/json');
  request.responseType = 'json';
  request.upload.onprogress = (event) => {
    if (event.lengthComputable) onProgress(36 + Math.round((event.loaded / event.total) * 62));
  };
  request.onerror = () => reject(new Error('上传连接中断，请重试'));
  request.onload = () => {
    const body = request.response as { url?: string; error?: string } | null;
    if (request.status >= 200 && request.status < 300 && body?.url) {
      resolve({ url: body.url });
      return;
    }
    reject(new Error(body?.error || '上传失败，请重试'));
  };
  request.send(JSON.stringify({ data, prompt: fileName, fileName }));
});

const readMediaSize = (url: string, type: 'image' | 'video') => new Promise<{ resultAspectRatio?: string; aspectRatio: string }>((resolve) => {
  const complete = (width?: number, height?: number) => {
    if (!width || !height) {
      resolve({ aspectRatio: '16:9' });
      return;
    }
    const ratio = width / height;
    const candidates = [
      ['1:1', 1], ['16:9', 16 / 9], ['9:16', 9 / 16], ['4:3', 4 / 3], ['3:4', 3 / 4], ['3:2', 3 / 2], ['2:3', 2 / 3]
    ] as const;
    const closest = candidates.reduce((best, candidate) => Math.abs(ratio - candidate[1]) < Math.abs(ratio - best[1]) ? candidate : best);
    resolve({ resultAspectRatio: `${width}/${height}`, aspectRatio: closest[0] });
  };

  if (type === 'image') {
    const image = new Image();
    image.onload = () => complete(image.naturalWidth, image.naturalHeight);
    image.onerror = () => complete();
    image.src = url;
    return;
  }

  const video = document.createElement('video');
  video.preload = 'metadata';
  video.onloadedmetadata = () => complete(video.videoWidth, video.videoHeight);
  video.onerror = () => complete();
  video.src = url;
});

export const useCanvasFileUpload = ({ projectId, nodes, viewport, setNodes, setSelectedNodeIds, onFeedback }: CanvasFileUploadOptions) => {
  const filesByNodeId = useRef(new Map<string, File>());
  const replacementSnapshots = useRef(new Map<string, Pick<NodeData,
    'status' | 'resultUrl' | 'resultUrls' | 'resultCollectionExpanded' | 'resultAspectRatio' | 'aspectRatio' | 'errorMessage' | 'uploadProgress'
  >>());

  const updateUpload = useCallback((nodeId: string, updates: Partial<NodeData>) => {
    setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, ...updates } : node));
  }, [setNodes]);

  const uploadNode = useCallback(async (nodeId: string, file: File) => {
    const mediaKind = getMediaKind(file);
    if (!mediaKind) {
      updateUpload(nodeId, { status: NodeStatus.ERROR, errorMessage: '不支持此文件格式。' });
      return false;
    }
    const isImage = mediaKind === 'image';
    updateUpload(nodeId, { status: NodeStatus.LOADING, uploadProgress: 0, errorMessage: undefined });

    try {
      if (!projectId) throw new Error('当前画布尚未创建项目，请返回首页重新打开项目');
      const data = await readAsDataUrl(file, (uploadProgress) => updateUpload(nodeId, { uploadProgress }));
      const { url } = await persistAsset(projectId, data, file.name, (uploadProgress) => updateUpload(nodeId, { uploadProgress }));
      const media = await readMediaSize(url, isImage ? 'image' : 'video');
      filesByNodeId.current.delete(nodeId);
      replacementSnapshots.current.delete(nodeId);
      updateUpload(nodeId, {
        status: NodeStatus.SUCCESS,
        resultUrl: url,
        resultUrls: undefined,
        resultCollectionExpanded: false,
        resultAspectRatio: media.resultAspectRatio,
        aspectRatio: media.aspectRatio,
        uploadProgress: 100,
        errorMessage: undefined
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '上传失败，请重试';
      const previous = replacementSnapshots.current.get(nodeId);
      replacementSnapshots.current.delete(nodeId);
      updateUpload(nodeId, previous
        ? { ...previous, errorMessage: undefined }
        : { status: NodeStatus.ERROR, uploadProgress: undefined, errorMessage: message });
      onFeedback(`“${file.name}”上传失败：${message}`);
      return false;
    }
  }, [onFeedback, projectId, updateUpload]);

  const uploadFilesAt = useCallback((files: File[], point: CanvasPoint) => {
    const accepted = files.filter((file) => getMediaKind(file) !== null);
    const rejected = files.filter((file) => !accepted.includes(file));
    if (rejected.length) onFeedback('仅支持拖入图片或视频文件。');

    const allowed = accepted.filter((file) => {
      if (file.size <= MAX_FILE_SIZE) return true;
      onFeedback(`“${file.name}”超过 100MB，未上传。`);
      return false;
    });
    if (!allowed.length) return;

    const droppedNodes = allowed.map((file, index) => {
      const isImage = getMediaKind(file) === 'image';
      const width = isImage ? IMAGE_NODE_WIDTH : VIDEO_NODE_WIDTH;
      const offset = index * 42;
      const node: NodeData = {
        id: crypto.randomUUID(),
        type: isImage ? NodeType.IMAGE : NodeType.VIDEO,
        kind: isImage ? 'image-input' : 'video-result',
        title: file.name,
        x: (point.x - viewport.x) / viewport.zoom - width / 2 + offset,
        y: (point.y - viewport.y) / viewport.zoom - NODE_HEIGHT / 2 + offset,
        prompt: file.name,
        status: NodeStatus.LOADING,
        uploadProgress: 0,
        uploadSource: 'canvas-drop',
        model: 'Upload',
        aspectRatio: '16:9',
        resolution: 'Auto',
        outputCount: 1,
        parentIds: []
      };
      filesByNodeId.current.set(node.id, file);
      return node;
    });

    setNodes((current) => [...current, ...droppedNodes]);
    setSelectedNodeIds(droppedNodes.map((node) => node.id));
    void Promise.all(droppedNodes.map((node) => uploadNode(node.id, filesByNodeId.current.get(node.id)!)));
  }, [onFeedback, setNodes, setSelectedNodeIds, uploadNode, viewport]);

  const retryCanvasUpload = useCallback((nodeId: string) => {
    const file = filesByNodeId.current.get(nodeId);
    if (!file) {
      onFeedback('此文件已不在浏览器临时缓存中，请重新拖入一次。');
      return;
    }
    void uploadNode(nodeId, file);
  }, [onFeedback, uploadNode]);

  const replaceNodeImage = useCallback((nodeId: string, file: File) => {
    if (getMediaKind(file) !== 'image') {
      onFeedback('请选择 JPG、PNG、WebP 等图片文件。');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      onFeedback(`“${file.name}”超过 100MB，未上传。`);
      return;
    }
    filesByNodeId.current.set(nodeId, file);
    const node = nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      onFeedback('当前图片节点不存在，请刷新画布后重试。');
      return;
    }
    replacementSnapshots.current.set(nodeId, {
      status: node.status,
      resultUrl: node.resultUrl,
      resultUrls: node.resultUrls,
      resultCollectionExpanded: node.resultCollectionExpanded,
      resultAspectRatio: node.resultAspectRatio,
      aspectRatio: node.aspectRatio,
      errorMessage: node.errorMessage,
      uploadProgress: node.uploadProgress
    });
    void uploadNode(nodeId, file).then((succeeded) => {
      if (succeeded) onFeedback(`已用“${file.name}”覆盖当前图片节点。`);
    });
  }, [nodes, onFeedback, uploadNode]);

  return { uploadFilesAt, retryCanvasUpload, replaceNodeImage };
};
