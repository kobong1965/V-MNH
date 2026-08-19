/**
 * NodeContent.tsx
 * 
 * Displays the content area of a canvas node.
 * Handles result display (image/video) and placeholder states.
 */

import React, { useRef, useState, useEffect } from 'react';
import { Check, CircleAlert, Loader2, Maximize2, ImageIcon as ImageIcon, Film, Upload, Video, GripVertical, Download, Expand, Shrink, HardDrive, FileText, Music2, WandSparkles } from 'lucide-react';
import { NodeData, NodeStatus, NodeType } from '../../types';
import { getCanvasNodeHeight, isResizableTextNode } from '../../utils/nodeGeometry';

interface NodeContentProps {
    data: NodeData;
    inputUrl?: string;
    selected: boolean;
    isIdle: boolean;
    isLoading: boolean;
    isSuccess: boolean;
    getAspectRatioStyle: () => { aspectRatio: string };
    onUpload?: (nodeId: string, mediaDataUrl: string) => void;
    onRetryUpload?: (nodeId: string) => void;
    onExpand?: (imageUrl: string) => void;
    onDragStart?: (nodeId: string, hasContent: boolean) => void;
    onDragEnd?: () => void;
    // Text node callbacks
    onTextToVideo?: (nodeId: string) => void;
    onTextToImage?: (nodeId: string) => void;
    // Image node callbacks
    onImageToImage?: (nodeId: string) => void;
    onImageToVideo?: (nodeId: string) => void;
    onUpdate?: (nodeId: string, updates: Partial<NodeData>) => void;
    resultSelectionMode?: boolean;
    selectedResultIndexes?: number[];
    onToggleResultSelection?: (index: number) => void;
    // Social sharing
    onPostToX?: (nodeId: string, mediaUrl: string, mediaType: 'image' | 'video') => void;
}

export const NodeContent: React.FC<NodeContentProps> = ({
    data,
    inputUrl,
    selected,
    isIdle,
    isLoading,
    isSuccess,
    getAspectRatioStyle,
    onUpload,
    onRetryUpload,
    onExpand,
    onDragStart,
    onDragEnd,
    onTextToVideo,
    onTextToImage,
    onImageToImage,
    onImageToVideo,
    onUpdate,
    onPostToX,
    resultSelectionMode = false,
    selectedResultIndexes = [],
    onToggleResultSelection
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Local state for text node textarea to prevent lag
    const [localPrompt, setLocalPrompt] = useState(data.prompt || '');
    const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastSentPromptRef = useRef<string | undefined>(data.prompt); // Track what we sent

    // Helper: Check if node is image-type (includes local image model)
    const isImageType = data.type === NodeType.IMAGE || data.type === NodeType.LOCAL_IMAGE_MODEL;
    // Helper: Check if node is video-type (includes local video model)
    const isVideoType = data.type === NodeType.VIDEO || data.type === NodeType.LOCAL_VIDEO_MODEL;
    // Helper: Check if node is local model
    const isLocalModel = data.type === NodeType.LOCAL_IMAGE_MODEL || data.type === NodeType.LOCAL_VIDEO_MODEL;
    const resultUrls = data.resultUrls?.filter(Boolean).length
        ? data.resultUrls.filter(Boolean)
        : data.resultUrl
            ? [data.resultUrl]
            : [];
    const hasResultCollection = isImageType && resultUrls.length > 1;
    const isResultCollectionExpanded = hasResultCollection && Boolean(data.resultCollectionExpanded);
    const resizableTextHeight = isResizableTextNode(data) ? getCanvasNodeHeight(data) : undefined;
    const isTextEditing = isResizableTextNode(data) && data.textMode === 'editing';
    const isGeneratedTextKind = ['gpt-prompt-optimizer', 'video-director', 'competitor-script-analyzer'].includes(data.kind || '');

    // Sync local state ONLY when data.prompt changes externally (not from our own update)
    useEffect(() => {
        if (data.prompt !== lastSentPromptRef.current) {
            setLocalPrompt(data.prompt || '');
            lastSentPromptRef.current = data.prompt;
        }
    }, [data.prompt]);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (updateTimeoutRef.current) {
                clearTimeout(updateTimeoutRef.current);
            }
        };
    }, []);

    const handleTextChange = (value: string) => {
        setLocalPrompt(value); // Update local state immediately
        lastSentPromptRef.current = value; // Track that we're about to send this

        // Debounce parent update
        if (updateTimeoutRef.current) {
            clearTimeout(updateTimeoutRef.current);
        }
        updateTimeoutRef.current = setTimeout(() => {
            onUpdate?.(data.id, { prompt: value });
        }, 150);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !onUpload) return;

        const reader = new FileReader();
        reader.onloadend = () => {
            onUpload(data.id, reader.result as string);
        };
        reader.readAsDataURL(file);
    };

    return (
        <div className={`vela-node-content-frame vela-node-elevation ${selected ? 'is-selected' : ''} relative transition-all duration-200 ${data.kind ? 'p-0 rounded-2xl overflow-visible' : !selected ? 'p-0 rounded-2xl overflow-hidden' : 'p-1'}`}>
            {/* Hidden File Input - rendered for explicit image/video material nodes. */}
            {['image-input', 'video-input'].includes(data.kind || '') && onUpload && (
                <input
                    ref={fileInputRef}
                    type="file"
                    accept={data.kind === 'video-input' ? 'video/*' : 'image/*'}
                    className="hidden"
                    onChange={handleFileChange}
                />
            )}

            {/* Result View - Show when successful OR when regenerating (loading with existing content) */}
            {(isSuccess || isLoading) && data.resultUrl ? (
                hasResultCollection ? (
                    <div
                        className={`vela-result-collection ${isResultCollectionExpanded ? 'is-expanded' : 'is-stacked'}`}
                        data-testid="vela-result-collection"
                        data-count={resultUrls.length}
                    >
                        {isResultCollectionExpanded ? (
                            <div
                                className="vela-result-collection__grid"
                                style={{ gridTemplateColumns: `repeat(${resultUrls.length}, minmax(0, 1fr))` }}
                            >
                                {resultUrls.map((url, index) => (
                                    <button
                                        type="button"
                                        className={`vela-result-collection__item ${resultSelectionMode ? 'is-download-selecting' : ''} ${selectedResultIndexes.includes(index) ? 'is-download-selected' : ''}`}
                                        key={`${url}-${index}`}
                                        style={getAspectRatioStyle()}
                                        onPointerDown={(event) => event.stopPropagation()}
                                        onClick={() => resultSelectionMode ? onToggleResultSelection?.(index) : onExpand?.(url)}
                                        aria-pressed={resultSelectionMode ? selectedResultIndexes.includes(index) : undefined}
                                        aria-label={resultSelectionMode
                                            ? `${selectedResultIndexes.includes(index) ? '取消选择' : '选择'}第 ${index + 1} 张图片`
                                            : `查看第 ${index + 1} 张图片大图`}
                                    >
                                        <img src={url} alt={`生成结果 ${index + 1}`} draggable={false} />
                                        <span className="vela-result-collection__index">{index + 1}</span>
                                        {resultSelectionMode && (
                                            <span className="vela-result-collection__select-indicator" aria-hidden="true">
                                                {selectedResultIndexes.includes(index) && <Check size={16} strokeWidth={3} />}
                                            </span>
                                        )}
                                    </button>
                                ))}
                                {!resultSelectionMode && <button
                                    type="button"
                                    className="vela-result-collection__toggle is-collapse"
                                    aria-expanded="true"
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onUpdate?.(data.id, { resultCollectionExpanded: false });
                                    }}
                                >
                                    <Shrink size={15} aria-hidden="true" />
                                    收起
                                </button>}
                            </div>
                        ) : (
                            <>
                                <div className="vela-result-collection__layers" aria-hidden="true">
                                    {resultUrls.slice(1, 4).reverse().map((url, reverseIndex, layers) => {
                                        const depth = layers.length - reverseIndex;
                                        return (
                                            <div
                                                className="vela-result-collection__layer"
                                                key={`${url}-layer`}
                                                style={{ transform: `translate(${depth * 9}px, ${depth * 7}px)` }}
                                            >
                                                <img src={url} alt="" draggable={false} />
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="vela-result-collection__primary" style={getAspectRatioStyle()}>
                                    <img src={resultUrls[0]} alt="生成结果 1" draggable={false} />
                                </div>
                                <button
                                    type="button"
                                    className="vela-result-collection__toggle"
                                    aria-expanded="false"
                                    aria-label={`展开查看 ${resultUrls.length} 张图片`}
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onUpdate?.(data.id, { resultCollectionExpanded: true });
                                    }}
                                >
                                    <Maximize2 size={15} aria-hidden="true" />
                                    {resultUrls.length}张
                                </button>
                            </>
                        )}
                    </div>
                ) : (
                <div
                    className={`relative w-full bg-black group/image ${!selected ? '' : 'rounded-xl overflow-hidden'}`}
                    style={getAspectRatioStyle()}
                >
                    {isVideoType && !(data.kind === 'h3-video' && data.resultUrl.includes('vela-fake-h3-')) ? (
                        <video src={data.resultUrl} controls loop className="w-full h-full object-cover" />
                    ) : (
                        <img src={data.resultUrl} alt={data.kind === 'h3-video' ? 'H3 假视频预览' : '生成结果'} className="w-full h-full object-cover pointer-events-none" />
                    )}

                </div>
                )
            ) : data.kind ? (
                <div
                    className={`vela-node-content ${selected ? 'is-selected' : ''}`}
                    style={resizableTextHeight ? { height: `${resizableTextHeight}px`, minHeight: `${resizableTextHeight}px` } : undefined}
                >
                    {(data.kind === 'prompt' || isGeneratedTextKind) ? (
                        <div
                            className={`vela-prompt-content ${isTextEditing ? 'is-editing' : 'is-viewing'}`}
                            onDoubleClick={(event) => {
                                if (isTextEditing) return;
                                if ((event.target as HTMLElement).closest('button, input, textarea, select')) return;
                                event.preventDefault();
                                event.stopPropagation();
                                onUpdate?.(data.id, { textMode: 'editing' });
                            }}
                            title={isTextEditing ? undefined : '双击编辑文字'}
                        >
                            {isTextEditing ? (
                                <textarea
                                    value={localPrompt}
                                    onChange={(event) => handleTextChange(event.target.value)}
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onWheel={(event) => event.stopPropagation()}
                                    onBlur={() => {
                                        if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
                                        onUpdate?.(data.id, {
                                            ...(localPrompt !== data.prompt ? { prompt: localPrompt } : {}),
                                            textMode: 'menu'
                                        });
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Escape') {
                                            event.preventDefault();
                                            event.currentTarget.blur();
                                        }
                                    }}
                                    placeholder={data.kind === 'prompt' ? '写下你想生成的画面、动作和镜头…' : data.kind === 'video-director' ? '生成后在这里查看或修改编导脚本…' : data.kind === 'competitor-script-analyzer' ? '生成后在这里查看竞品拆解与原创脚本…' : '连接提示词后，在这里查看或修改优化结果…'}
                                    aria-label={data.kind === 'prompt' ? '提示词内容' : data.kind === 'video-director' ? '视频编导脚本' : data.kind === 'competitor-script-analyzer' ? '竞品视频分析结果' : '优化后的提示词'}
                                    autoFocus
                                />
                            ) : localPrompt ? (
                                <div className="vela-prompt-content__view" aria-label={data.kind === 'prompt' ? '提示词内容' : data.kind === 'video-director' ? '视频编导脚本' : data.kind === 'competitor-script-analyzer' ? '竞品视频分析结果' : '优化后的提示词'}>
                                    {localPrompt}
                                </div>
                            ) : (
                                <>
                                    <FileText className="vela-node-hero-icon" size={54} strokeWidth={1.5} aria-hidden="true" />
                                    <div className="vela-node-suggestions">
                                        <span>{data.kind === 'video-director' ? '连接产品图，在下方选择编导人设并生成脚本。' : data.kind === 'competitor-script-analyzer' ? '连接一条对标视频和产品图，使用 Qwen 生成原创方案。' : '双击节点输入文字，或尝试：'}</span>
                                        {data.kind !== 'video-director' && data.kind !== 'competitor-script-analyzer' && <>
                                            <button type="button" onClick={() => onTextToVideo?.(data.id)}><Video size={16} />文生视频</button>
                                            <button type="button" onClick={() => onTextToImage?.(data.id)}><ImageIcon size={16} />图片反推提示词</button>
                                            <button type="button"><Music2 size={16} />文字生音乐</button>
                                        </>}
                                    </div>
                                </>
                            )}
                        </div>
                    ) : data.kind === 'image-input' || data.kind === 'video-input' ? (
                        <div
                            className="vela-node-content__upload"
                            role="button"
                            tabIndex={0}
                            aria-label={data.kind === 'video-input' ? '双击选择参考视频' : '双击选择参考图片'}
                            title={data.kind === 'video-input' ? '单击拖动节点，双击选择参考视频' : '单击拖动节点，双击选择参考图片'}
                            onDoubleClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                fileInputRef.current?.click();
                            }}
                            onKeyDown={(event) => {
                                if (event.key !== 'Enter' && event.key !== ' ') return;
                                event.preventDefault();
                                event.stopPropagation();
                                fileInputRef.current?.click();
                            }}
                        >
                            {isLoading ? <Loader2 className="vela-spin" size={24} aria-hidden="true" /> : <Upload size={22} aria-hidden="true" />}
                            {isLoading && <span>上传进度 {data.uploadProgress ?? 0}%</span>}
                            <strong>{data.kind === 'video-input' ? '双击选择参考视频' : '双击选择参考图片'}</strong>
                            <span>{data.kind === 'video-input' ? '单击拖动节点 · 支持 MP4、WebM、MOV' : '单击拖动节点 · 支持 JPG、PNG、WebP'}</span>
                        </div>
                    ) : (
                        <div className="vela-node-content__placeholder">
                            {['gpt-video', 'h3-video', 'wan-video-process'].includes(data.kind) ? <Film className="vela-node-hero-icon" size={56} strokeWidth={1.5} aria-hidden="true" /> : <ImageIcon className="vela-node-hero-icon" size={56} strokeWidth={1.5} aria-hidden="true" />}
                            <div className="vela-node-suggestions">
                                <span>尝试：</span>
                                <button type="button"><WandSparkles size={16} />{data.kind === 'wan-video-process' ? '保留动作替换' : ['gpt-video', 'h3-video'].includes(data.kind) ? '图生视频' : '图生图'}</button>
                                <button type="button"><Maximize2 size={16} />{data.kind === 'wan-video-process' ? 'Wan 后端工作流' : data.kind === 'gpt-video' ? '文生视频' : data.kind === 'h3-video' ? '首尾帧视频' : '图片高清'}</button>
                            </div>
                        </div>
                    )}
                </div>
            ) : data.type === NodeType.TEXT ? (
                /* Text Node - Menu or Editing Mode */
                <div
                    className={`relative w-full h-full bg-[#1a1a1a] rounded-2xl overflow-hidden ${selected ? 'ring-1 ring-blue-500/30' : ''}`}
                    style={resizableTextHeight ? { minHeight: `${resizableTextHeight}px` } : undefined}
                    onDoubleClick={(event) => {
                        if (isTextEditing) return;
                        if ((event.target as HTMLElement).closest('button, input, textarea, select')) return;
                        event.preventDefault();
                        event.stopPropagation();
                        onUpdate?.(data.id, { textMode: 'editing' });
                    }}
                    title={isTextEditing ? undefined : '双击编辑文字'}
                >
                    {isTextEditing ? (
                        /* Editing Mode - Text Area */
                        <div className="p-4 h-full flex flex-col">
                            <textarea
                                value={localPrompt}
                                onChange={(e) => handleTextChange(e.target.value)}
                                onPointerDown={(e) => e.stopPropagation()}
                                onWheel={(e) => e.stopPropagation()}
                                onBlur={() => {
                                    // Ensure final value is saved on blur
                                    if (updateTimeoutRef.current) {
                                        clearTimeout(updateTimeoutRef.current);
                                    }
                                    onUpdate?.(data.id, {
                                        ...(localPrompt !== data.prompt ? { prompt: localPrompt } : {}),
                                        textMode: 'menu'
                                    });
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === 'Escape') {
                                        event.preventDefault();
                                        event.currentTarget.blur();
                                    }
                                }}
                                placeholder="Write your text content here..."
                                className="w-full bg-transparent text-white text-sm resize-none outline-none placeholder:text-neutral-600"
                                style={{ minHeight: 0, flex: 1 }}
                                autoFocus
                            />
                            {/* Expand/Shrink Button */}
                            <div className="flex justify-end mt-2">
                                <button
                                    onClick={() => onUpdate?.(data.id, { isPromptExpanded: !data.isPromptExpanded })}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-neutral-500 hover:text-white hover:bg-neutral-700 rounded transition-colors"
                                    title={data.isPromptExpanded ? 'Shrink text area' : 'Expand text area'}
                                >
                                    {data.isPromptExpanded ? <Shrink size={12} /> : <Expand size={12} />}
                                    <span>{data.isPromptExpanded ? 'Shrink' : 'Expand'}</span>
                                </button>
                            </div>
                        </div>
                    ) : localPrompt ? (
                        <div className="h-full overflow-auto whitespace-pre-wrap p-4 text-sm leading-relaxed text-white">
                            {localPrompt}
                        </div>
                    ) : (
                        /* Menu Mode - Show Options */
                        <div className="p-5 flex flex-col gap-4">
                            {/* Header */}
                            <div className="text-neutral-500 text-sm font-medium">
                                Try to:
                            </div>

                            {/* Menu Options */}
                            <div className="flex flex-col gap-1">
                                <div className="px-3 py-2 text-sm text-neutral-300">双击节点编写文字</div>
                                <TextNodeMenuItem
                                    icon={<Video size={16} />}
                                    label="Text to Video"
                                    onClick={() => onTextToVideo?.(data.id)}
                                />
                                <TextNodeMenuItem
                                    icon={<ImageIcon size={16} />}
                                    label="Text to Image"
                                    onClick={() => onTextToImage?.(data.id)}
                                />
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                /* Placeholder / Empty State for Image/Video */
                <div className={`relative w-full aspect-[4/3] bg-[#141414] flex flex-col items-center justify-center gap-3 overflow-hidden
            ${isLoading ? 'animate-pulse' : ''} 
            ${!selected ? 'rounded-2xl' : 'rounded-xl border border-dashed border-neutral-800'}`
                }>
                    {/* Input Image Preview for Video Nodes */}
                    {isVideoType && inputUrl && (
                        <div className="absolute inset-0 z-0">
                            <img src={inputUrl} alt="Input Frame" className="w-full h-full object-cover opacity-30 blur-sm" />
                            <div className="absolute inset-0 bg-black/40" />
                            <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 rounded text-[10px] text-white font-medium flex items-center gap-1">
                                <ImageIcon size={10} />
                                Input Frame
                            </div>
                        </div>
                    )}

                    {isLoading ? (
                        <div className="relative z-10 flex flex-col items-center gap-2">
                            <Loader2 size={32} className="animate-spin text-blue-400" />
                            <span className="text-xs text-neutral-500 font-medium">Generating...</span>
                        </div>
                    ) : (
                        <div className="relative z-10 flex flex-col items-center gap-3">
                            {/* Upload Button for Image Nodes (including local image models) */}
                            {isImageType && onUpload && (
                                <>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handleFileChange}
                                    />
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        className="flex items-center gap-2 px-4 py-2 bg-neutral-800/80 hover:bg-neutral-700 rounded-lg text-white text-sm font-medium transition-colors"
                                    >
                                        <Upload size={16} />
                                        Upload
                                    </button>
                                </>
                            )}

                            <div className="text-neutral-700">
                                {isVideoType ? (
                                    isLocalModel ? <><Film size={40} /><HardDrive size={16} className="absolute -bottom-1 -right-1 text-purple-400" /></> : <Film size={40} />
                                ) : (
                                    isLocalModel ? <><ImageIcon size={40} /><HardDrive size={16} className="absolute -bottom-1 -right-1 text-purple-400" /></> : <ImageIcon size={40} />
                                )}
                            </div>
                            {selected && (
                                <>
                                    <div className="text-neutral-500 text-sm font-medium">
                                        {isVideoType && inputUrl
                                            ? "Ready to animate"
                                            : isVideoType
                                                ? "Waiting for input..."
                                                : isLocalModel
                                                    ? "Select a model and enter prompt"
                                                    : "Try to:"
                                        }
                                    </div>
                                    {!isVideoType && !isLocalModel && (
                                        <div className="flex flex-col gap-1 w-full px-2">
                                            <TextNodeMenuItem
                                                icon={<ImageIcon size={16} />}
                                                label="Image to Image"
                                                onClick={() => onImageToImage?.(data.id)}
                                            />
                                            <TextNodeMenuItem
                                                icon={<Film size={16} />}
                                                label="Image to Video"
                                                onClick={() => onImageToVideo?.(data.id)}
                                            />
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
            <NodeStatusOverlay data={data} onRetryUpload={onRetryUpload} />
        </div>
    );
};

const NodeStatusOverlay: React.FC<{
    data: NodeData;
    onRetryUpload?: (nodeId: string) => void;
}> = ({ data, onRetryUpload }) => {
    const isLoading = data.status === NodeStatus.LOADING;
    const isError = data.status === NodeStatus.ERROR;
    if (!isLoading && !isError) return null;

    const isUpload = data.uploadSource === 'canvas-drop';
    const rawProgress = isUpload ? data.uploadProgress : data.generationProgress;
    const progress = rawProgress === undefined
        ? undefined
        : Math.max(0, Math.min(100, Math.round(rawProgress)));

    if (isError) {
        const cancelled = data.errorMessage === '任务已取消。';
        return (
            <div className="vela-node-status-overlay" data-status="error" role="alert">
                <div className="vela-node-status-card vela-node-status-card--error">
                    <span className="vela-node-status-title">
                        <CircleAlert size={16} aria-hidden="true" />
                        <strong>{cancelled ? '制作已取消' : isUpload ? '上传失败' : '制作失败'}</strong>
                    </span>
                    <span className="vela-node-status-reason">{data.errorMessage || '生成失败，请重试。'}</span>
                    {isUpload && onRetryUpload && (
                        <button type="button" onClick={() => onRetryUpload(data.id)}>重新上传</button>
                    )}
                </div>
            </div>
        );
    }

    const label = isUpload ? '正在上传' : '正在制作';
    return (
        <div className="vela-node-status-overlay" data-status="loading" role="status" aria-live="polite">
            <div className="vela-node-status-card">
                <span className="vela-node-status-title">
                    <Loader2 className="vela-spin" size={15} aria-hidden="true" />
                    <strong>{label}{progress === undefined ? '…' : ` ${progress}%`}</strong>
                </span>
                {progress !== undefined && (
                    <span
                        className="vela-node-progress-track"
                        role="progressbar"
                        aria-label={`${label}进度`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={progress}
                    >
                        <span style={{ width: `${progress}%` }} />
                    </span>
                )}
            </div>
        </div>
    );
};

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

interface TextNodeMenuItemProps {
    icon: React.ReactNode;
    label: string;
    onClick?: () => void;
}

/**
 * Menu item component for Text node options
 */
const TextNodeMenuItem: React.FC<TextNodeMenuItemProps> = ({ icon, label, onClick }) => (
    <button
        className="flex items-center gap-3 w-full p-2.5 rounded-lg text-left text-neutral-400 hover:bg-[#252525] hover:text-white transition-colors"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onClick}
    >
        <span className="text-neutral-500">{icon}</span>
        <span className="text-sm font-medium">{label}</span>
    </button>
);
