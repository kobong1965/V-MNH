/**
 * useNodeManagement.ts
 * 
 * Custom hook for managing node state and operations.
 * Handles node creation, updates, selection, and deletion.
 */

import { useState } from 'react';
import { NodeData, NodeType, NodeStatus, Viewport } from '../types';
import {
    canConnectNodeKinds,
    getDefaultNodeTitle,
    getNodeDefinition,
    type VelaNodeKind
} from '../vela/nodeCatalog';

export const useNodeManagement = () => {
    // ============================================================================
    // STATE
    // ============================================================================

    const [nodes, setNodes] = useState<NodeData[]>([]);
    const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);

    // ============================================================================
    // NODE OPERATIONS
    // ============================================================================

    /**
     * Adds a new node to the canvas
     * @param type - Type of node to create
     * @param x - Screen X coordinate
     * @param y - Screen Y coordinate
     * @param parentId - Optional parent node ID for connections
     * @param viewport - Current viewport for coordinate conversion
     */
    const addNode = (
        type: NodeType,
        x: number,
        y: number,
        parentId: string | undefined,
        viewport: Viewport,
        kind?: VelaNodeKind
    ) => {
        const canvasX = (x - viewport.x) / viewport.zoom;
        const canvasY = (y - viewport.y) / viewport.zoom;

        const nodeSize = (nodeKind?: VelaNodeKind) => ({
            width: nodeKind && ['prompt', 'gpt-prompt-optimizer', 'video-director', 'competitor-script-analyzer'].includes(nodeKind) ? 520 : 656,
            height: 370
        });
        const size = nodeSize(kind);
        let nextX = parentId ? canvasX : canvasX - size.width / 2;
        let nextY = parentId ? canvasY : canvasY - size.height / 2;

        if (!parentId) {
            for (let attempt = 0; attempt < 12; attempt += 1) {
                const collision = nodes.find((node) => {
                    const existing = nodeSize(node.kind);
                    return nextX < node.x + existing.width + 70
                        && nextX + size.width + 70 > node.x
                        && nextY < node.y + existing.height + 70
                        && nextY + size.height + 70 > node.y;
                });
                if (!collision) break;
                const existing = nodeSize(collision.kind);
                nextX = collision.x + existing.width + 90;
                nextY = collision.y;
            }
        }

        const newNode: NodeData = {
            id: crypto.randomUUID(),
            type,
            kind,
            title: kind ? getDefaultNodeTitle(kind) : undefined,
            x: nextX,
            y: nextY,
            prompt: '',
            status: NodeStatus.IDLE,
            model: 'Banana Pro',
            aspectRatio: kind === 'gpt-video' ? '16:9' : kind === 'h3-video' ? '9:16' : kind === 'gpt-image' ? '1:1' : 'Auto',
            resolution: kind === 'gpt-video' ? '720p' : kind === 'h3-video' ? '1080p' : kind === 'gpt-image' ? '2K' : 'Auto',
            parentIds: parentId ? [parentId] : [],
            outputCount: 1,
            imageModel: kind === 'gpt-image' ? 'gpt-image-1.5' : undefined,
            videoModel: kind === 'gpt-video' ? 'seedance-2.5-720p' : kind === 'h3-video' ? 'h3-comfy' : undefined,
            videoDuration: kind === 'gpt-video' ? 5 : undefined,
            videoGenerationMode: kind === 'gpt-video' ? 'text-to-video' : undefined
        };

        if (kind === 'video-director') {
            newNode.directorPresetId = 'vn-grounded';
            newNode.sourceBrief = '';
            newNode.analysisFrameCount = 8;
        }
        if (kind === 'competitor-script-analyzer') {
            newNode.sourceBrief = '';
            newNode.analysisFrameCount = 8;
        }

        if (type === NodeType.TEXT && (!kind || ['prompt', 'gpt-prompt-optimizer', 'video-director', 'competitor-script-analyzer'].includes(kind))) {
            newNode.textMode = 'menu';
        }

        setNodes(prev => [...prev, newNode]);
        setSelectedNodeIds([newNode.id]);

        return newNode.id;
    };

    /**
     * Updates a node with partial data
     * @param id - Node ID to update
     * @param updates - Partial node data to merge
     */
    const updateNode = (id: string, updates: Partial<NodeData>) => {
        setNodes(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
    };

    /**
     * Deletes a node by ID
     * @param id - Node ID to delete
     */
    const deleteNode = (id: string) => {
        setNodes(prev => prev.filter(n => n.id !== id));
        setSelectedNodeIds(prev => prev.filter(nodeId => nodeId !== id));
    };

    /**
     * Deletes multiple nodes by IDs
     * @param ids - Array of node IDs to delete
     */
    const deleteNodes = (ids: string[]) => {
        setNodes(prev => prev.filter(n => !ids.includes(n.id)));
        setSelectedNodeIds([]);
    };

    /**
     * Clears all node selections
     */
    const clearSelection = () => {
        setSelectedNodeIds([]);
    };

    /**
     * Handles node type selection from context menu
     * Creates new node or deletes existing node
     */
    const handleSelectTypeFromMenu = (
        type: NodeType | 'DELETE',
        contextMenu: any,
        viewport: Viewport,
        onCloseMenu: () => void,
        kind?: VelaNodeKind
    ) => {
        // Handle Delete Action
        if (type === 'DELETE') {
            if (contextMenu.sourceNodeId) {
                deleteNode(contextMenu.sourceNodeId);
            }
            onCloseMenu();
            return;
        }

        if (contextMenu.type === 'node-connector' && contextMenu.sourceNodeId) {
            const sourceNode = nodes.find(n => n.id === contextMenu.sourceNodeId);
            if (sourceNode) {
                const direction = contextMenu.connectorSide || 'right';
                const requestedSourceIds: string[] = contextMenu.sourceNodeIds?.length
                    ? contextMenu.sourceNodeIds
                    : [contextMenu.sourceNodeId];
                const sourceNodes = requestedSourceIds
                    .map((id) => nodes.find((node) => node.id === id))
                    .filter((node): node is NodeData => Boolean(node));
                if (kind) {
                    const compatible = direction === 'right'
                        ? sourceNodes.some((candidate) => !candidate.kind || canConnectNodeKinds(candidate.kind, kind))
                        : !sourceNode.kind || canConnectNodeKinds(kind, sourceNode.kind);
                    if (!compatible) {
                        onCloseMenu();
                        return;
                    }
                }
                const newNodeId = crypto.randomUUID();
                const GAP = 90;
                const sourceWidth = sourceNode.kind && ['prompt', 'gpt-prompt-optimizer', 'video-director', 'competitor-script-analyzer'].includes(sourceNode.kind) ? 520 : 656;
                const targetWidth = kind && ['prompt', 'gpt-prompt-optimizer', 'video-director', 'competitor-script-analyzer'].includes(kind) ? 520 : 656;
                const hasDropPoint = Number.isFinite(contextMenu.dropX) && Number.isFinite(contextMenu.dropY);
                const droppedX = hasDropPoint ? (contextMenu.dropX - viewport.x) / viewport.zoom - targetWidth / 2 : null;
                const droppedY = hasDropPoint ? (contextMenu.dropY - viewport.y) / viewport.zoom - 185 : null;

                let newNode: NodeData;

                if (direction === 'right') {
                    const compatibleParentIds = sourceNodes
                        .filter((candidate) => !candidate.kind || !kind || canConnectNodeKinds(candidate.kind, kind))
                        .map((candidate) => candidate.id);
                    // Append: Source -> New
                    newNode = {
                        id: newNodeId,
                        type,
                        kind,
                        title: kind ? getDefaultNodeTitle(kind) : undefined,
                        x: droppedX ?? sourceNode.x + sourceWidth + GAP,
                        y: droppedY ?? sourceNode.y,
                        prompt: '',
                        status: NodeStatus.IDLE,
                        model: 'Banana Pro',
                        aspectRatio: kind === 'gpt-video' ? '16:9' : kind === 'h3-video' ? '9:16' : kind === 'gpt-image' ? '1:1' : 'Auto',
                        resolution: kind === 'gpt-video' ? '720p' : kind === 'h3-video' ? '1080p' : kind === 'gpt-image' ? '2K' : 'Auto',
                        parentIds: [...new Set(compatibleParentIds)],
                        outputCount: 1,
                        imageModel: kind === 'gpt-image' ? 'gpt-image-1.5' : undefined,
                        videoModel: kind === 'gpt-video' ? 'seedance-2.5-720p' : kind === 'h3-video' ? 'h3-comfy' : undefined,
                        videoDuration: kind === 'gpt-video' ? 5 : undefined,
                        videoGenerationMode: kind === 'gpt-video' ? 'text-to-video' : undefined
                    };
                    if (kind === 'video-director') {
                        newNode.directorPresetId = 'vn-grounded';
                        newNode.sourceBrief = '';
                        newNode.analysisFrameCount = 8;
                    }
                    if (kind === 'competitor-script-analyzer') {
                        newNode.sourceBrief = '';
                        newNode.analysisFrameCount = 8;
                    }
                } else {
                    // Prepend: New -> Source
                    newNode = {
                        id: newNodeId,
                        type,
                        kind,
                        title: kind ? getDefaultNodeTitle(kind) : undefined,
                        x: droppedX ?? sourceNode.x - targetWidth - GAP,
                        y: droppedY ?? sourceNode.y,
                        prompt: '',
                        status: NodeStatus.IDLE,
                        model: 'Banana Pro',
                        aspectRatio: kind === 'gpt-video' ? '16:9' : kind === 'h3-video' ? '9:16' : kind === 'gpt-image' ? '1:1' : 'Auto',
                        resolution: kind === 'gpt-video' ? '720p' : kind === 'h3-video' ? '1080p' : kind === 'gpt-image' ? '2K' : 'Auto',
                        parentIds: [],
                        outputCount: 1,
                        imageModel: kind === 'gpt-image' ? 'gpt-image-1.5' : undefined,
                        videoModel: kind === 'gpt-video' ? 'seedance-2.5-720p' : kind === 'h3-video' ? 'h3-comfy' : undefined,
                        videoDuration: kind === 'gpt-video' ? 5 : undefined,
                        videoGenerationMode: kind === 'gpt-video' ? 'text-to-video' : undefined
                    };
                    if (kind === 'video-director') {
                        newNode.directorPresetId = 'vn-grounded';
                        newNode.sourceBrief = '';
                        newNode.analysisFrameCount = 8;
                    }
                    if (kind === 'competitor-script-analyzer') {
                        newNode.sourceBrief = '';
                        newNode.analysisFrameCount = 8;
                    }
                    // Update source to add new node as parent
                    const existingParentIds = sourceNode.parentIds || [];
                    updateNode(contextMenu.sourceNodeId, { parentIds: [...existingParentIds, newNodeId] });
                }

                setNodes(prev => [...prev, newNode]);
                setSelectedNodeIds([newNodeId]);
            }
        } else {
            // Global menu - add at click position
            const isToolbarAdd = contextMenu.sourceNodeId === '__toolbar_add__';
            const toolbarYRatio = kind && !['prompt', 'gpt-prompt-optimizer', 'video-director', 'competitor-script-analyzer'].includes(kind) ? 0.405 : 0.39;
            addNode(
                type,
                isToolbarAdd ? window.innerWidth / 2 : contextMenu.x,
                isToolbarAdd ? window.innerHeight * toolbarYRatio : contextMenu.y,
                undefined,
                viewport,
                kind
            );
        }

        onCloseMenu();
    };

    const handleSelectKindFromMenu = (
        kind: VelaNodeKind,
        contextMenu: any,
        viewport: Viewport,
        onCloseMenu: () => void
    ) => {
        const definition = getNodeDefinition(kind);
        handleSelectTypeFromMenu(
            definition.legacyType as NodeType,
            contextMenu,
            viewport,
            onCloseMenu,
            kind
        );
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
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
    };
};
