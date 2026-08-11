/**
 * useKeyboardShortcuts.ts
 * 
 * Handles keyboard shortcuts: undo/redo, copy/paste, delete, escape.
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { NodeData, ContextMenuState } from '../types';
import {
    createNodeClipboardSnapshot,
    instantiateNodeClipboard,
    type NodeClipboardSnapshot
} from '../utils/nodeClipboard';

interface UseKeyboardShortcutsOptions {
    enabled?: boolean;
    nodes: NodeData[];
    selectedNodeIds: string[];
    selectedConnection: { parentId: string; childId: string } | null;
    setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>;
    setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>;
    setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
    deleteNodes: (ids: string[]) => void;
    deleteSelectedConnection: (setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>) => void;
    clearSelection: () => void;
    clearSelectionBox: () => void;
    undo: () => void;
    redo: () => void;
}

export const useKeyboardShortcuts = ({
    enabled = true,
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
}: UseKeyboardShortcutsOptions) => {
    const clipboardRef = useRef<NodeClipboardSnapshot>({ nodes: [] });
    const pasteCountRef = useRef(0);

    // ============================================================================
    // COPY / PASTE / DUPLICATE
    // ============================================================================

    const handleCopy = useCallback(() => {
        if (selectedNodeIds.length > 0) {
            clipboardRef.current = createNodeClipboardSnapshot(nodes, selectedNodeIds);
            pasteCountRef.current = 0;
            console.log(`Copied ${clipboardRef.current.nodes.length} node(s) with internal connections`);
        }
    }, [nodes, selectedNodeIds]);

    const handlePaste = useCallback(() => {
        if (clipboardRef.current.nodes.length > 0) {
            pasteCountRef.current += 1;
            const newNodes = instantiateNodeClipboard(clipboardRef.current, 50 * pasteCountRef.current);

            setNodes(prev => [...prev, ...newNodes]);
            setSelectedNodeIds(newNodes.map(n => n.id));
            console.log(`Pasted ${newNodes.length} node(s)`);
        }
    }, [setNodes, setSelectedNodeIds]);

    const handleDuplicate = useCallback(() => {
        if (selectedNodeIds.length > 0) {
            const snapshot = createNodeClipboardSnapshot(nodes, selectedNodeIds);
            const newNodes = instantiateNodeClipboard(snapshot, 20);

            setNodes(prev => [...prev, ...newNodes]);
            setSelectedNodeIds(newNodes.map(n => n.id));
        }
    }, [nodes, selectedNodeIds, setNodes, setSelectedNodeIds]);

    // ============================================================================
    // KEYBOARD EVENT EFFECT
    // ============================================================================

    useEffect(() => {
        if (!enabled) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target instanceof HTMLElement ? e.target : document.activeElement;
            if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return;

            const accelerator = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();

            // Undo: Ctrl+Z (without Shift)
            if (accelerator && key === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo();
                return;
            }

            // Redo: Ctrl+Y or Ctrl+Shift+Z
            if ((accelerator && key === 'y') || (accelerator && e.shiftKey && key === 'z')) {
                e.preventDefault();
                redo();
                return;
            }

            // Copy: Ctrl+C
            if (accelerator && key === 'c') {
                e.preventDefault();
                handleCopy();
                return;
            }

            // Paste: Ctrl+V
            if (accelerator && key === 'v') {
                e.preventDefault();
                handlePaste();
                return;
            }

            // Duplicate: Ctrl+D
            if (accelerator && key === 'd') {
                e.preventDefault();
                handleDuplicate();
                return;
            }

            // Delete selected nodes or connection
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedNodeIds.length > 0) {
                    deleteNodes(selectedNodeIds);
                    setContextMenu(prev => ({ ...prev, isOpen: false }));
                } else if (selectedConnection) {
                    deleteSelectedConnection(setNodes);
                }
            } else if (e.key === 'Escape') {
                clearSelection();
                clearSelectionBox();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
        enabled,
        selectedNodeIds,
        selectedConnection,
        deleteNodes,
        deleteSelectedConnection,
        clearSelection,
        clearSelectionBox,
        undo,
        redo,
        handlePaste,
        handleCopy,
        handleDuplicate,
        setNodes,
        setContextMenu
    ]);

    return {
        handleCopy,
        handlePaste,
        handleDuplicate
    };
};
