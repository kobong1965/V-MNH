import type { NodeData } from '../../types';

interface VelaMiniMapProps {
  nodes: NodeData[];
}

export function VelaMiniMap({ nodes }: VelaMiniMapProps) {
  if (nodes.length === 0) return null;

  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + 340));
  const maxY = Math.max(...nodes.map((node) => node.y + 200));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  return (
    <aside className="vela-minimap vela-panel" aria-label={`画布小地图，共 ${nodes.length} 个节点`}>
      <div className="vela-minimap__label">小地图 · {nodes.length}</div>
      <svg viewBox={`${minX} ${minY} ${width} ${height}`} role="img" aria-label="节点位置概览">
        {nodes.map((node) => (
          <rect
            key={node.id}
            x={node.x}
            y={node.y}
            width={340}
            height={190}
            rx={16}
            data-kind={node.kind}
          />
        ))}
      </svg>
    </aside>
  );
}
