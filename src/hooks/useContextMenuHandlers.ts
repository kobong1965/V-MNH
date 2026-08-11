/**
 * useContextMenuHandlers.ts
 * 
 * Handles context menu operations: double-click, right-click,
 * node context menu, toolbar add button.
 */

import React, { useCallback } from 'react';
import { NodeData, NodeType, ContextMenuState, Viewport } from '../types';
import type { VelaNodeKind } from '../vela/nodeCatalog';

interface UseContextMenuHandlersOptions {
    nodes: NodeData[];
    viewport: Viewport;
    contextMenu: ContextMenuState;
    setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
    handleOpenCreateAsset: (nodeId: string) => void;
    handleSelectTypeFromMenu: (
        type: NodeType | 'DELETE',
        contextMenu: ContextMenuState,
        viewport: Viewport,
        closeMenu: () => void
    ) => void;
    handleSelectKindFromMenu: (
        kind: VelaNodeKind,
        contextMenu: ContextMenuState,
        viewport: Viewport,
        closeMenu: () => void
    ) => void;
}

export const useContextMenuHandlers = ({
    nodes,
    viewport,
    contextMenu,
    setContextMenu,
    handleOpenCreateAsset,
    handleSelectTypeFromMenu,
    handleSelectKindFromMenu
}: UseContextMenuHandlersOptions) => {
    // ============================================================================
    // DOUBLE-CLICK & RIGHT-CLICK
    // ============================================================================

    const handleDoubleClick = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).id === 'canvas-background') {
            setContextMenu({
                isOpen: true,
                x: e.clientX,
                y: e.clientY,
                type: 'add-nodes'
            });
        }
    }, [setContextMenu]);

    const handleGlobalContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        if ((e.target as HTMLElement).id === 'canvas-background') {
            setContextMenu({
                isOpen: true,
                x: e.clientX,
                y: e.clientY,
                type: 'global'
            });
        }
    }, [setContextMenu]);

    // ============================================================================
    // NODE OPERATIONS
    // ============================================================================

    const handleAddNext = useCallback((nodeId: string, direction: 'left' | 'right', point?: { x: number; y: number }, nodeIds?: string[]) => {
        const sourceNode = nodes.find(n => n.id === nodeId);
        if (!sourceNode) return;

        const sourceWidth = sourceNode.kind && ['prompt', 'gpt-prompt-optimizer'].includes(sourceNode.kind) ? 370 : 656;
        const anchor = point || {
            x: (sourceNode.x + (direction === 'right' ? sourceWidth : 0)) * viewport.zoom + viewport.x,
            y: (sourceNode.y + 185) * viewport.zoom + viewport.y
        };
        const menuX = Math.max(12, Math.min(window.innerWidth - 250, anchor.x));
        const menuY = Math.max(72, Math.min(window.innerHeight - 560, anchor.y));

        setContextMenu({
            isOpen: true,
            x: menuX,
            y: menuY,
            type: 'node-connector',
            sourceNodeId: nodeId,
            sourceNodeIds: nodeIds,
            sourceNodeKind: sourceNode.kind,
            connectorSide: direction,
            dropX: point?.x,
            dropY: point?.y
        });
    }, [nodes, setContextMenu, viewport]);

    const handleNodeContextMenu = useCallback((e: React.MouseEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();

        const node = nodes.find(n => n.id === id);
        if (!node) return;

        setContextMenu({
            isOpen: true,
            x: e.clientX,
            y: e.clientY,
            type: 'node-options',
            sourceNodeId: id
        });
    }, [nodes, setContextMenu]);

    // ============================================================================
    // CONTEXT MENU ACTIONS
    // ============================================================================

    const handleContextMenuCreateAsset = useCallback(() => {
        if (contextMenu.sourceNodeId) {
            handleOpenCreateAsset(contextMenu.sourceNodeId);
        }
    }, [contextMenu.sourceNodeId, handleOpenCreateAsset]);

    const handleContextMenuSelect = useCallback((type: NodeType | 'DELETE') => {
        handleSelectTypeFromMenu(
            type,
            contextMenu,
            viewport,
            () => setContextMenu(prev => ({ ...prev, isOpen: false }))
        );
    }, [handleSelectTypeFromMenu, contextMenu, viewport, setContextMenu]);

    const handleContextMenuSelectKind = useCallback((kind: VelaNodeKind) => {
        handleSelectKindFromMenu(
            kind,
            contextMenu,
            viewport,
            () => setContextMenu(prev => ({ ...prev, isOpen: false }))
        );
    }, [handleSelectKindFromMenu, contextMenu, viewport, setContextMenu]);

    const handleToolbarAdd = useCallback((e: React.MouseEvent) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setContextMenu({
            isOpen: true,
            x: Math.max(18, rect.left - 8),
            y: Math.max(76, rect.top - 540),
            type: 'add-nodes',
            sourceNodeId: '__toolbar_add__'
        });
    }, [setContextMenu]);

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        handleDoubleClick,
        handleGlobalContextMenu,
        handleAddNext,
        handleNodeContextMenu,
        handleContextMenuCreateAsset,
        handleContextMenuSelect,
        handleContextMenuSelectKind,
        handleToolbarAdd
    };
};
