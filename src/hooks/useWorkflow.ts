/**
 * useWorkflow.ts
 * 
 * Custom hook for managing workflow save/load functionality.
 * Handles persistence to the backend server.
 */

import React, { useState, useCallback, Dispatch, SetStateAction } from 'react';
import { NodeData, NodeGroup, NodeType, Viewport } from '../types';
import { loadVelaProject, saveVelaProject } from '../vela/services/projectService';

interface UseWorkflowOptions {
    nodes: NodeData[];
    groups: NodeGroup[];
    viewport: Viewport;
    canvasTitle: string;
    setNodes: Dispatch<SetStateAction<NodeData[]>>;
    setGroups: Dispatch<SetStateAction<NodeGroup[]>>; // For restoring groups when loading
    setSelectedNodeIds: Dispatch<SetStateAction<string[]>>;
    setViewport: Dispatch<SetStateAction<Viewport>>;
    setCanvasTitle: (title: string) => void;
    setEditingTitleValue: (value: string) => void;
    onPanelOpen?: () => void; // Called when workflow panel opens
}

export const useWorkflow = ({
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
    onPanelOpen
}: UseWorkflowOptions) => {
    // Workflow state
    const [workflowId, setWorkflowId] = useState<string | null>(null);
    const [isWorkflowPanelOpen, setIsWorkflowPanelOpen] = useState(false);
    const [workflowPanelY, setWorkflowPanelY] = useState(0);

    /**
     * Save current workflow to server
     */
    const handleSaveWorkflow = useCallback(async () => {
        try {
            const workflow = {
                id: workflowId,
                name: canvasTitle,
                nodes,
                groups,
                viewport
            };
            const result = await saveVelaProject(workflow);
            setWorkflowId(result.id);
            console.log('Vela project saved:', result.id);
            return result.id;
        } catch (error) {
            console.error('Failed to save workflow:', error);
            return null;
        }
    }, [workflowId, canvasTitle, nodes, groups, viewport]);

    /**
     * Load workflow from server
     * Supports both user workflows and public workflows (prefixed with "public:")
     * Returns the loaded workflow's node count and title for tracking
     */
    const handleLoadWorkflow = useCallback(async (id: string): Promise<{ nodeCount: number; title: string } | null> => {
        try {
            const workflow = await loadVelaProject(id);
                setWorkflowId(workflow.id);
                setCanvasTitle(workflow.name || '未命名工作区');
                setEditingTitleValue(workflow.name || '未命名工作区');
                setNodes((workflow.nodes || []).map((node) => (
                    node.type === NodeType.TEXT ? { ...node, textMode: 'menu' as const } : node
                )));
                setGroups(workflow.groups || []); // Restore groups
                setViewport(workflow.viewport || { x: 0, y: 0, zoom: 1 });
                // Reset selection
                setSelectedNodeIds([]);
                setIsWorkflowPanelOpen(false);
                console.log('Vela project loaded:', workflow.id);
                // Return info for tracking
                return {
                    nodeCount: (workflow.nodes || []).length,
                    title: workflow.name || '未命名工作区'
                };
        } catch (error) {
            console.error('Failed to load workflow:', error);
        }
        return null;
    }, [setNodes, setGroups, setSelectedNodeIds, setViewport, setCanvasTitle, setEditingTitleValue]);

    /**
     * Handle workflow panel toggle from toolbar click
     */
    const handleWorkflowsClick = useCallback((e: React.MouseEvent) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setWorkflowPanelY(rect.top);
        setIsWorkflowPanelOpen(prev => !prev);
        onPanelOpen?.(); // Close other panels
    }, [onPanelOpen]);

    /**
     * Close workflow panel
     */
    const closeWorkflowPanel = useCallback(() => {
        setIsWorkflowPanelOpen(false);
    }, []);

    /**
     * Reset workflow ID (for creating a new canvas)
     */
    const resetWorkflowId = useCallback(() => {
        setWorkflowId(null);
    }, []);

    return {
        workflowId,
        isWorkflowPanelOpen,
        workflowPanelY,
        handleSaveWorkflow,
        handleLoadWorkflow,
        handleWorkflowsClick,
        closeWorkflowPanel,
        resetWorkflowId
    };
};
