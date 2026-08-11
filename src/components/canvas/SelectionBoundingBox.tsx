/**
 * SelectionBoundingBox.tsx
 * 
 * Renders a bounding box around selected nodes with resize handles.
 * Shows "Group" button for multi-selection and group toolbar when grouped.
 */

import React, { useState } from 'react';
import { NodeData, NodeGroup, NodeType } from '../../types';
import { Boxes, Download, Plus, Ungroup } from 'lucide-react';
import { getCanvasNodeBounds } from '../../utils/nodeGeometry';

interface SelectionBoundingBoxProps {
    selectedNodes: NodeData[];
    group?: NodeGroup;
    viewport: { x: number; y: number; zoom: number };
    onGroup: () => void;
    onUngroup: () => void;
    onBoundingBoxPointerDown: (e: React.PointerEvent) => void;
    showToolbar?: boolean;
    onBatchConnectorPointerDown?: (
        event: React.PointerEvent,
        nodeIds: string[],
        origin: { x: number; y: number }
    ) => void;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the width of a node based on its type
 * @param node - The node to calculate width for
 * @param allNodes - All nodes in the selection (to find parent for Editor nodes)
 */
const getNodeWidth = (node: NodeData, allNodes?: NodeData[]): number => {
    // Image Editor with input from parent: width depends on parent's aspect ratio
    if (node.type === NodeType.IMAGE_EDITOR) {
        // Find parent node in the selection
        const parentId = node.parentIds?.[0];
        const parentNode = parentId && allNodes?.find(n => n.id === parentId);
        if (parentNode?.resultUrl && parentNode?.resultAspectRatio) {
            const parts = parentNode.resultAspectRatio.split('/');
            if (parts.length === 2) {
                const aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
                // For portrait images: height=500px, width=500*aspectRatio
                // For landscape images: width is capped at 500px
                if (aspectRatio < 1) {
                    return 500 * aspectRatio;
                } else {
                    return 500;
                }
            }
        }
        // Empty: width 340px
        return 340;
    }

    // Video Editor with input: uses 16:9 aspect ratio with maxWidth 500px
    if (node.type === NodeType.VIDEO_EDITOR) {
        // Find parent node in the selection
        const parentId = node.parentIds?.[0];
        const parentNode = parentId && allNodes?.find(n => n.id === parentId);
        if (parentNode?.resultUrl) {
            return 500;
        }
        // Empty: width 340px
        return 340;
    }

    if (node.type === NodeType.VIDEO) return 385;
    return 365;
};

/**
 * Estimate the height of a node based on its type and aspect ratio.
 * This accounts for the content area + any controls/padding.
 * @param node - The node to calculate height for
 * @param allNodes - All nodes in the selection (to find parent for Editor nodes)
 */
const getNodeHeight = (node: NodeData, allNodes?: NodeData[]): number => {
    const baseWidth = getNodeWidth(node, allNodes);

    // Handle Image Editor nodes
    if (node.type === NodeType.IMAGE_EDITOR) {
        // Find parent node in the selection
        const parentId = node.parentIds?.[0];
        const parentNode = parentId && allNodes?.find(n => n.id === parentId);
        if (parentNode?.resultUrl && parentNode?.resultAspectRatio) {
            const parts = parentNode.resultAspectRatio.split('/');
            if (parts.length === 2) {
                const aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
                // For portrait: height = 500px
                // For landscape: height = 500 / aspectRatio
                if (aspectRatio < 1) {
                    return 500;
                } else {
                    return 500 / aspectRatio;
                }
            }
        }
        // Empty: minHeight 380px
        return 380;
    }

    // Handle Video Editor nodes
    if (node.type === NodeType.VIDEO_EDITOR) {
        // Find parent node in the selection
        const parentId = node.parentIds?.[0];
        const parentNode = parentId && allNodes?.find(n => n.id === parentId);
        if (parentNode?.resultUrl) {
            // Video editor shows 16:9 when has content
            return 500 / (16 / 9);
        }
        // Empty: minHeight 380px
        return 380;
    }

    // Parse aspect ratio to calculate content height for Image/Video nodes
    let aspectRatio = 16 / 9; // Default

    // First priority: use resultAspectRatio if available (actual generated content dimensions)
    if (node.resultAspectRatio) {
        const parts = node.resultAspectRatio.split('/');
        if (parts.length === 2) {
            aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
        }
    } else if (node.aspectRatio && node.aspectRatio !== 'Auto') {
        // Use selected aspect ratio
        const parts = node.aspectRatio.split(':');
        if (parts.length === 2) {
            aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
        }
    } else {
        // Empty/placeholder state: Both Image and Video use 4/3
        aspectRatio = 4 / 3;
    }

    // Calculate content height from aspect ratio
    return baseWidth / aspectRatio;
};

export const SelectionBoundingBox: React.FC<SelectionBoundingBoxProps> = ({
    selectedNodes,
    group,
    viewport,
    onGroup,
    onUngroup,
    onBoundingBoxPointerDown,
    showToolbar = true,
    onBatchConnectorPointerDown
}) => {
    // ============================================================================
    // STATE
    // ============================================================================

    const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'done'>('idle');
    // ============================================================================
    // CALCULATIONS
    // ============================================================================

    // Don't render for 0 nodes or single nodes (unless it's a group)
    if (selectedNodes.length === 0) return null;
    if (selectedNodes.length === 1 && !group) return null;

    // Calculate bounding box from all selected nodes with proper dimensions
    const PADDING_X = 50; // Horizontal padding (accounts for + connectors on sides)
    const PADDING_TOP = 30; // Top padding for node titles
    const PADDING_BOTTOM = 50; // Bottom padding for controls

    const minX = Math.min(...selectedNodes.map(n => n.x)) - PADDING_X;
    const minY = Math.min(...selectedNodes.map(n => n.y)) - PADDING_TOP;
    const maxX = Math.max(...selectedNodes.map(n => getCanvasNodeBounds(n, selectedNodes).right)) + PADDING_X;
    const maxY = Math.max(...selectedNodes.map(n => getCanvasNodeBounds(n, selectedNodes).bottom)) + PADDING_BOTTOM;

    const width = maxX - minX;
    const height = maxY - minY;

    const isGrouped = !!group;

    // Calculate scale factor for UI elements - clamp to prevent elements from getting too large
    // At zoom 1.0: scale = 1.0 (normal size)
    // At zoom 0.5: scale = 1.5 (max clamped, instead of 2.0)
    // At zoom 2.0: scale = 0.5 (smaller)
    const uiScale = 1 / viewport.zoom;

    const downloadableImages = selectedNodes.filter((node) =>
        node.type === NodeType.IMAGE && Boolean(node.resultUrl)
    );

    const downloadSelectedImages = async () => {
        if (downloadStatus === 'downloading' || downloadableImages.length === 0) return;
        setDownloadStatus('downloading');

        for (let index = 0; index < downloadableImages.length; index += 1) {
            const node = downloadableImages[index];
            const sourceUrl = node.resultUrl!;
            const cleanUrl = sourceUrl.split('?')[0];
            let objectUrl: string | null = null;
            try {
                const response = await fetch(cleanUrl, { cache: 'no-store' });
                if (!response.ok) throw new Error(`Download failed: ${response.status}`);
                const blob = await response.blob();
                objectUrl = URL.createObjectURL(blob);
                const extension = blob.type.includes('jpeg')
                    ? 'jpg'
                    : blob.type.includes('webp')
                        ? 'webp'
                        : 'png';
                const link = document.createElement('a');
                link.href = objectUrl;
                link.download = `V-MNH_框选图片_${String(index + 1).padStart(2, '0')}_${node.id.slice(0, 8)}.${extension}`;
                document.body.appendChild(link);
                link.click();
                link.remove();
            } catch {
                const link = document.createElement('a');
                link.href = cleanUrl;
                link.download = `V-MNH_框选图片_${String(index + 1).padStart(2, '0')}.png`;
                link.target = '_blank';
                link.rel = 'noreferrer';
                document.body.appendChild(link);
                link.click();
                link.remove();
            } finally {
                if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl!), 1000);
            }
        }

        setDownloadStatus('done');
        window.setTimeout(() => setDownloadStatus('idle'), 1800);
    };

    // ============================================================================
    // RENDER
    // ============================================================================

    return (
        <div
            className="absolute pointer-events-auto cursor-move"
            style={{
                left: minX,
                top: minY,
                width,
                height,
                border: isGrouped ? '2px solid #4b5563' : '2px dashed #6b7280',
                borderRadius: '12px',
                backgroundColor: isGrouped ? 'rgba(55, 65, 81, 0.34)' : 'transparent',
                zIndex: 5
            }}
            onPointerDown={(e) => {
                // Only trigger group drag if clicking on the bounding box itself, not its children
                if (e.target === e.currentTarget) {
                    onBoundingBoxPointerDown(e);
                }
            }}
        >
            {onBatchConnectorPointerDown && (
                <button
                    type="button"
                    className="vela-selection-connector"
                    aria-label={`将选中的 ${selectedNodes.length} 个节点批量连接到目标节点`}
                    title="拖动以批量连接"
                    style={{ transform: `translate(50%, -50%) scale(${uiScale})` }}
                    onPointerDown={(event) => onBatchConnectorPointerDown(
                        event,
                        selectedNodes.map((node) => node.id),
                        { x: maxX, y: minY + height / 2 }
                    )}
                >
                    <Plus size={14} aria-hidden="true" />
                </button>
            )}

            {/* Resize Handles */}
            {[
                { pos: 'top-left', cursor: 'nw-resize', top: -4, left: -4 },
                { pos: 'top', cursor: 'n-resize', top: -4, left: '50%', transform: 'translateX(-50%)' },
                { pos: 'top-right', cursor: 'ne-resize', top: -4, right: -4 },
                { pos: 'right', cursor: 'e-resize', top: '50%', right: -4, transform: 'translateY(-50%)' },
                { pos: 'bottom-right', cursor: 'se-resize', bottom: -4, right: -4 },
                { pos: 'bottom', cursor: 's-resize', bottom: -4, left: '50%', transform: 'translateX(-50%)' },
                { pos: 'bottom-left', cursor: 'sw-resize', bottom: -4, left: -4 },
                { pos: 'left', cursor: 'w-resize', top: '50%', left: -4, transform: 'translateY(-50%)' }
            ].map(handle => (
                <div
                    key={handle.pos}
                    className="absolute w-2 h-2 bg-white border border-neutral-500 rounded-sm pointer-events-auto"
                    style={{
                        top: handle.top,
                        left: handle.left,
                        right: handle.right,
                        bottom: handle.bottom,
                        transform: handle.transform,
                        cursor: handle.cursor
                    }}
                />
            ))}

            {/* Multi-selection actions. Hidden for groups that are not currently selected. */}
            {showToolbar && (
                <div
                    className="absolute flex gap-2 pointer-events-auto"
                    style={{
                        top: -10,
                        left: '50%',
                        transform: `translateX(-50%) scale(${uiScale}) translateY(-100%)`,
                        transformOrigin: 'bottom center'
                    }}
                    role="toolbar"
                    aria-label="框选节点操作"
                >
                    <button
                        type="button"
                        onClick={isGrouped ? onUngroup : onGroup}
                        className="bg-white border border-neutral-300 hover:bg-neutral-50 text-neutral-900 text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm whitespace-nowrap"
                    >
                        {isGrouped ? <Ungroup size={16} aria-hidden="true" /> : <Boxes size={16} aria-hidden="true" />}
                        {isGrouped ? '取消打组' : '打组'}
                    </button>
                    <button
                        type="button"
                        onClick={() => void downloadSelectedImages()}
                        disabled={downloadableImages.length === 0 || downloadStatus === 'downloading'}
                        className="bg-white border border-neutral-300 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-45 text-neutral-900 text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm whitespace-nowrap"
                        aria-label={`下载框选中的 ${downloadableImages.length} 张图片`}
                    >
                        <Download size={16} aria-hidden="true" />
                        {downloadStatus === 'downloading'
                            ? '正在下载…'
                            : downloadStatus === 'done'
                                ? '下载完成'
                                : `下载框选图片（${downloadableImages.length}）`}
                    </button>
                </div>
            )}
        </div>
    );
};
