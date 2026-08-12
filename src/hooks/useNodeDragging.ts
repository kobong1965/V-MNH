/**
 * useNodeDragging.ts
 * 
 * Custom hook for managing node dragging functionality.
 * Handles pointer events for dragging nodes around the canvas.
 */

import React, { useRef, useState } from 'react';
import { NodeData, Viewport } from '../types';

interface DragNode {
    id: string;
    lastClientX: number;
    lastClientY: number;
}

export const useNodeDragging = () => {
    // ============================================================================
    // STATE
    // ============================================================================

    const dragNodeRef = useRef<DragNode | null>(null);
    const isPanning = useRef<boolean>(false);
    const [isDragging, setIsDragging] = useState<boolean>(false);

    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================

    /**
     * Starts node dragging
     * @param e - Pointer event
     * @param id - Node ID to drag
     * @param onSelect - Callback to select the node
     */
    const handleNodePointerDown = (
        e: React.PointerEvent,
        id: string,
        onSelect?: (id: string) => void
    ) => {
        // Node/material dragging is a primary-button interaction only.
        // The middle button is reserved globally for canvas panning.
        if (e.button !== 0) return;
        e.stopPropagation();
        dragNodeRef.current = {
            id,
            lastClientX: e.clientX,
            lastClientY: e.clientY
        };
        setIsDragging(true);

        // Select the node
        if (onSelect) {
            onSelect(id);
        }

        if (e.target instanceof HTMLElement) {
            e.target.setPointerCapture(e.pointerId);
        }
    };

    /**
     * Updates node position during drag
     * Returns true if node was dragged, false otherwise
     */
    const updateNodeDrag = (
        e: React.PointerEvent,
        viewport: Viewport,
        onUpdateNodes: (updater: (prev: NodeData[]) => NodeData[]) => void,
        selectedNodeIds: string[] = []
    ): boolean => {
        if (!dragNodeRef.current) return false;

        const dragNode = dragNodeRef.current;
        const nodeId = dragNode.id;
        const clientDx = e.clientX - dragNode.lastClientX;
        const clientDy = e.clientY - dragNode.lastClientY;

        dragNode.lastClientX = e.clientX;
        dragNode.lastClientY = e.clientY;

        if (clientDx === 0 && clientDy === 0) return true;

        const zoomAdjustedDx = clientDx / viewport.zoom;
        const zoomAdjustedDy = clientDy / viewport.zoom;

        // If dragging a selected node, move all selected nodes
        const nodesToMove = selectedNodeIds.includes(nodeId) && selectedNodeIds.length > 1
            ? selectedNodeIds
            : [nodeId];

        onUpdateNodes(prev => prev.map(n => {
            if (nodesToMove.includes(n.id)) {
                return { ...n, x: n.x + zoomAdjustedDx, y: n.y + zoomAdjustedDy };
            }
            return n;
        }));

        return true;
    };

    /**
     * Ends node dragging
     */
    const endNodeDrag = () => {
        dragNodeRef.current = null;
        setIsDragging(false);
    };

    /**
     * Starts canvas panning
     */
    const startPanning = (e: React.PointerEvent) => {
        isPanning.current = true;
        if (e.currentTarget instanceof HTMLElement) {
            e.currentTarget.setPointerCapture(e.pointerId);
        } else if (e.target instanceof HTMLElement) {
            e.target.setPointerCapture(e.pointerId);
        }
    };

    /**
     * Updates canvas pan position
     * Returns true if panning, false otherwise
     */
    const updatePanning = (
        e: React.PointerEvent,
        onUpdateViewport: (updater: (prev: Viewport) => Viewport) => void
    ): boolean => {
        if (!isPanning.current) return false;

        onUpdateViewport(prev => ({
            ...prev,
            x: prev.x + e.movementX,
            y: prev.y + e.movementY
        }));

        return true;
    };

    /**
     * Ends canvas panning
     */
    const endPanning = (): boolean => {
        const wasPanning = isPanning.current;
        isPanning.current = false;
        return wasPanning;
    };

    /**
     * Releases pointer capture
     */
    const releasePointerCapture = (e: React.PointerEvent) => {
        const captureTarget = e.currentTarget instanceof HTMLElement
            ? e.currentTarget
            : e.target instanceof HTMLElement ? e.target : null;
        if (captureTarget?.hasPointerCapture(e.pointerId)) {
            try {
                captureTarget.releasePointerCapture(e.pointerId);
            } catch (err) {
                // Ignore errors
            }
        }
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        handleNodePointerDown,
        updateNodeDrag,
        endNodeDrag,
        startPanning,
        updatePanning,
        endPanning,
        isDragging,
        isPanning: isPanning.current,
        releasePointerCapture
    };
};
