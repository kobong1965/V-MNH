/**
 * useHistory.ts
 * 
 * Custom hook for managing undo/redo history.
 * Implements a past/present/future pattern for state management.
 */

import { useState, useCallback } from 'react';

interface HistoryStore<T> {
    past: T[];
    present: T;
    future: T[];
}

export const useHistory = <T>(initialState: T, maxHistorySize: number = 50) => {
    // ============================================================================
    // STATE
    // ============================================================================

    const [history, setHistory] = useState<HistoryStore<T>>({
        past: [],
        present: initialState,
        future: []
    });

    // ============================================================================
    // COMPUTED VALUES
    // ============================================================================

    const canUndo = history.past.length > 0;
    const canRedo = history.future.length > 0;

    // ============================================================================
    // OPERATIONS
    // ============================================================================

    /**
     * Undo the last action
     * Moves present to future, pops from past to present
     */
    const undo = useCallback(() => {
        setHistory((current) => {
            if (current.past.length === 0) return current;
            const previous = current.past[current.past.length - 1];
            return {
                past: current.past.slice(0, -1),
                present: previous,
                future: [current.present, ...current.future]
            };
        });
    }, []);

    /**
     * Redo the last undone action
     * Moves present to past, pops from future to present
     */
    const redo = useCallback(() => {
        setHistory((current) => {
            if (current.future.length === 0) return current;
            const [next, ...remainingFuture] = current.future;
            return {
                past: [...current.past, current.present],
                present: next,
                future: remainingFuture
            };
        });
    }, []);

    /**
     * Push a new state to history
     * Clears redo stack and adds current state to past
     * @param newState - New state to push
     */
    const pushHistory = useCallback((newState: T) => {
        setHistory((current) => {
            if (JSON.stringify(newState) === JSON.stringify(current.present)) return current;
            return {
                past: [...current.past.slice(-maxHistorySize + 1), current.present],
                present: newState,
                future: []
            };
        });
    }, [maxHistorySize]);

    /**
     * Reset history to a new initial state
     * Clears all history
     * @param newState - New initial state
     */
    const reset = useCallback((newState: T) => {
        setHistory({ past: [], present: newState, future: [] });
    }, []);

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        present: history.present,
        undo,
        redo,
        pushHistory,
        reset,
        canUndo,
        canRedo
    };
};
