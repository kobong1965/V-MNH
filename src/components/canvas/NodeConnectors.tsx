/**
 * NodeConnectors.tsx
 * 
 * Renders the left and right connector buttons for a node.
 * Handles pointer events for drag-to-connect functionality.
 */

import React from 'react';
import { Plus } from 'lucide-react';

interface NodeConnectorsProps {
    nodeId: string;
    onConnectorDown: (e: React.PointerEvent, id: string, side: 'left' | 'right') => void;
    canvasTheme?: 'dark' | 'light';
}

export const NodeConnectors: React.FC<NodeConnectorsProps> = ({
    nodeId,
    onConnectorDown,
    canvasTheme = 'dark'
}) => {
    const isDark = canvasTheme === 'dark';
    const buttonClassName = `vela-node-connector ${isDark ? 'is-dark' : 'is-light'}`;

    return (
        <>
            {/* Left Connector */}
            <button
                onPointerDown={(e) => {
                    e.stopPropagation();
                    onConnectorDown(e, nodeId, 'left');
                }}
                className={`vela-node-connector--left ${buttonClassName}`}
            >
                <Plus size={14} />
            </button>

            {/* Right Connector */}
            <button
                onPointerDown={(e) => {
                    e.stopPropagation();
                    onConnectorDown(e, nodeId, 'right');
                }}
                className={`vela-node-connector--right ${buttonClassName}`}
            >
                <Plus size={14} />
            </button>
        </>
    );
};
