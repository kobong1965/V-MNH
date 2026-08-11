/**
 * useConnectionDragging.ts
 * 
 * Custom hook for managing connection dragging between nodes.
 * Handles drag-to-connect functionality with visual feedback.
 */

import React, { useState, useRef } from 'react';
import { NodeData, NodeType, Viewport } from '../types';
import { canConnectNodeKinds } from '../vela/nodeCatalog';
import { getCanvasNodeBounds } from '../utils/nodeGeometry';

interface ConnectionStart {
    nodeId: string;
    nodeIds?: string[];
    handle: 'left' | 'right';
    origin?: { x: number; y: number };
}

type ConnectionTargetState = 'compatible' | 'incompatible' | null;

const canConnect = (parentNode: NodeData, childNode: NodeData): boolean => {
    if (parentNode.kind && childNode.kind) return canConnectNodeKinds(parentNode.kind, childNode.kind);
    if (parentNode.type === NodeType.AUDIO || childNode.type === NodeType.AUDIO) return false;
    if (childNode.type === NodeType.TEXT) return false;
    if (parentNode.type === NodeType.TEXT) return childNode.type === NodeType.IMAGE || childNode.type === NodeType.VIDEO;
    if (parentNode.type === NodeType.VIDEO) return childNode.type === NodeType.VIDEO || childNode.type === NodeType.VIDEO_EDITOR;
    if (parentNode.type === NodeType.IMAGE || parentNode.type === NodeType.IMAGE_EDITOR) {
        return childNode.type === NodeType.IMAGE || childNode.type === NodeType.VIDEO || childNode.type === NodeType.IMAGE_EDITOR;
    }
    if (parentNode.type === NodeType.VIDEO_EDITOR) return childNode.type === NodeType.VIDEO;
    return true;
};

export const useConnectionDragging = () => {
    // ============================================================================
    // STATE
    // ============================================================================

    const [isDraggingConnection, setIsDraggingConnection] = useState(false);
    const [connectionStart, setConnectionStart] = useState<ConnectionStart | null>(null);
    const [tempConnectionEnd, setTempConnectionEnd] = useState<{ x: number; y: number } | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [hoveredSide, setHoveredSide] = useState<'left' | 'right' | null>(null);
    const [connectionTargetState, setConnectionTargetState] = useState<ConnectionTargetState>(null);
    const [selectedConnection, setSelectedConnection] = useState<{ parentId: string; childId: string } | null>(null);
    const dragStartTime = useRef<number>(0);
    // React state is used for rendering, while refs keep a pointer interaction
    // reliable even when a quick drag ends before React commits its state.
    const isDraggingConnectionRef = useRef(false);
    const connectionStartRef = useRef<ConnectionStart | null>(null);
    const hoveredNodeIdRef = useRef<string | null>(null);
    const hoveredSideRef = useRef<'left' | 'right' | null>(null);
    const connectionTargetStateRef = useRef<ConnectionTargetState>(null);

    // ============================================================================
    // HELPERS
    // ============================================================================

    /**
     * Checks if mouse is hovering over a node (for connection target)
     * Also determines which side (left or right connector) is being hovered
     * @param mouseX - Screen X coordinate
     * @param mouseY - Screen Y coordinate
     * @param nodes - Array of all nodes
     * @param viewport - Current viewport
     */
    const checkHoveredNode = (
        mouseX: number,
        mouseY: number,
        nodes: NodeData[],
        viewport: Viewport
    ) => {
        const canvasX = (mouseX - viewport.x) / viewport.zoom;
        const canvasY = (mouseY - viewport.y) / viewport.zoom;

        const activeConnectionStart = connectionStartRef.current;
        const found = nodes.find(n => {
            if (activeConnectionStart?.nodeIds?.includes(n.id) || n.id === activeConnectionStart?.nodeId) return false;
            const bounds = getCanvasNodeBounds(n, nodes);
            // Ports sit slightly outside the card. Include that hit area so
            // dropping exactly on a visible connector is accepted.
            const portHitArea = 28;
            return (
                canvasX >= n.x - portHitArea && canvasX <= n.x + bounds.width + portHitArea &&
                canvasY >= n.y && canvasY <= n.y + bounds.height
            );
        });

        if (found) {
            hoveredNodeIdRef.current = found.id;
            setHoveredNodeId(found.id);

            const bounds = getCanvasNodeBounds(found, nodes);
            const side = canvasX < found.x + bounds.width / 2 ? 'left' : 'right';
            hoveredSideRef.current = side;
            setHoveredSide(side);

            const sourceIds = activeConnectionStart?.nodeIds || (activeConnectionStart ? [activeConnectionStart.nodeId] : []);
            const sources = sourceIds.map((id) => nodes.find((node) => node.id === id)).filter((node): node is NodeData => Boolean(node));
            const isBatch = Boolean(activeConnectionStart?.nodeIds?.length);
            const usesOppositePorts = sources.length > 0 && activeConnectionStart?.handle !== side;
            const targetState = isBatch
                ? usesOppositePorts && activeConnectionStart?.handle === 'right' && side === 'left' && sources.every((source) => canConnect(source, found))
                    ? 'compatible'
                    : 'incompatible'
                : (() => {
                    const source = sources[0];
                    const parent = activeConnectionStart?.handle === 'right' ? source : found;
                    const child = activeConnectionStart?.handle === 'right' ? found : source;
                    return usesOppositePorts && parent && child && canConnect(parent, child) ? 'compatible' : 'incompatible';
                })();
            connectionTargetStateRef.current = targetState;
            setConnectionTargetState(targetState);
        } else {
            hoveredNodeIdRef.current = null;
            hoveredSideRef.current = null;
            connectionTargetStateRef.current = null;
            setHoveredNodeId(null);
            setHoveredSide(null);
            setConnectionTargetState(null);
        }
    };

    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================

    /**
     * Starts connection dragging from a connector button
     */
    const handleConnectorPointerDown = (
        e: React.PointerEvent,
        nodeId: string,
        side: 'left' | 'right'
    ) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        dragStartTime.current = Date.now();
        const start = { nodeId, handle: side } as const;
        isDraggingConnectionRef.current = true;
        connectionStartRef.current = start;
        hoveredNodeIdRef.current = null;
        hoveredSideRef.current = null;
        connectionTargetStateRef.current = null;
        setIsDraggingConnection(true);
        setConnectionStart(start);
        setTempConnectionEnd({ x: e.clientX, y: e.clientY });
        setConnectionTargetState(null);
        if (e.currentTarget instanceof HTMLElement) e.currentTarget.setPointerCapture(e.pointerId);
    };

    const handleSelectionConnectorPointerDown = (
        e: React.PointerEvent,
        nodeIds: string[],
        origin: { x: number; y: number }
    ) => {
        if (e.button !== 0 || nodeIds.length === 0) return;
        e.stopPropagation();
        e.preventDefault();
        dragStartTime.current = Date.now();
        const start: ConnectionStart = { nodeId: nodeIds[0], nodeIds: [...nodeIds], handle: 'right', origin };
        isDraggingConnectionRef.current = true;
        connectionStartRef.current = start;
        hoveredNodeIdRef.current = null;
        hoveredSideRef.current = null;
        connectionTargetStateRef.current = null;
        setIsDraggingConnection(true);
        setConnectionStart(start);
        setTempConnectionEnd({ x: e.clientX, y: e.clientY });
        setConnectionTargetState(null);
        if (e.currentTarget instanceof HTMLElement) e.currentTarget.setPointerCapture(e.pointerId);
    };

    /**
     * Updates temporary connection end point during drag
     */
    const updateConnectionDrag = (
        e: React.PointerEvent,
        nodes: NodeData[],
        viewport: Viewport
    ) => {
        if (!isDraggingConnectionRef.current) return false;

        setTempConnectionEnd({ x: e.clientX, y: e.clientY });
        checkHoveredNode(e.clientX, e.clientY, nodes, viewport);
        return true;
    };

    /**
     * Completes connection drag and creates connection if valid
     * Returns true if connection was handled, false otherwise
     * @param nodes - All nodes for validation
     * @param onConnectionMade - Optional callback called with (parentId, childId) when connection is created
     */
    const completeConnectionDrag = (
        onAddNext: (nodeId: string, direction: 'left' | 'right', point?: { x: number; y: number }, nodeIds?: string[]) => void,
        onUpdateNodes: (updater: (prev: NodeData[]) => NodeData[]) => void,
        nodes: NodeData[],
        onConnectionMade?: (parentId: string, childId: string) => void,
        dropPoint?: { x: number; y: number }
    ): boolean => {
        const activeConnectionStart = connectionStartRef.current;
        const activeHoveredNodeId = hoveredNodeIdRef.current;
        const activeHoveredSide = hoveredSideRef.current;
        const activeTargetState = connectionTargetStateRef.current;
        if (!isDraggingConnectionRef.current || !activeConnectionStart) return false;

        const dragDuration = Date.now() - dragStartTime.current;

        /**
         * Check if a connection is valid based on node types
         * Rules:
         * - IMAGE → IMAGE, VIDEO, IMAGE_EDITOR: ✅ (image as input)
         * - VIDEO → VIDEO: ✅ (video chaining via lastFrame)
         * - VIDEO → IMAGE, IMAGE_EDITOR: ❌ (can't generate image from video)
         * - TEXT → IMAGE, VIDEO: ✅ (text provides prompt)
         * - TEXT → TEXT, IMAGE_EDITOR: ❌ (no text chaining, no text editing)
         * - Any → TEXT: ❌ (text nodes can't receive input)
         * - AUDIO: ❌ (not supported yet)
         */
        const isValidConnection = (parentId: string, childId: string): boolean => {
            const parentNode = nodes.find(n => n.id === parentId);
            const childNode = nodes.find(n => n.id === childId);

            if (!parentNode || !childNode) return false;

            if (parentNode.kind && childNode.kind) {
                return canConnectNodeKinds(parentNode.kind, childNode.kind);
            }

            // AUDIO nodes not supported yet
            if (parentNode.type === NodeType.AUDIO || childNode.type === NodeType.AUDIO) {
                return false;
            }

            // STORYBOARD nodes - allow connections to/from for now (future feature)
            // Can be restricted later when storyboard logic is implemented

            // TEXT nodes can't receive input (can only be parents)
            if (childNode.type === NodeType.TEXT) {
                return false;
            }

            // TEXT nodes can only connect to IMAGE or VIDEO (to provide prompts)
            if (parentNode.type === NodeType.TEXT) {
                return childNode.type === NodeType.IMAGE || childNode.type === NodeType.VIDEO;
            }

            // VIDEO nodes can only connect to other VIDEO nodes (via lastFrame)
            // Cannot connect to IMAGE or IMAGE_EDITOR
            if (parentNode.type === NodeType.VIDEO) {
                return childNode.type === NodeType.VIDEO ||
                    childNode.type === NodeType.VIDEO_EDITOR;
            }

            // IMAGE nodes can connect to IMAGE, VIDEO, or IMAGE_EDITOR
            if (parentNode.type === NodeType.IMAGE) {
                return childNode.type === NodeType.IMAGE ||
                    childNode.type === NodeType.VIDEO ||
                    childNode.type === NodeType.IMAGE_EDITOR;
            }

            // IMAGE_EDITOR can connect to IMAGE, VIDEO, or IMAGE_EDITOR
            if (parentNode.type === NodeType.IMAGE_EDITOR) {
                return childNode.type === NodeType.IMAGE ||
                    childNode.type === NodeType.VIDEO ||
                    childNode.type === NodeType.IMAGE_EDITOR;
            }

            // VIDEO_EDITOR can only connect to VIDEO (to feed trimmed video for generation)
            // No chaining VIDEO_EDITOR → VIDEO_EDITOR
            if (parentNode.type === NodeType.VIDEO_EDITOR) {
                return childNode.type === NodeType.VIDEO;
            }

            return true;
        };

        // Clicking a connector or dragging it onto blank canvas both open the compatible-node menu.
        // A batch connector carries every selected source into the menu so the newly
        // created node can receive all compatible parents in one action.
        if (!activeHoveredNodeId) {
            onAddNext(
                activeConnectionStart.nodeId,
                activeConnectionStart.handle,
                dragDuration >= 200 ? dropPoint : undefined,
                activeConnectionStart.nodeIds
            );
        }
        // Drag to node - create connection based on target side
        else if (activeHoveredNodeId && activeHoveredSide && activeTargetState === 'compatible') {
            if (activeConnectionStart.nodeIds?.length && activeHoveredSide === 'left') {
                const sourceIds = activeConnectionStart.nodeIds.filter((sourceId) => isValidConnection(sourceId, activeHoveredNodeId));
                onUpdateNodes((previous) => previous.map((node) => {
                    if (node.id !== activeHoveredNodeId) return node;
                    return { ...node, parentIds: [...new Set([...(node.parentIds || []), ...sourceIds])] };
                }));
                sourceIds.forEach((sourceId) => onConnectionMade?.(sourceId, activeHoveredNodeId));
            }
            else if (activeHoveredSide === 'left') {
                // Connecting to LEFT connector = target receives input (target is child)
                // source is parent, hoveredNode is child
                if (!isValidConnection(activeConnectionStart.nodeId, activeHoveredNodeId)) {
                    // Invalid connection - reset and return
                    isDraggingConnectionRef.current = false;
                    connectionStartRef.current = null;
                    hoveredNodeIdRef.current = null;
                    hoveredSideRef.current = null;
                    connectionTargetStateRef.current = null;
                    setIsDraggingConnection(false);
                    setConnectionStart(null);
                    setTempConnectionEnd(null);
                    setHoveredNodeId(null);
                    setHoveredSide(null);
                    setConnectionTargetState(null);
                    return true;
                }

                // Add source as a parent to target node
                onUpdateNodes(prev => prev.map(n => {
                    if (n.id === activeHoveredNodeId) {
                        const existingParents = n.parentIds || [];
                        // Prevent duplicate connections
                        if (!existingParents.includes(activeConnectionStart.nodeId)) {
                            return { ...n, parentIds: [...existingParents, activeConnectionStart.nodeId] };
                        }
                    }
                    return n;
                }));
                // Notify about new connection: source is parent, hoveredNode is child
                onConnectionMade?.(activeConnectionStart.nodeId, activeHoveredNodeId);
            } else {
                // Connecting to RIGHT connector = target provides output (target is parent)
                // hoveredNode is parent, source is child
                if (!isValidConnection(activeHoveredNodeId, activeConnectionStart.nodeId)) {
                    // Invalid connection - reset and return
                    isDraggingConnectionRef.current = false;
                    connectionStartRef.current = null;
                    hoveredNodeIdRef.current = null;
                    hoveredSideRef.current = null;
                    connectionTargetStateRef.current = null;
                    setIsDraggingConnection(false);
                    setConnectionStart(null);
                    setTempConnectionEnd(null);
                    setHoveredNodeId(null);
                    setHoveredSide(null);
                    setConnectionTargetState(null);
                    return true;
                }

                // Add target as a parent to source node
                onUpdateNodes(prev => prev.map(n => {
                    if (n.id === activeConnectionStart.nodeId) {
                        const existingParents = n.parentIds || [];
                        // Prevent duplicate connections
                        if (!existingParents.includes(activeHoveredNodeId)) {
                            return { ...n, parentIds: [...existingParents, activeHoveredNodeId] };
                        }
                    }
                    return n;
                }));
                // Notify about new connection: hoveredNode is parent, source is child
                onConnectionMade?.(activeHoveredNodeId, activeConnectionStart.nodeId);
            }
        }

        // Reset state
        isDraggingConnectionRef.current = false;
        connectionStartRef.current = null;
        hoveredNodeIdRef.current = null;
        hoveredSideRef.current = null;
        connectionTargetStateRef.current = null;
        setIsDraggingConnection(false);
        setConnectionStart(null);
        setTempConnectionEnd(null);
        setHoveredNodeId(null);
        setHoveredSide(null);
        setConnectionTargetState(null);
        return true;
    };

    /**
     * Handles clicking on a connection line to select it
     */
    const handleEdgeClick = (e: React.MouseEvent, parentId: string, childId: string) => {
        e.stopPropagation();
        setSelectedConnection({ parentId, childId });
    };

    /**
     * Deletes the currently selected connection
     */
    const deleteSelectedConnection = (onUpdateNodes: (updater: (prev: NodeData[]) => NodeData[]) => void) => {
        if (!selectedConnection) return false;

        onUpdateNodes(prev => prev.map(n => {
            if (n.id === selectedConnection.childId) {
                const existingParents = n.parentIds || [];
                return { ...n, parentIds: existingParents.filter(pid => pid !== selectedConnection.parentId) };
            }
            return n;
        }));
        setSelectedConnection(null);
        return true;
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        isDraggingConnection,
        connectionStart,
        tempConnectionEnd,
        hoveredNodeId,
        connectionTargetState,
        selectedConnection,
        setSelectedConnection,
        handleConnectorPointerDown,
        handleSelectionConnectorPointerDown,
        updateConnectionDrag,
        completeConnectionDrag,
        handleEdgeClick,
        deleteSelectedConnection
    };
};
