/**
 * App.tsx
 * 
 * Main application component for TwitCanva.
 * Orchestrates canvas, nodes, connections, and user interactions.
 * Uses custom hooks for state management and logic separation.
 */

import React, { useState, useEffect, useRef } from 'react';
import { CanvasNode } from './components/canvas/CanvasNode';
import { ConnectionsLayer } from './components/canvas/ConnectionsLayer';
import { ContextMenu } from './components/ContextMenu';
import { ContextMenuState, NodeData, NodeStatus, NodeType } from './types';
import { generateImage, generateVideo } from './services/generationService';
import { useCanvasNavigation } from './hooks/useCanvasNavigation';
import { useNodeManagement } from './hooks/useNodeManagement';
import { useConnectionDragging } from './hooks/useConnectionDragging';
import { useNodeDragging } from './hooks/useNodeDragging';
import { useGeneration } from './hooks/useGeneration';
import { useSelectionBox } from './hooks/useSelectionBox';
import { useGroupManagement } from './hooks/useGroupManagement';
import { useHistory } from './hooks/useHistory';
import { useCanvasTitle } from './hooks/useCanvasTitle';
import { useWorkflow } from './hooks/useWorkflow';
import { useImageEditor } from './hooks/useImageEditor';
import { useVideoEditor } from './hooks/useVideoEditor';
import { usePanelState } from './hooks/usePanelState';
import { useAssetHandlers } from './hooks/useAssetHandlers';
import { useCanvasFileUpload } from './hooks/useCanvasFileUpload';
import { useTextNodeHandlers } from './hooks/useTextNodeHandlers';
import { useImageNodeHandlers } from './hooks/useImageNodeHandlers';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useContextMenuHandlers } from './hooks/useContextMenuHandlers';
import { useAutoSave } from './hooks/useAutoSave';
import { useGenerationRecovery } from './hooks/useGenerationRecovery';
import { useVideoFrameExtraction } from './hooks/useVideoFrameExtraction';
import { extractVideoLastFrame } from './utils/videoHelpers';
import { SelectionBoundingBox } from './components/canvas/SelectionBoundingBox';
import { HistoryPanel } from './components/HistoryPanel';
import { ChatPanel, ChatBubble } from './components/ChatPanel';
import { ImageEditorModal } from './components/modals/ImageEditorModal';
import { VideoEditorModal } from './components/modals/VideoEditorModal';
import { ExpandedMediaModal } from './components/modals/ExpandedMediaModal';
import { CreateAssetModal } from './components/modals/CreateAssetModal';
import { TikTokImportModal } from './components/modals/TikTokImportModal';
import { TwitterPostModal } from './components/modals/TwitterPostModal';
import { TikTokPostModal } from './components/modals/TikTokPostModal';
import { AssetLibraryPanel } from './components/AssetLibraryPanel';
import { useTikTokImport } from './hooks/useTikTokImport';
import { useStoryboardGenerator } from './hooks/useStoryboardGenerator';
import { StoryboardGeneratorModal } from './components/modals/StoryboardGeneratorModal';
import { StoryboardVideoModal } from './components/modals/StoryboardVideoModal';
import { VelaNodeRail } from './vela/components/VelaNodeRail';
import { VelaAssetTray, type VelaGeneratedAsset } from './vela/components/VelaAssetTray';
import { VelaTaskCenter } from './vela/components/VelaTaskCenter';
import { VelaTopBar } from './vela/components/VelaTopBar';
import { VelaWorkflowPanel } from './vela/components/VelaWorkflowPanel';
import { VelaMiniMap } from './vela/components/VelaMiniMap';
import { createVelaPerformanceFixture } from './vela/performanceFixture';
import { VelaProjectPanel } from './vela/components/VelaProjectPanel';
import { VelaHome } from './vela/components/VelaHome';
import { useVelaJobs } from './vela/hooks/useVelaJobs';
import { useVelaProfiles } from './vela/hooks/useVelaProfiles';
import { createVelaJobGroup, getVelaJobErrorMessage } from './vela/services/jobService';
import { saveVelaProject, saveVelaProjectMedia } from './vela/services/projectService';
import {
  loadVelaPreferences,
  resolveAppearance,
  saveVelaPreferences,
  type AppearanceMode,
  type CanvasColorMode
} from './vela/services/settingsService';
import { isFakeProviderEnabled } from './services/generationService';
import { composeGenerationPrompt } from './vela/generationOptions';
import { instantiateWorkflowTemplate, type VelaWorkflowTemplate } from './vela/services/workflowTemplateService';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

// Helper to convert URL/Blob to Base64
const urlToBase64 = async (url: string): Promise<string> => {
  if (url.startsWith('data:image')) return url;

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error("Error converting URL to base64:", e);
    return "";
  }
};

const getProjectMediaPath = (url: string, projectId: string): string | null => {
  try {
    const pathname = new URL(url, window.location.origin).pathname;
    return pathname.startsWith(`/api/vela/projects/${projectId}/media/`) ? pathname : null;
  } catch {
    return null;
  }
};

const VELA_P1_UI = true;

export default function App() {
  // ============================================================================
  // STATE
  // ============================================================================

  const [hasApiKey] = useState(true); // Backend handles API key
  const [appView, setAppView] = useState<'home' | 'canvas' | 'api' | 'settings'>('home');
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    type: 'global'
  });

  const [preferences, setPreferences] = useState(loadVelaPreferences);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  const canvasTheme = preferences.canvas;
  const resolvedAppearance = resolveAppearance(preferences.appearance, systemPrefersDark);
  const [isCanvasFileDragActive, setIsCanvasFileDragActive] = useState(false);
  const canvasFileDragDepthRef = useRef(0);
  const [canvasUploadFeedback, setCanvasUploadFeedback] = useState<string | null>(null);
  const [isTaskCenterOpen, setIsTaskCenterOpen] = useState(false);
  const [isAssetTrayOpen, setIsAssetTrayOpen] = useState(false);
  const [isWorkflowTemplatePanelOpen, setIsWorkflowTemplatePanelOpen] = useState(false);
  const { profiles: velaProfiles, error: velaProfilesError, refresh: refreshVelaProfiles } = useVelaProfiles();

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const update = () => setSystemPrefersDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    saveVelaPreferences(preferences);
    document.documentElement.dataset.velaTheme = resolvedAppearance;
    document.documentElement.style.colorScheme = resolvedAppearance;
  }, [preferences, resolvedAppearance]);

  const handleAppearanceChange = (appearance: AppearanceMode) => setPreferences((current) => ({ ...current, appearance }));
  const handleCanvasThemeChange = (canvas: CanvasColorMode) => setPreferences((current) => ({ ...current, canvas }));

  // Panel state management (history, chat, asset library, expand)
  const {
    isHistoryPanelOpen,
    historyPanelY,
    handleHistoryClick: panelHistoryClick,
    closeHistoryPanel,
    expandedImageUrl,
    handleExpandImage,
    handleCloseExpand,
    isChatOpen,
    toggleChat,
    closeChat,
    isAssetLibraryOpen,
    assetLibraryY,
    assetLibraryVariant,
    handleAssetsClick: panelAssetsClick,
    closeAssetLibrary,
    openAssetLibraryModal,
    isDraggingNodeToChat,
    handleNodeDragStart,
    handleNodeDragEnd
  } = usePanelState();

  const [canvasHoveredNodeId, setCanvasHoveredNodeId] = useState<string | null>(null);


  // Canvas title state (via hook)
  const {
    canvasTitle,
    setCanvasTitle,
    isEditingTitle,
    setIsEditingTitle,
    editingTitleValue,
    setEditingTitleValue,
    canvasTitleInputRef
  } = useCanvasTitle();

  const {
    viewport,
    setViewport,
    canvasRef,
    handleWheel: baseHandleWheel,
    handleSliderZoom
  } = useCanvasNavigation();

  // Wrap handleWheel to pass hovered node for zoom-to-center
  const handleWheel = (e: React.WheelEvent) => {
    const hoveredNode = canvasHoveredNodeId ? nodes.find(n => n.id === canvasHoveredNodeId) : undefined;
    baseHandleWheel(e, hoveredNode);
  };

  const {
    nodes,
    setNodes,
    selectedNodeIds,
    setSelectedNodeIds,
    addNode,
    updateNode,
    deleteNode,
    deleteNodes,
    clearSelection,
    handleSelectTypeFromMenu,
    handleSelectKindFromMenu
  } = useNodeManagement();

  const handleAutoArrange = React.useCallback(() => {
    const depthCache = new Map<string, number>();
    const resolving = new Set<string>();
    const getDepth = (node: NodeData): number => {
      const cached = depthCache.get(node.id);
      if (cached !== undefined) return cached;
      if (resolving.has(node.id)) return 0;
      resolving.add(node.id);
      const parentDepths = (node.parentIds || [])
        .map((parentId) => nodes.find((candidate) => candidate.id === parentId))
        .filter((parent): parent is NodeData => Boolean(parent))
        .map((parent) => getDepth(parent) + 1);
      resolving.delete(node.id);
      const depth = parentDepths.length > 0 ? Math.max(...parentDepths) : 0;
      depthCache.set(node.id, depth);
      return depth;
    };
    const rows = new Map<number, number>();
    setNodes((current) => current.map((node) => {
      const depth = getDepth(node);
      const row = rows.get(depth) || 0;
      rows.set(depth, row + 1);
      return { ...node, x: 160 + depth * 440, y: 120 + row * 260 };
    }));
  }, [nodes, setNodes]);

  const {
    isDraggingConnection,
    connectionStart,
    tempConnectionEnd,
    hoveredNodeId: connectionHoveredNodeId,
    connectionTargetState,
    selectedConnection,
    setSelectedConnection,
    handleConnectorPointerDown,
    handleSelectionConnectorPointerDown,
    updateConnectionDrag,
    completeConnectionDrag,
    handleEdgeClick,
    deleteSelectedConnection
  } = useConnectionDragging();

  const {
    handleNodePointerDown,
    updateNodeDrag,
    endNodeDrag,
    startPanning,
    updatePanning,
    endPanning,
    isDragging,
    releasePointerCapture
  } = useNodeDragging();

  const {
    selectionBox,
    isSelecting,
    startSelection,
    updateSelection,
    endSelection,
    clearSelectionBox
  } = useSelectionBox();

  const {
    groups,
    setGroups, // For workflow loading
    groupNodes,
    ungroupNodes,
    cleanupInvalidGroups,
    getCommonGroup,
    sortGroupNodes,
    renameGroup
  } = useGroupManagement();

  // History for undo/redo
  const {
    present: historyState,
    undo,
    redo,
    pushHistory,
    canUndo,
    canRedo
  } = useHistory({ nodes, groups }, 50);

  // Workflow management
  const {
    workflowId,
    isWorkflowPanelOpen,
    workflowPanelY,
    handleSaveWorkflow,
    handleLoadWorkflow,
    handleWorkflowsClick,
    closeWorkflowPanel,
    resetWorkflowId
  } = useWorkflow({
    nodes,
    groups,
    viewport,
    canvasTitle,
    setNodes,
    setGroups,
    setSelectedNodeIds,
    setViewport,
    setCanvasTitle,
    setEditingTitleValue,
    onPanelOpen: () => {
      closeHistoryPanel();
      closeAssetLibrary();
    }
  });

  const {
    jobs: velaJobs,
    error: velaJobsError,
    refresh: refreshVelaJobs,
    retry: retryVelaJob,
    cancel: cancelVelaJob
  } = useVelaJobs();

  // Simple dirty flag for unsaved changes tracking
  const [isDirty, setIsDirty] = React.useState(false);
  const hasUnsavedChanges = isDirty && nodes.length > 0;

  // Mark as dirty when nodes or title change
  const isInitialMount = React.useRef(true);
  const lastLoadingCountRef = React.useRef(0);
  const ignoreNextChange = React.useRef(false);

  React.useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (ignoreNextChange.current) {
      ignoreNextChange.current = false;
      return;
    }

    setIsDirty(true);

    // Trigger immediate save if any node JUST entered LOADING state
    const currentLoadingCount = nodes.filter(n => n.status === NodeStatus.LOADING).length;
    if (currentLoadingCount > lastLoadingCountRef.current) {
      console.log('[App] New loading node detected, triggering immediate save for recovery protection');
      handleSaveWithTracking();
    }
    lastLoadingCountRef.current = currentLoadingCount;
  }, [nodes, canvasTitle]);

  // Update saved state after workflow save
  const handleSaveWithTracking = async () => {
    await handleSaveWorkflow();
    setIsDirty(false);
  };

  // Load workflow and update tracking
  const handleLoadWithTracking = async (id: string) => {
    ignoreNextChange.current = true;
    const loaded = await handleLoadWorkflow(id);
    if (!loaded) throw new Error('无法打开该项目');
    setIsDirty(false);
    setAppView('canvas');
  };

  const { handleGenerate } = useGeneration({
    nodes,
    updateNode
  });

  const handleVelaGenerate = React.useCallback(async (id: string) => {
    const node = nodes.find((candidate) => candidate.id === id);
    if (!node?.kind || !['gpt-prompt-optimizer', 'gpt-image', 'gpt-video', 'h3-video'].includes(node.kind)) {
      await handleGenerate(id);
      return;
    }
    try {
      const projectId = workflowId || await handleSaveWorkflow();
      if (!projectId) throw new Error('无法保存当前项目，请保存后重试');
      const isGptNode = node.kind.startsWith('gpt-');
      const fakeGptEnabled = node.kind !== 'gpt-video' && isFakeProviderEnabled();
      if (isGptNode && !node.profileId && !fakeGptEnabled) {
        throw new Error(node.kind === 'gpt-video' ? '请先在 API 页面添加视频账户，并在节点中选择账户' : '请先添加 GPT 账户，并在节点属性中选择账户');
      }
      const useFake = !isGptNode || fakeGptEnabled;
      updateNode(id, {
        status: NodeStatus.LOADING,
        generationProgress: 0,
        errorMessage: undefined
      });
      const videoGenerationMode = node.kind === 'gpt-video'
        ? node.videoGenerationMode || ((node.parentIds || []).length > 0 ? 'image-to-video' : 'text-to-video')
        : undefined;
      const referenceNodes = (videoGenerationMode === 'text-to-video' ? [] : node.parentIds || [])
        .map((parentId) => nodes.find((candidate) => candidate.id === parentId))
        .filter((parent): parent is NodeData => Boolean(parent?.resultUrl));
      if (node.kind === 'gpt-video' && videoGenerationMode === 'image-to-video' && referenceNodes.length === 0) {
        throw new Error('图生视频需要先连接至少一张可用的参考图片');
      }
      const referenceUrls = await Promise.all(referenceNodes.map(async (parent, index) => {
        const sourceUrl = parent.resultUrl!;
        const currentProjectPath = getProjectMediaPath(sourceUrl, projectId);
        if (currentProjectPath) return currentProjectPath;
        if (!isGptNode) return sourceUrl;

        const data = await urlToBase64(sourceUrl);
        if (!data.startsWith('data:image/')) {
          throw new Error(`参考图“${parent.title || index + 1}”无法读取，请重新拖入画布`);
        }
        const media = await saveVelaProjectMedia(projectId, {
          data,
          fileName: parent.title || `参考图-${index + 1}.png`
        });
        updateNode(parent.id, { resultUrl: media.url, uploadSource: 'canvas-drop' });
        return media.url;
      }));
      const generationPrompt = composeGenerationPrompt(node.prompt || '未填写描述', node.stylePreset, {
        aspectRatio: node.aspectRatio,
        resolution: node.resolution
      });
      const requestedPayload = {
        prompt: generationPrompt,
        nodeKind: node.kind,
        referenceUrls,
        aspectRatio: node.aspectRatio || '16:9',
        resolution: node.resolution || 'Auto',
        stylePreset: node.stylePreset,
        imageBatchMode: node.imageBatchMode,
        duration: node.kind === 'gpt-video' ? Math.max(4, Math.min(180, Math.round(node.videoDuration || 5))) : undefined,
        videoGenerationMode
      };

      // A remote video task may briefly report an unrecognized state even though it is
      // still running. Reuse its saved task id instead of creating another paid task.
      const resumableVideoErrorCodes = new Set([
        'BAD_RESPONSE',
        'VIDEO_POLL_TIMEOUT',
        'NETWORK_ERROR',
        'TIMEOUT',
        'RESULT_DOWNLOAD_FAILED',
        'PROVIDER_UNAVAILABLE'
      ]);
      const resumableVideoJob = node.kind === 'gpt-video'
        ? [...velaJobs]
          .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
          .find((job) => {
            if (
              job.nodeId !== node.id
              || job.profileId !== node.profileId
              || job.status !== 'failed'
              || !job.promptId
              || !resumableVideoErrorCodes.has(job.error?.code || '')
            ) return false;
            const payload = job.payload as {
              prompt?: unknown;
              nodeKind?: unknown;
              referenceUrls?: unknown;
              aspectRatio?: unknown;
              resolution?: unknown;
              duration?: unknown;
              videoGenerationMode?: unknown;
            };
            return payload.prompt === requestedPayload.prompt
              && payload.nodeKind === requestedPayload.nodeKind
              && payload.aspectRatio === requestedPayload.aspectRatio
              && payload.resolution === requestedPayload.resolution
              && payload.duration === requestedPayload.duration
              && payload.videoGenerationMode === requestedPayload.videoGenerationMode
              && JSON.stringify(payload.referenceUrls || []) === JSON.stringify(requestedPayload.referenceUrls);
          })
        : undefined;
      if (resumableVideoJob) {
        updateNode(id, { jobGroupId: resumableVideoJob.groupId });
        await retryVelaJob(resumableVideoJob.id);
        return;
      }
      const created = await createVelaJobGroup({
        projectId,
        nodeId: node.id,
        profileId: useFake ? 'fake-local' : node.profileId!,
        providerType: useFake ? 'fake' : 'gpt',
        payload: requestedPayload,
        count: node.kind === 'gpt-prompt-optimizer' ? 1 : Math.max(1, Math.min(['gpt-video', 'h3-video'].includes(node.kind) ? 4 : 10, node.outputCount || 1)),
        seedMode: 'increment',
        seed: Date.now() % 2147483647
      });
      updateNode(id, { jobGroupId: created.group.id });
      await refreshVelaJobs();
      if (useFake && isFakeProviderEnabled() && node.kind !== 'gpt-prompt-optimizer') await handleGenerate(id);
    } catch (error) {
      updateNode(id, {
        status: NodeStatus.ERROR,
        generationProgress: undefined,
        errorMessage: error instanceof Error ? error.message : '任务创建失败'
      });
    }
  }, [nodes, workflowId, handleSaveWorkflow, updateNode, refreshVelaJobs, retryVelaJob, velaJobs, handleGenerate]);

  React.useEffect(() => {
    setNodes((currentNodes) => {
      let changed = false;
      const nextNodes = currentNodes.map((node) => {
        const nodeJobs = velaJobs.filter((job) => (
          job.nodeId === node.id
          && (!node.kind?.startsWith('gpt-') || !node.profileId || job.profileId === node.profileId)
        ));
        if (nodeJobs.length === 0) return node;

        const requestedGroupJobs = node.jobGroupId
          ? nodeJobs.filter((job) => job.groupId === node.jobGroupId)
          : [];
        const latestJob = [...nodeJobs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
        const groupJobs = requestedGroupJobs.length > 0
          ? requestedGroupJobs
          : nodeJobs.filter((job) => job.groupId === latestJob.groupId);
        const orderedJobs = [...groupJobs].sort((left, right) => {
          const leftIndex = Number(left.payload.batchIndex ?? 0);
          const rightIndex = Number(right.payload.batchIndex ?? 0);
          return leftIndex - rightIndex || left.createdAt.localeCompare(right.createdAt);
        });
        const job = [...groupJobs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
        if (!job) return node;
        const activeStatuses = new Set(['queued', 'submitting', 'running', 'reconnecting', 'downloading']);
        const hasActiveJobs = groupJobs.some((candidate) => activeStatuses.has(candidate.status));
        const succeededJobs = orderedJobs.filter((candidate) => candidate.status === 'succeeded');
        const nextStatus = hasActiveJobs
          ? NodeStatus.LOADING
          : succeededJobs.length > 0
            ? NodeStatus.SUCCESS
            : NodeStatus.ERROR;
        const output = job.output as { media?: { url?: string }; text?: string } | null;
        const progressValues = groupJobs
          .map((candidate) => candidate.progress)
          .filter((value): value is number => typeof value === 'number');
        const generationProgress = progressValues.length === 0
          ? undefined
          : Math.max(0, Math.min(100, Math.round((progressValues.reduce((sum, value) => sum + value, 0) / groupJobs.length) * 100)));
        const errorMessage = job.status === 'failed'
          ? getVelaJobErrorMessage(job.error)
          : job.status === 'cancelled'
            ? '任务已取消。'
            : undefined;
        const resultUrls = succeededJobs
          .map((candidate) => (candidate.output as { media?: { url?: string } } | null)?.media?.url)
          .filter((url): url is string => Boolean(url));
        const uniqueResultUrls = [...new Set(resultUrls)];
        const resultUrl = uniqueResultUrls[0] || node.resultUrl;
        const prompt = job.status === 'succeeded' && output?.text && node.kind === 'gpt-prompt-optimizer'
          ? output.text
          : node.prompt;

        if (
          node.status === nextStatus
          && node.generationProgress === generationProgress
          && node.errorMessage === errorMessage
          && node.resultUrl === resultUrl
          && JSON.stringify(node.resultUrls || []) === JSON.stringify(uniqueResultUrls)
          && node.prompt === prompt
        ) return node;

        changed = true;
        return {
          ...node,
          status: nextStatus,
          generationProgress,
          errorMessage,
          resultUrl,
          resultUrls: uniqueResultUrls,
          prompt
        };
      });
      return changed ? nextNodes : currentNodes;
    });
  }, [velaJobs, setNodes]);

  // Keep a ref to handleGenerate so setTimeout callbacks can access the latest version
  const handleGenerateRef = React.useRef(handleGenerate);
  React.useEffect(() => {
    handleGenerateRef.current = handleGenerate;
  }, [handleGenerate]);

  // Create a persisted project first, then enter its independent blank canvas.
  const handleNewCanvas = async () => {
    if (isDirty && workflowId) await handleSaveWithTracking();
    const project = await saveVelaProject({
      name: '未命名项目',
      nodes: [],
      groups: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    });
    await handleLoadWithTracking(project.id);
  };

  const handleReturnHome = async () => {
    if (isDirty && workflowId) await handleSaveWithTracking();
    closeWorkflowPanel();
    closeHistoryPanel();
    closeAssetLibrary();
    setIsTaskCenterOpen(false);
    setIsAssetTrayOpen(false);
    setIsWorkflowTemplatePanelOpen(false);
    setAppView('home');
  };

  const handleUseWorkflowTemplate = React.useCallback((template: VelaWorkflowTemplate) => {
    const instance = instantiateWorkflowTemplate(template, viewport, {
      width: window.innerWidth,
      height: window.innerHeight
    });
    setNodes((current) => [...current, ...instance.nodes]);
    setGroups((current) => [...current, ...instance.groups]);
    setSelectedNodeIds(instance.nodes.map((node) => node.id));
    setIsDirty(true);
  }, [viewport, setNodes, setGroups, setSelectedNodeIds]);

  const handleProjectDeleted = (projectId: string) => {
    if (workflowId !== projectId) return;
    ignoreNextChange.current = true;
    setNodes([]);
    setGroups([]);
    setSelectedNodeIds([]);
    setViewport({ x: 0, y: 0, zoom: 1 });
    setCanvasTitle('未命名项目');
    setEditingTitleValue('未命名项目');
    resetWorkflowId();
    setIsDirty(false);
  };

  // Image editor modal
  const {
    editorModal,
    handleOpenImageEditor,
    handleCloseImageEditor,
    handleUpload
  } = useImageEditor({ nodes, updateNode });

  // Video editor modal
  const {
    videoEditorModal,
    handleOpenVideoEditor,
    handleCloseVideoEditor,
    handleExportTrimmedVideo
  } = useVideoEditor({ nodes, updateNode });

  /**
   * Routes editor open to the correct handler based on node type
   */
  const handleOpenEditor = React.useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    if (node.type === NodeType.VIDEO_EDITOR) {
      handleOpenVideoEditor(nodeId);
    } else {
      handleOpenImageEditor(nodeId);
    }
  }, [nodes, handleOpenVideoEditor, handleOpenImageEditor]);

  // Text node handlers
  const {
    handleWriteContent,
    handleTextToVideo,
    handleTextToImage
  } = useTextNodeHandlers({ nodes, updateNode, setNodes, setSelectedNodeIds });

  // Image node handlers
  const {
    handleImageToImage,
    handleImageToVideo,
    handleChangeAngleGenerate
  } = useImageNodeHandlers({ nodes, setNodes, setSelectedNodeIds, onGenerateNode: handleGenerate });

  // Asset handlers (create asset modal)
  const {
    isCreateAssetModalOpen,
    setIsCreateAssetModalOpen,
    nodeToSnapshot,
    handleOpenCreateAsset,
    handleSaveAssetToLibrary,
    handleContextUpload
  } = useAssetHandlers({ nodes, viewport, contextMenu, setNodes });

  const { uploadFilesAt, retryCanvasUpload } = useCanvasFileUpload({
    projectId: workflowId,
    viewport,
    setNodes,
    setSelectedNodeIds,
    onFeedback: setCanvasUploadFeedback
  });

  // Keyboard shortcuts (copy/paste/delete/undo/redo)
  const {
    handleCopy,
    handlePaste,
    handleDuplicate
  } = useKeyboardShortcuts({
    enabled: appView === 'canvas',
    nodes,
    selectedNodeIds,
    selectedConnection,
    setNodes,
    setSelectedNodeIds,
    setContextMenu,
    deleteNodes,
    deleteSelectedConnection,
    clearSelection,
    clearSelectionBox,
    undo,
    redo
  });

  // Auto-Save Management
  const { lastSaveTime: lastAutoSaveTime } = useAutoSave({
    isDirty,
    nodes,
    onSave: handleSaveWithTracking,
    interval: 60000 // Save every 60 seconds
  });

  // Generation Recovery Management
  useGenerationRecovery({
    nodes,
    updateNode
  });

  // Video Frame Extraction (auto-extract lastFrame for videos missing thumbnails)
  useVideoFrameExtraction({
    nodes,
    updateNode
  });

  // TikTok Import Tool
  const {
    isModalOpen: isTikTokModalOpen,
    openModal: openTikTokModal,
    closeModal: closeTikTokModal,
    handleVideoImported: handleTikTokVideoImported
  } = useTikTokImport({
    nodes,
    setNodes,
    setSelectedNodeIds,
    viewport
  });

  // Storyboard Generator Tool
  const handleCreateStoryboardNodes = React.useCallback((
    newNodeData: Partial<NodeData>[],
    groupInfo?: { groupId: string; groupLabel: string }
  ) => {
    console.log('[Storyboard] handleCreateStoryboardNodes called with', newNodeData.length, 'nodes, groupInfo:', !!groupInfo);
    const newNodes: NodeData[] = newNodeData.map(data => ({
      id: data.id || crypto.randomUUID(),
      type: data.type || NodeType.IMAGE,
      x: data.x || 0,
      y: data.y || 0,
      prompt: data.prompt || '',
      status: data.status || NodeStatus.IDLE,
      model: data.model || 'gpt-image-1.5',
      imageModel: data.imageModel,
      aspectRatio: data.aspectRatio || '16:9',
      resolution: data.resolution || '1K',
      title: data.title,
      parentIds: data.parentIds || [],
      groupId: data.groupId,
      characterReferenceUrls: data.characterReferenceUrls
    }));

    setNodes(prev => [...prev, ...newNodes]);

    // Auto-group the storyboard nodes
    if (groupInfo && newNodes.length > 0) {
      const newGroup = {
        id: groupInfo.groupId,
        nodeIds: newNodes.map(n => n.id),
        label: groupInfo.groupLabel,
        // Save story context if available to help AI understand the full narrative later
        storyContext: (groupInfo as any).storyContext
      };
      setGroups(prev => [...prev, newGroup]);
    }

    if (newNodes.length > 0) {
      setSelectedNodeIds(newNodes.map(n => n.id));
    }

    // Auto-trigger generation for each storyboard node with a small delay
    // to ensure state is updated before generation starts
    if (groupInfo) {
      setTimeout(() => {
        console.log('[Storyboard] Auto-triggering generation for', newNodes.length, 'nodes');
        newNodes.forEach((node, index) => {
          // Stagger generation calls slightly to avoid overwhelming the API
          setTimeout(() => {
            console.log(`[Storyboard] Starting generation for node ${index + 1}:`, node.id);
            // Use ref to get the latest handleGenerate function
            handleGenerateRef.current(node.id);
          }, index * 500); // 500ms delay between each node
        });
      }, 100); // Initial delay to let state settle
    }
  }, [setNodes, setSelectedNodeIds, setGroups]);

  const storyboardGenerator = useStoryboardGenerator({
    onCreateNodes: handleCreateStoryboardNodes,
    viewport
  });

  const handleEditStoryboard = React.useCallback((groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (group?.storyContext) {
      console.log('[App] Editing storyboard:', groupId);
      storyboardGenerator.editStoryboard(group.storyContext);
    }
  }, [groups, storyboardGenerator]);

  // Storyboard Video Modal State
  const [storyboardVideoModal, setStoryboardVideoModal] = useState<{
    isOpen: boolean;
    nodes: NodeData[];
    storyContext?: { story: string; scripts: any[] };
  }>({ isOpen: false, nodes: [] });

  const handleCreateStoryboardVideo = React.useCallback((targetNodeIds?: string[]) => {
    // Determine which nodes to use: explicit list or current selection
    const nodeIdsToCheck = targetNodeIds || selectedNodeIds;

    // Filter for Image nodes only (can't make video from text/video directly in this flow)
    const selectedImageNodes = nodes.filter(n => nodeIdsToCheck.includes(n.id) && n.type === NodeType.IMAGE);

    if (selectedImageNodes.length === 0) {
      console.warn("No image nodes selected for video generation. Checked IDs:", nodeIdsToCheck);
      return;
    }

    // Check if nodes belong to a group with story context
    const firstNode = selectedImageNodes[0];
    const group = firstNode.groupId ? groups.find(g => g.id === firstNode.groupId) : undefined;
    const storyContext = group?.storyContext;

    if (storyContext) {
      console.log('[App] Found Story Context for Video Modal:', {
        storyLength: storyContext.story.length,
        scriptsCount: storyContext.scripts.length
      });
    }

    setStoryboardVideoModal({
      isOpen: true,
      nodes: selectedImageNodes,
      storyContext
    });
  }, [nodes, selectedNodeIds, groups]);

  const handleGenerateStoryVideos = React.useCallback((
    prompts: Record<string, string>,
    settings: { model: string; duration: number; resolution: string; },
    activeNodeIds?: string[]
  ) => {
    // Close modal
    setStoryboardVideoModal(prev => ({ ...prev, isOpen: false }));

    const newNodes: NodeData[] = [];
    // Use activeNodeIds to filter source nodes if provided, otherwise use all
    const sourceNodes = activeNodeIds
      ? storyboardVideoModal.nodes.filter(n => activeNodeIds.includes(n.id))
      : storyboardVideoModal.nodes;

    // Calculate layout bounds of the ENTIRE storyboard to position videos to the RIGHT
    // Use all storyboard nodes to properly calculate the bounding box
    const allStoryboardNodes = storyboardVideoModal.nodes;

    // Assume a default width if not present (though images usually have it)
    const DEFAULT_WIDTH = 400;

    // Find the rightmost edge of the entire group
    const groupMaxX = Math.max(...allStoryboardNodes.map(n => n.x + ((n as any).width || DEFAULT_WIDTH)));

    // Calculate the left edge of the group to maintain relative offsets
    const groupMinX = Math.min(...allStoryboardNodes.map(n => n.x));

    // Shift Amount: Move everything to the right of the group with a gap
    const GAP_X = 100;
    const xOffset = groupMaxX + GAP_X - groupMinX;

    sourceNodes.forEach((sourceNode) => {
      // Create a new Video node for each image
      const newNodeId = crypto.randomUUID();
      const PROMPT = prompts[sourceNode.id] || sourceNode.prompt || 'Animated video';

      const newVideoNode: NodeData = {
        id: newNodeId,
        type: NodeType.VIDEO,
        // Clone the layout pattern but shifted to the right
        x: sourceNode.x + xOffset,
        y: sourceNode.y,
        prompt: PROMPT,
        status: NodeStatus.IDLE, // Will switch to LOADING when generated
        model: settings.model,
        videoModel: settings.model, // Explicitly set video model
        videoDuration: settings.duration,
        aspectRatio: sourceNode.aspectRatio || '16:9',
        resolution: settings.resolution,
        parentIds: [sourceNode.id], // Connect to source image
        // groupId: undefined, // Explicitly NOT in the group
        videoMode: 'frame-to-frame', // Important for image-to-video
        inputUrl: sourceNode.resultUrl, // Pass image as input
      };

      newNodes.push(newVideoNode);
    });

    // added new nodes to state
    setNodes(prev => [...prev, ...newNodes]);

    // Auto-trigger generation (staggered)
    setTimeout(() => {
      newNodes.forEach((node, index) => {
        setTimeout(() => {
          handleGenerateRef.current(node.id);
        }, index * 1000); // 1s delay between each to avoid rate limits
      });
    }, 500);

  }, [storyboardVideoModal.nodes, setNodes]);

  // Twitter Post Modal State
  const [twitterModal, setTwitterModal] = useState<{
    isOpen: boolean;
    mediaUrl: string | null;
    mediaType: 'image' | 'video';
  }>({ isOpen: false, mediaUrl: null, mediaType: 'image' });

  const handlePostToX = React.useCallback((nodeId: string, mediaUrl: string, mediaType: 'image' | 'video') => {
    console.log('[Twitter] Opening post modal for:', nodeId, mediaUrl, mediaType);
    setTwitterModal({
      isOpen: true,
      mediaUrl,
      mediaType
    });
  }, []);

  // TikTok Post Modal State
  const [tiktokModal, setTiktokModal] = useState<{
    isOpen: boolean;
    mediaUrl: string | null;
  }>({ isOpen: false, mediaUrl: null });

  const handlePostToTikTok = React.useCallback((nodeId: string, mediaUrl: string) => {
    console.log('[TikTok] Opening post modal for:', nodeId, mediaUrl);
    setTiktokModal({
      isOpen: true,
      mediaUrl
    });
  }, []);

  // Context menu handlers
  const {
    handleDoubleClick,
    handleGlobalContextMenu,
    handleAddNext,
    handleNodeContextMenu,
    handleContextMenuCreateAsset,
    handleContextMenuSelect,
    handleContextMenuSelectKind,
    handleToolbarAdd
  } = useContextMenuHandlers({
    nodes,
    viewport,
    contextMenu,
    setContextMenu,
    handleOpenCreateAsset,
    handleSelectTypeFromMenu,
    handleSelectKindFromMenu
  });

  // Wrapper functions that pass closeWorkflowPanel to panel handlers
  const handleHistoryClick = (e: React.MouseEvent) => {
    panelHistoryClick(e, closeWorkflowPanel);
  };

  const handleAssetsClick = (e: React.MouseEvent) => {
    panelAssetsClick(e, closeWorkflowPanel);
  };

  const handleContextMenuAddAssets = () => {
    openAssetLibraryModal(contextMenu.y, closeWorkflowPanel);
  };

  /**
   * Convert pixel dimensions to closest standard aspect ratio
   */
  const getClosestAspectRatio = (width: number, height: number): string => {
    const ratio = width / height;
    const standardRatios = [
      { label: '1:1', value: 1 },
      { label: '16:9', value: 16 / 9 },
      { label: '9:16', value: 9 / 16 },
      { label: '4:3', value: 4 / 3 },
      { label: '3:4', value: 3 / 4 },
      { label: '3:2', value: 3 / 2 },
      { label: '2:3', value: 2 / 3 },
      { label: '5:4', value: 5 / 4 },
      { label: '4:5', value: 4 / 5 },
      { label: '21:9', value: 21 / 9 }
    ];

    let closest = standardRatios[0];
    let minDiff = Math.abs(ratio - closest.value);

    for (const r of standardRatios) {
      const diff = Math.abs(ratio - r.value);
      if (diff < minDiff) {
        minDiff = diff;
        closest = r;
      }
    }

    return closest.label;
  };

  /**
   * Convert pixel dimensions to closest video aspect ratio (only 16:9 or 9:16)
   */
  const getClosestVideoAspectRatio = (width: number, height: number): string => {
    const ratio = width / height;
    // Video models only support 16:9 (1.78) and 9:16 (0.56)
    // If wider than 1:1 (ratio > 1), use 16:9; otherwise use 9:16
    return ratio >= 1 ? '16:9' : '9:16';
  };

  /**
   * Handle selecting an asset from history - creates new node with the image/video
   */
  const handleSelectAsset = (type: 'images' | 'videos', url: string, prompt: string, model?: string) => {
    // Calculate position at center of canvas
    const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom - 170;
    const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom - 150;

    // Create node with detected aspect ratio
    const createNode = (resultAspectRatio?: string, aspectRatio?: string) => {
      const isVideo = type === 'videos';
      // Use the original model from asset metadata, or fall back to defaults
      const defaultModel = isVideo ? 'veo-3.1' : 'imagen-3.0-generate-002';
      const nodeModel = model || defaultModel;

      const newNode: NodeData = {
        id: Date.now().toString(),
        type: isVideo ? NodeType.VIDEO : NodeType.IMAGE,
        x: centerX,
        y: centerY,
        prompt: prompt,
        status: NodeStatus.SUCCESS,
        resultUrl: url,
        resultAspectRatio,
        model: nodeModel,
        videoModel: isVideo ? nodeModel : undefined,
        imageModel: !isVideo ? nodeModel : undefined,
        aspectRatio: aspectRatio || '16:9',
        resolution: isVideo ? 'Auto' : '1K'
      };

      setNodes(prev => [...prev, newNode]);
      setSelectedNodeIds([newNode.id]);
      closeHistoryPanel();
      closeAssetLibrary();
    };

    if (type === 'images') {
      // Detect image dimensions
      const img = new Image();
      img.onload = () => {
        const resultAspectRatio = `${img.naturalWidth}/${img.naturalHeight}`;
        const aspectRatio = getClosestAspectRatio(img.naturalWidth, img.naturalHeight);
        console.log(`[App] Image loaded: ${img.naturalWidth}x${img.naturalHeight} -> ${aspectRatio}`);
        createNode(resultAspectRatio, aspectRatio);
      };
      img.onerror = () => {
        console.log('[App] Image load error, using default 16:9');
        createNode(undefined, '16:9');
      };
      img.src = url;
    } else {
      // Detect video dimensions
      const video = document.createElement('video');
      video.onloadedmetadata = () => {
        const resultAspectRatio = `${video.videoWidth}/${video.videoHeight}`;
        // Use video-specific function that only returns 16:9 or 9:16
        const aspectRatio = getClosestVideoAspectRatio(video.videoWidth, video.videoHeight);
        console.log(`[App] Video loaded: ${video.videoWidth}x${video.videoHeight} -> ${aspectRatio}`);
        createNode(resultAspectRatio, aspectRatio);
      };
      video.onerror = () => {
        console.log('[App] Video load error, using default 16:9');
        createNode(undefined, '16:9');
      };
      video.src = url;
    }
  };

  const handleLibrarySelect = (url: string, type: 'image' | 'video') => {
    handleSelectAsset(type === 'image' ? 'images' : 'videos', url, 'Asset Library Item');
    closeAssetLibrary();
  };

  // Create asset modal (isCreateAssetModalOpen, handleOpenCreateAsset, handleSaveAssetToLibrary) provided by useAssetHandlers hook

  // ============================================================================
  // EFFECTS
  // ============================================================================

  // Prevent default zoom behavior
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleNativeWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };

    canvas.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleNativeWheel);
  }, []);

  // Keyboard shortcuts (handleCopy, handlePaste, handleDuplicate) provided by useKeyboardShortcuts hook

  // Cleanup invalid groups (groups with less than 2 nodes)
  useEffect(() => {
    cleanupInvalidGroups(nodes, setNodes);
  }, [nodes, cleanupInvalidGroups]);

  // Track state changes for undo/redo (only after drag ends, not during)
  const isApplyingHistory = React.useRef(false);

  useEffect(() => {
    // Don't push to history if we're currently applying history (undo/redo)
    if (isApplyingHistory.current) {
      isApplyingHistory.current = false;
      return;
    }

    // Don't push to history while dragging (wait until drag ends)
    if (isDragging) {
      return;
    }

    // Push to history when nodes or groups change
    pushHistory({ nodes, groups });
  }, [nodes, groups, isDragging]);

  // Apply the complete canvas snapshot when undo/redo is triggered.
  useEffect(() => {
    if (historyState.nodes !== nodes || historyState.groups !== groups) {
      // Never remove or roll back a node that currently represents a paid/running
      // generation task. Other canvas edits can still be undone while it runs.
      const activeNodes = new Map(
        nodes
          .filter((node) => node.status === NodeStatus.LOADING)
          .map((node) => [node.id, node])
      );
      const restoredNodes = historyState.nodes.map((node) => activeNodes.get(node.id) || node);
      activeNodes.forEach((node, id) => {
        if (!restoredNodes.some((candidate) => candidate.id === id)) restoredNodes.push(node);
      });

      isApplyingHistory.current = true;
      setNodes(restoredNodes);
      setGroups(historyState.groups);
      setSelectedNodeIds((current) => current.filter((id) => restoredNodes.some((node) => node.id === id)));
      setSelectedConnection(null);
    }
    // The live node/group state is intentionally read only when the history cursor moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyState, setGroups, setNodes, setSelectedNodeIds, setSelectedConnection]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (new URLSearchParams(window.location.search).get('velaFixture') !== '200') return;
    const timer = window.setTimeout(() => {
      setNodes((current) => current.length > 0 ? current : createVelaPerformanceFixture());
    }, 100);
    return () => window.clearTimeout(timer);
  }, [setNodes]);

  // Simple wrapper for updateNode (sync code removed - TEXT node prompts are combined at generation time)
  const updateNodeWithSync = React.useCallback((id: string, updates: Partial<NodeData>) => {
    updateNode(id, updates);
  }, [updateNode]);

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).id === 'canvas-background') {
      // Left-click (button 0): Start selection box
      if (e.button === 0) {
        startSelection(e);
        clearSelection();
        setSelectedConnection(null);
        setContextMenu(prev => ({ ...prev, isOpen: false }));
        closeWorkflowPanel();
        closeHistoryPanel();
        closeAssetLibrary();
      }
    }
  };

  const handleCanvasPointerDownCapture = (e: React.PointerEvent) => {
    // The wheel button (button 1) is reserved exclusively for canvas panning.
    // Capture it before nodes, media, controls, groups, or connectors can start a drag.
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    endNodeDrag();
    startPanning(e);
    setSelectedConnection(null);
    setContextMenu(prev => ({ ...prev, isOpen: false }));
  };

  const isFileDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types)
    .some((type) => type.toLowerCase() === 'files');

  const handleCanvasDragEnter = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    canvasFileDragDepthRef.current += 1;
    if (canvasFileDragDepthRef.current === 1) setIsCanvasFileDragActive(true);
  };

  const handleCanvasDragOver = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleCanvasDragLeave = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    canvasFileDragDepthRef.current = Math.max(0, canvasFileDragDepthRef.current - 1);
    if (canvasFileDragDepthRef.current === 0) setIsCanvasFileDragActive(false);
  };

  const handleCanvasDrop = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    canvasFileDragDepthRef.current = 0;
    setIsCanvasFileDragActive(false);
    setCanvasUploadFeedback(null);
    const rect = e.currentTarget.getBoundingClientRect();
    uploadFilesAt(Array.from(e.dataTransfer.files), {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
  };

  const handleGlobalPointerMove = (e: React.PointerEvent) => {
    // Middle-button canvas panning always wins over every material interaction.
    if (updatePanning(e, setViewport)) return;

    // 1. Handle Selection Box Update
    if (updateSelection(e)) return;

    // 2. Handle Node Dragging
    if (updateNodeDrag(e, viewport, setNodes, selectedNodeIds)) return;

    // 3. Handle Connection Dragging
    if (updateConnectionDrag(e, nodes, viewport)) return;

  };

  /**
   * Handle when a connection is made between nodes
   * Syncs prompt if parent is a Text node
   */
  const handleConnectionMade = React.useCallback((parentId: string, childId: string) => {
    // Find the parent node
    const parentNode = nodes.find(n => n.id === parentId);
    if (!parentNode) return;

    // If parent is a Text node, sync its prompt to the child
    if (parentNode.type === NodeType.TEXT && parentNode.prompt) {
      updateNode(childId, { prompt: parentNode.prompt });
    }
  }, [nodes, updateNode]);

  const handleGlobalPointerUp = (e: React.PointerEvent) => {
    // A middle-button pan must not complete a selection, connection, or node drag.
    if (endPanning()) {
      releasePointerCapture(e);
      return;
    }

    // 1. Handle Selection Box End
    if (isSelecting) {
      const selectedIds = endSelection(nodes, viewport);
      setSelectedNodeIds(selectedIds);
      releasePointerCapture(e);
      return;
    }

    // 2. Handle Connection Drop
    if (completeConnectionDrag(handleAddNext, setNodes, nodes, handleConnectionMade, { x: e.clientX, y: e.clientY })) {
      releasePointerCapture(e);
      return;
    }

    // 3. Stop Node Dragging
    endNodeDrag();

    // 4. Release capture
    releasePointerCapture(e);
  };

  // Context menu handlers provided by useContextMenuHandlers hook
  // handleDoubleClick, handleGlobalContextMenu, handleAddNext, handleNodeContextMenu,
  // handleContextMenuCreateAsset, handleContextMenuSelect, handleToolbarAdd


  const activeTaskCount = velaJobs.filter(job => ['submitting', 'running', 'reconnecting', 'downloading'].includes(job.status)).length;
  const generatedAssets = React.useMemo<VelaGeneratedAsset[]>(() => {
    const seen = new Set<string>();
    const assets: VelaGeneratedAsset[] = [];
    const addAsset = (asset: VelaGeneratedAsset) => {
      if (seen.has(asset.url)) return;
      seen.add(asset.url);
      assets.push(asset);
    };

    [...velaJobs]
      .filter((job) => job.status === 'succeeded' && (!workflowId || job.projectId === workflowId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .forEach((job) => {
        const output = job.output as { media?: { url?: string; type?: string } } | null;
        if (!output?.media?.url) return;
        const node = nodes.find((candidate) => candidate.id === job.nodeId);
        const isVideo = output.media.type?.startsWith('video')
          || node?.type === NodeType.VIDEO
          || node?.kind === 'gpt-video'
          || node?.kind === 'h3-video'
          || node?.kind === 'video-result';
        addAsset({
          id: job.id,
          type: isVideo ? 'video' : 'image',
          url: output.media.url,
          title: node?.title || (isVideo ? '生成视频' : '生成图片'),
          prompt: node?.prompt,
          model: node?.videoModel || node?.imageModel || node?.model
        });
      });

    nodes.forEach((node) => {
      if (node.status !== NodeStatus.SUCCESS || !node.resultUrl) return;
      if (!node.kind || !['gpt-image', 'gpt-video', 'h3-video', 'image-result', 'video-result'].includes(node.kind)) return;
      addAsset({
        id: node.id,
        type: node.type === NodeType.VIDEO || node.kind === 'gpt-video' || node.kind === 'h3-video' || node.kind === 'video-result' ? 'video' : 'image',
        url: node.resultUrl,
        title: node.title || (node.type === NodeType.VIDEO ? '生成视频' : '生成图片'),
        prompt: node.prompt,
        model: node.videoModel || node.imageModel || node.model
      });
    });
    return assets;
  }, [nodes, velaJobs, workflowId]);

  if (appView !== 'canvas') {
    return (
      <VelaHome
        page={appView}
        theme={resolvedAppearance}
        currentProjectId={workflowId || undefined}
        onCreate={handleNewCanvas}
        onOpen={handleLoadWithTracking}
        onProjectDeleted={handleProjectDeleted}
        onNavigate={setAppView}
        profiles={velaProfiles}
        profilesError={velaProfilesError}
        onProfilesChanged={refreshVelaProfiles}
        appearance={preferences.appearance}
        canvas={preferences.canvas}
        onAppearanceChange={handleAppearanceChange}
        onCanvasChange={handleCanvasThemeChange}
      />
    );
  }

  return (
    <div data-theme={canvasTheme} className={`vela-app w-screen h-screen ${canvasTheme === 'dark' ? 'text-white' : 'text-neutral-900'} overflow-hidden select-none font-sans`}>
      {!storyboardGenerator.isModalOpen && !isTikTokModalOpen && (
        <VelaNodeRail
          onAddClick={handleToolbarAdd}
          onProjectsClick={handleWorkflowsClick}
          onAssetsClick={handleAssetsClick}
          onTasksClick={() => setIsTaskCenterOpen(current => !current)}
          onArrangeClick={handleAutoArrange}
        />
      )}

      <VelaProjectPanel
        isOpen={isWorkflowPanelOpen}
        onClose={closeWorkflowPanel}
        onLoad={handleLoadWithTracking}
        currentProjectId={workflowId || undefined}
      />

      {/* History Panel */}
      <HistoryPanel
        isOpen={isHistoryPanelOpen}
        onClose={closeHistoryPanel}
        onSelectAsset={handleSelectAsset}
        panelY={historyPanelY}
        canvasTheme={canvasTheme}
      />

      <AssetLibraryPanel
        isOpen={isAssetLibraryOpen}
        onClose={closeAssetLibrary}
        onSelectAsset={handleLibrarySelect}
        panelY={assetLibraryY}
        variant={assetLibraryVariant}
        canvasTheme={canvasTheme}
      />

      <CreateAssetModal
        isOpen={isCreateAssetModalOpen}
        onClose={() => setIsCreateAssetModalOpen(false)}
        nodeToSnapshot={nodeToSnapshot}
        onSave={handleSaveAssetToLibrary}
      />

      {/* TikTok Import Modal */}
      <TikTokImportModal
        isOpen={isTikTokModalOpen}
        onClose={closeTikTokModal}
        onVideoImported={handleTikTokVideoImported}
      />

      {/* Twitter Post Modal */}
      <TwitterPostModal
        isOpen={twitterModal.isOpen}
        onClose={() => setTwitterModal(prev => ({ ...prev, isOpen: false }))}
        mediaUrl={twitterModal.mediaUrl}
        mediaType={twitterModal.mediaType}
      />

      {/* TikTok Post Modal */}
      <TikTokPostModal
        isOpen={tiktokModal.isOpen}
        onClose={() => setTiktokModal(prev => ({ ...prev, isOpen: false }))}
        mediaUrl={tiktokModal.mediaUrl}
      />

      {/* Storyboard Generator Modal */}
      <StoryboardGeneratorModal
        isOpen={storyboardGenerator.isModalOpen}
        onClose={storyboardGenerator.closeModal}
        state={storyboardGenerator.state}
        onSetStep={storyboardGenerator.setStep}
        onToggleCharacter={storyboardGenerator.toggleCharacter}
        onSetSceneCount={storyboardGenerator.setSceneCount}
        onSetStory={storyboardGenerator.setStory}
        onUpdateScript={storyboardGenerator.updateScript}
        onGenerateScripts={storyboardGenerator.generateScripts}
        onBrainstormStory={storyboardGenerator.brainstormStory}
        onOptimizeStory={storyboardGenerator.optimizeStory}
        onGenerateComposite={storyboardGenerator.generateComposite}
        onRegenerateComposite={storyboardGenerator.regenerateComposite}
        onCreateNodes={storyboardGenerator.createStoryboardNodes}
      />

      {/* Agent Chat */}
      {!VELA_P1_UI && !storyboardGenerator.isModalOpen && !isTikTokModalOpen && (
        <>
          <ChatBubble onClick={toggleChat} isOpen={isChatOpen} />
          <ChatPanel isOpen={isChatOpen} onClose={closeChat} isDraggingNode={isDraggingNodeToChat} canvasTheme={canvasTheme} />
        </>
      )}

      {!storyboardGenerator.isModalOpen && !isTikTokModalOpen && (
        <VelaTopBar
          canvasTitle={canvasTitle}
          isEditingTitle={isEditingTitle}
          editingTitleValue={editingTitleValue}
          canvasTitleInputRef={canvasTitleInputRef}
          setCanvasTitle={setCanvasTitle}
          setIsEditingTitle={setIsEditingTitle}
          setEditingTitleValue={setEditingTitleValue}
          onSave={handleSaveWithTracking}
          onNew={handleNewCanvas}
          onHome={handleReturnHome}
          hasUnsavedChanges={hasUnsavedChanges}
          lastAutoSaveTime={lastAutoSaveTime}
          activeTaskCount={activeTaskCount}
          assetCount={generatedAssets.length}
          onOpenTasks={() => setIsTaskCenterOpen(current => !current)}
          onOpenAssets={() => {
            setIsAssetTrayOpen((current) => !current);
            setIsTaskCenterOpen(false);
            setIsWorkflowTemplatePanelOpen(false);
            closeWorkflowPanel();
          }}
          onOpenWorkflows={() => {
            setIsWorkflowTemplatePanelOpen((current) => !current);
            closeWorkflowPanel();
            setIsTaskCenterOpen(false);
            setIsAssetTrayOpen(false);
          }}
          isWorkflowPanelOpen={isWorkflowTemplatePanelOpen}
          isAssetTrayOpen={isAssetTrayOpen}
        />
      )}

      <VelaWorkflowPanel
        isOpen={isWorkflowTemplatePanelOpen}
        nodes={nodes}
        groups={groups}
        onClose={() => setIsWorkflowTemplatePanelOpen(false)}
        onUse={handleUseWorkflowTemplate}
      />
      <VelaAssetTray
        isOpen={isAssetTrayOpen}
        assets={generatedAssets}
        onClose={() => setIsAssetTrayOpen(false)}
        onInsert={(asset) => {
          handleSelectAsset(asset.type === 'video' ? 'videos' : 'images', asset.url, asset.prompt || '素材盘素材', asset.model);
          setIsAssetTrayOpen(false);
        }}
      />

      {/* Canvas */}
      <div
        ref={canvasRef}
        id="canvas-background"
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        onPointerDownCapture={handleCanvasPointerDownCapture}
        onPointerDown={handlePointerDown}
        onPointerMove={handleGlobalPointerMove}
        onPointerUpCapture={handleGlobalPointerUp}
        onPointerUp={handleGlobalPointerUp}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleGlobalContextMenu}
        onDragEnter={handleCanvasDragEnter}
        onDragOver={handleCanvasDragOver}
        onDragLeave={handleCanvasDragLeave}
        onDrop={handleCanvasDrop}
      >
        {isCanvasFileDragActive && (
          <div className="vela-canvas-drop-zone" role="status" aria-live="polite">
            <strong>松开以上传到画布</strong>
            <span>支持图片和视频；将在当前鼠标位置创建素材节点</span>
          </div>
        )}
        {canvasUploadFeedback && (
          <div className="vela-canvas-feedback" role="status">
            <span>{canvasUploadFeedback}</span>
            <button type="button" onClick={() => setCanvasUploadFeedback(null)} aria-label="关闭提示">关闭</button>
          </div>
        )}
        {nodes.length === 0 && (
          <div className="vela-canvas-empty" role="status">
            <span className="vela-empty-kicker">VELA AI CANVAS</span>
            <strong>从一个想法开始</strong>
            <span>点击底部的“＋”添加节点，或把图片直接拖到画布。</span>
          </div>
        )}
        <div
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            transformOrigin: '0 0',
            width: '100%',
            height: '100%',
            pointerEvents: 'none'
          }}
        >
          {/* Background Grid */}
          <div
            className="absolute -top-[10000px] -left-[10000px] w-[20000px] h-[20000px]"
            style={{
              backgroundImage: canvasTheme === 'dark'
                ? 'radial-gradient(#666 1px, transparent 1px)'
                : 'radial-gradient(#dededb 0.8px, transparent 0.8px)',
              backgroundSize: '22px 22px',
              opacity: canvasTheme === 'dark' ? 0.5 : 0.48
            }}
          />

          {/* SVG Layer for Connections */}
          <svg className="absolute top-0 left-0 w-full h-full overflow-visible pointer-events-none z-0">
            <ConnectionsLayer
              nodes={nodes}
              viewport={viewport}
              canvasTheme={canvasTheme}
              isDraggingConnection={isDraggingConnection}
              connectionStart={connectionStart}
              tempConnectionEnd={tempConnectionEnd}
              selectedConnection={selectedConnection}
              onEdgeClick={handleEdgeClick}
            />
          </svg>

          {/* Nodes Layer */}
          <div className="pointer-events-auto">
            {nodes.map(node => (
              <CanvasNode
                key={node.id}
                data={node}
                profileName={velaProfiles.find((profile) => profile.id === node.profileId)?.name}
                profiles={velaProfiles}
                inputUrl={(() => {
                  // Get first parent's result for display (multiple inputs handled in generation)
                  if (!node.parentIds || node.parentIds.length === 0) return undefined;
                  const parent = nodes.find(n => n.id === node.parentIds![0]);

                  // VIDEO_EDITOR nodes need the actual video URL from parent Video node
                  if (node.type === NodeType.VIDEO_EDITOR && parent?.type === NodeType.VIDEO) {
                    return parent.resultUrl;
                  }

                  // For other nodes, if parent is video, use lastFrame for image preview
                  if (parent?.type === NodeType.VIDEO && parent.lastFrame) {
                    return parent.lastFrame;
                  }
                  return parent?.resultUrl;
                })()}
                connectedImageNodes={(() => {
                  // Gather all connected parent nodes (image or video) with their URLs
                  if (!node.parentIds || node.parentIds.length === 0) return [];
                  return node.parentIds
                    .map(parentId => nodes.find(n => n.id === parentId))
                    .filter(parent => parent && (parent.type === NodeType.IMAGE || parent.type === NodeType.VIDEO) && parent.resultUrl)
                    .map(parent => ({
                      id: parent!.id,
                      url: (parent!.type === NodeType.VIDEO ? parent!.lastFrame : parent!.resultUrl) || parent!.resultUrl!,
                      type: parent!.type
                    }));
                })()}
                onUpdate={updateNodeWithSync}
                onGenerate={handleVelaGenerate}
                onAddNext={handleAddNext}
                selected={selectedNodeIds.includes(node.id)}
                showControls={selectedNodeIds.length === 1 && selectedNodeIds.includes(node.id)}
                onNodePointerDown={(e) => {
                  // If shift is held, preserve selection for multi-drag/multi-select
                  if (e.shiftKey) {
                    if (selectedNodeIds.includes(node.id)) {
                      handleNodePointerDown(e, node.id, undefined);
                    } else {
                      // Add to selection
                      setSelectedNodeIds(prev => [...prev, node.id]);
                      handleNodePointerDown(e, node.id, undefined);
                    }
                  } else if (selectedNodeIds.length > 1 && selectedNodeIds.includes(node.id)) {
                    // Dragging any member of an existing multi-selection moves the
                    // entire selection and keeps the batch connector/group action visible.
                    handleNodePointerDown(e, node.id, undefined);
                  } else {
                    // No shift outside an existing multi-selection: select this node.
                    setSelectedNodeIds([node.id]);
                    handleNodePointerDown(e, node.id, undefined);
                  }
                }}
                onContextMenu={(event, id) => {
                  if (!selectedNodeIds.includes(id)) setSelectedNodeIds([id]);
                  handleNodeContextMenu(event, id);
                }}
                onSelect={(id) => setSelectedNodeIds([id])}
                onConnectorDown={handleConnectorPointerDown}
                isHoveredForConnection={connectionHoveredNodeId === node.id}
                connectionTargetState={connectionHoveredNodeId === node.id ? connectionTargetState : null}
                onOpenEditor={handleOpenEditor}
                onUpload={handleUpload}
                onRetryUpload={retryCanvasUpload}
                onExpand={handleExpandImage}
                onDragStart={handleNodeDragStart}
                onDragEnd={handleNodeDragEnd}
                onWriteContent={handleWriteContent}
                onTextToVideo={handleTextToVideo}
                onTextToImage={handleTextToImage}
                onImageToImage={handleImageToImage}
                onImageToVideo={handleImageToVideo}
                onChangeAngleGenerate={handleChangeAngleGenerate}
                zoom={viewport.zoom}
                onMouseEnter={() => setCanvasHoveredNodeId(node.id)}
                onMouseLeave={() => setCanvasHoveredNodeId(null)}
                canvasTheme={canvasTheme}
                onPostToX={handlePostToX}
                onPostToTikTok={handlePostToTikTok}
              />
            ))}
          </div>



          {/* Selection Bounding Box - for selected nodes (2 or more) */}
          {selectedNodeIds.length > 1 && !selectionBox.isActive && (
            <SelectionBoundingBox
              selectedNodes={nodes.filter(n => selectedNodeIds.includes(n.id))}
              group={getCommonGroup(selectedNodeIds)}
              viewport={viewport}
              onGroup={() => groupNodes(selectedNodeIds, setNodes)}
              onUngroup={() => {
                const group = getCommonGroup(selectedNodeIds);
                if (group) ungroupNodes(group.id, setNodes);
              }}
              onBoundingBoxPointerDown={(e) => {
                // Start dragging all selected nodes when clicking on bounding box
                e.stopPropagation();
                if (selectedNodeIds.length > 0) {
                  handleNodePointerDown(e, selectedNodeIds[0], undefined);
                }
              }}
              onBatchConnectorPointerDown={handleSelectionConnectorPointerDown}
            />
          )}

          {/* Group Bounding Boxes - for all groups (even when not selected) */}
          {groups.map(group => {
            const groupNodes = nodes.filter(n => n.groupId === group.id);

            // Don't render if group has less than 2 nodes
            if (groupNodes.length < 2) return null;

            const isSelected = groupNodes.every(n => selectedNodeIds.includes(n.id)) && groupNodes.length > 0;

            // Don't render if this group is already shown above (when selected)
            if (isSelected) return null;

            return (
              <SelectionBoundingBox
                key={group.id}
                selectedNodes={groupNodes}
                group={group}
                viewport={viewport}
                onGroup={() => { }} // Already grouped
                onUngroup={() => ungroupNodes(group.id, setNodes)}
                onBoundingBoxPointerDown={(e) => {
                  // Select all nodes in this group and start dragging
                  e.stopPropagation();
                  const nodeIds = groupNodes.map(n => n.id);
                  setSelectedNodeIds(nodeIds);
                  if (nodeIds.length > 0) {
                    handleNodePointerDown(e, nodeIds[0], undefined);
                  }
                }}
                showToolbar={false}
                onBatchConnectorPointerDown={handleSelectionConnectorPointerDown}
              />
            );
          })}
        </div>
      </div >

      {/* Selection Box Overlay - Outside transformed canvas for screen-space coordinates */}
      {selectionBox.isActive && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: Math.min(selectionBox.startX, selectionBox.endX),
            top: Math.min(selectionBox.startY, selectionBox.endY),
            width: Math.abs(selectionBox.endX - selectionBox.startX),
            height: Math.abs(selectionBox.endY - selectionBox.startY),
            border: '2px solid #3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            zIndex: 1000
          }}
        />
      )}

      <VelaMiniMap nodes={nodes} />
      <VelaTaskCenter
        isOpen={isTaskCenterOpen}
        jobs={velaJobs}
        profiles={velaProfiles}
        error={velaJobsError}
        onToggle={() => setIsTaskCenterOpen(current => !current)}
        onRetry={retryVelaJob}
        onCancel={cancelVelaJob}
      />
      {/* Context Menu */}
      <ContextMenu
        state={contextMenu}
        onClose={() => setContextMenu(prev => ({ ...prev, isOpen: false }))}
        onSelectType={handleContextMenuSelect}
        onSelectNodeKind={handleContextMenuSelectKind}
        onUpload={handleContextUpload}
        onUndo={undo}
        onRedo={redo}
        onPaste={handlePaste}
        onCopy={handleCopy}
        onDuplicate={handleDuplicate}
        onCreateAsset={handleContextMenuCreateAsset}
        onAddAssets={handleContextMenuAddAssets}
        canUndo={canUndo}
        canRedo={canRedo}
        canvasTheme={canvasTheme}
      />

      {!storyboardGenerator.isModalOpen && !isTikTokModalOpen && (
        <div className="vela-zoom-control" >
          <span>缩放</span>
          <input
            type="range"
            min="0.1"
            max="2"
            step="0.1"
            value={viewport.zoom}
            onChange={handleSliderZoom}
            className="vela-zoom-slider"
          />
          <span className="vela-zoom-value">{Math.round(viewport.zoom * 100)}%</span>
        </div>
      )}

      <ImageEditorModal
        isOpen={editorModal.isOpen}
        nodeId={editorModal.nodeId || ''}
        imageUrl={editorModal.imageUrl}
        initialPrompt={nodes.find(n => n.id === editorModal.nodeId)?.prompt}
        initialModel={nodes.find(n => n.id === editorModal.nodeId)?.imageModel || 'gemini-pro'}
        initialAspectRatio={nodes.find(n => n.id === editorModal.nodeId)?.aspectRatio || 'Auto'}
        initialResolution={nodes.find(n => n.id === editorModal.nodeId)?.resolution || '1K'}
        initialElements={nodes.find(n => n.id === editorModal.nodeId)?.editorElements as any}
        initialCanvasData={nodes.find(n => n.id === editorModal.nodeId)?.editorCanvasData}
        initialCanvasSize={nodes.find(n => n.id === editorModal.nodeId)?.editorCanvasSize}
        initialBackgroundUrl={nodes.find(n => n.id === editorModal.nodeId)?.editorBackgroundUrl}
        onClose={handleCloseImageEditor}
        onGenerate={async (sourceId, prompt, count) => {
          handleCloseImageEditor();

          const sourceNode = nodes.find(n => n.id === sourceId);
          if (!sourceNode) return;

          // Get settings from source node (which were updated by the modal)
          const imageModel = sourceNode.imageModel || 'gemini-pro';
          const aspectRatio = sourceNode.aspectRatio || 'Auto';
          const resolution = sourceNode.resolution || '1K';

          const startX = sourceNode.x + 360; // Source width + gap
          const startY = sourceNode.y;

          const newNodes: NodeData[] = [];

          const yStep = 500;
          const totalHeight = (count - 1) * yStep;
          const startYOffset = -totalHeight / 2;

          // Create N nodes with inherited settings
          for (let i = 0; i < count; i++) {
            newNodes.push({
              id: crypto.randomUUID(),
              type: NodeType.IMAGE,
              x: startX,
              y: startY + startYOffset + (i * yStep),
              prompt: prompt,
              status: NodeStatus.LOADING,
              model: 'Banana Pro',
              imageModel: imageModel,
              aspectRatio: aspectRatio,
              resolution: resolution,
              parentIds: [sourceId]
            });
          }

          // Add new nodes and edges immediately
          // Note: State updates might be batched
          setNodes(prev => [...prev, ...newNodes]);

          // Convert editor image to base64 for generation reference
          let imageBase64: string | undefined = undefined;
          if (editorModal.imageUrl) {
            imageBase64 = await urlToBase64(editorModal.imageUrl);
          }

          newNodes.forEach(async (node) => {
            try {
              const resultUrl = await generateImage({
                prompt: node.prompt || '',
                imageBase64: imageBase64,
                imageModel: imageModel,
                aspectRatio: aspectRatio,
                resolution: resolution
              });
              updateNode(node.id, { status: NodeStatus.SUCCESS, resultUrl });
            } catch (error: any) {
              updateNode(node.id, { status: NodeStatus.ERROR, errorMessage: error.message });
            }
          });
        }}
        onUpdate={updateNode}
      />

      {/* Storyboard Video Generation Modal */}
      <StoryboardVideoModal
        isOpen={storyboardVideoModal.isOpen}
        onClose={() => setStoryboardVideoModal(prev => ({ ...prev, isOpen: false }))}
        scenes={storyboardVideoModal.nodes}
        storyContext={storyboardVideoModal.storyContext}
        onCreateVideos={handleGenerateStoryVideos}
      />

      {/* Video Editor Modal */}
      <VideoEditorModal
        isOpen={videoEditorModal.isOpen}
        nodeId={videoEditorModal.nodeId}
        videoUrl={videoEditorModal.videoUrl}
        initialTrimStart={nodes.find(n => n.id === videoEditorModal.nodeId)?.trimStart}
        initialTrimEnd={nodes.find(n => n.id === videoEditorModal.nodeId)?.trimEnd}
        onClose={handleCloseVideoEditor}
        onExport={handleExportTrimmedVideo}
      />

      {/* Fullscreen Media Preview Modal */}
      <ExpandedMediaModal
        mediaUrl={expandedImageUrl}
        onClose={handleCloseExpand}
      />
    </div >
  );
}
