/**
 * useAutoSave.ts
 * 
 * Custom hook that periodically saves the canvas state to the backend
 * if there are unsaved changes and no active generations.
 */

import { useEffect, useRef, useState } from 'react';
import { NodeData } from '../types';

interface UseAutoSaveOptions {
    isDirty: boolean;
    nodes: NodeData[];
    onSave: () => Promise<void>;
    interval?: number; // Debounce duration in milliseconds, default 2s
}

export const useAutoSave = ({
    isDirty,
    nodes,
    onSave,
    interval = 2000
}: UseAutoSaveOptions) => {
    const [lastSaveTime, setLastSaveTime] = useState<number>(Date.now());
    const isSavingRef = useRef<boolean>(false);

    useEffect(() => {
        const saveAfterQuietPeriod = async () => {
            // Only save if dirty and we have nodes
            if (!isDirty || nodes.length === 0) return;

            // Don't save if already in the middle of a save operation
            if (isSavingRef.current) return;

            try {
                isSavingRef.current = true;
                console.log('[Auto-Save] Saving after 2 second debounce...');
                await onSave();
                setLastSaveTime(Date.now());
            } catch (error) {
                console.error('[Auto-Save] Failed to auto-save:', error);
            } finally {
                isSavingRef.current = false;
            }
        };

        const timer = window.setTimeout(() => void saveAfterQuietPeriod(), interval);

        return () => window.clearTimeout(timer);
    }, [isDirty, nodes, onSave, interval]);

    return {
        lastSaveTime
    };
};
