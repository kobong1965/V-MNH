import type { NodeData } from '../types';

export interface NodeClipboardSnapshot {
    nodes: NodeData[];
}

const cloneNodes = (nodes: NodeData[]): NodeData[] => JSON.parse(JSON.stringify(nodes));

/**
 * Captures the selected nodes together with the graph references between them.
 * Connections to nodes outside the selection are intentionally excluded when
 * the snapshot is instantiated so a pasted graph remains self-contained.
 */
export const createNodeClipboardSnapshot = (
    nodes: NodeData[],
    selectedNodeIds: string[]
): NodeClipboardSnapshot => {
    const selectedIds = new Set(selectedNodeIds);
    return {
        nodes: cloneNodes(nodes.filter((node) => selectedIds.has(node.id)))
    };
};

export const instantiateNodeClipboard = (
    snapshot: NodeClipboardSnapshot,
    offset: number,
    createId: () => string = () => crypto.randomUUID()
): NodeData[] => {
    const copiedIds = new Set(snapshot.nodes.map((node) => node.id));
    const idMap = new Map(snapshot.nodes.map((node) => [node.id, createId()]));

    return cloneNodes(snapshot.nodes).map((node) => {
        const parentIds = [...new Set(node.parentIds || [])]
            .filter((parentId) => copiedIds.has(parentId))
            .map((parentId) => idMap.get(parentId)!)
            .filter(Boolean);
        const frameInputs = node.frameInputs
            ?.filter((input) => copiedIds.has(input.nodeId))
            .map((input) => ({ ...input, nodeId: idMap.get(input.nodeId)! }))
            .filter((input) => Boolean(input.nodeId));
        const linkedVideoNodeId = node.linkedVideoNodeId && copiedIds.has(node.linkedVideoNodeId)
            ? idMap.get(node.linkedVideoNodeId)
            : undefined;

        return {
            ...node,
            id: idMap.get(node.id)!,
            x: node.x + offset,
            y: node.y + offset,
            parentIds,
            frameInputs,
            linkedVideoNodeId,
            groupId: undefined
        };
    });
};
