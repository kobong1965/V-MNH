/**
 * useAutoSave.ts
 * 
 * Custom hook that periodically saves the canvas state to the backend
 * if there are unsaved changes and no active generations.
 */

import { useEffect, useState } from 'react';
import { NodeData } from '../types';
import { shouldAttemptAutoSave } from '../vela/saveState';

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
    useEffect(() => {
        const saveAfterQuietPeriod = async () => {
            if (!shouldAttemptAutoSave(isDirty)) return;

            try {
                console.log('[Auto-Save] Saving after 2 second debounce...');
                await onSave();
                setLastSaveTime(Date.now());
            } catch (error) {
                console.error('[Auto-Save] Failed to auto-save:', error);
            }
        };

        const timer = window.setTimeout(() => void saveAfterQuietPeriod(), interval);

        return () => window.clearTimeout(timer);
    }, [isDirty, nodes, onSave, interval]);

    return {
        lastSaveTime
    };
};
