import { useEffect, useRef } from 'react';

import type { EcommerceWorkflowPreview } from '../services/ecommerceWorkflowService';

interface WorkflowCanvasPreviewProps {
  name: string;
  preview: EcommerceWorkflowPreview;
}

const readCssColor = (canvas: HTMLCanvasElement, property: string, fallback: string) => (
  getComputedStyle(canvas).getPropertyValue(property).trim() || fallback
);

export function WorkflowCanvasPreview({ name, preview }: WorkflowCanvasPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const rectangle = canvas.getBoundingClientRect();
      const width = Math.max(1, rectangle.width);
      const height = Math.max(1, rectangle.height);
      const density = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * density);
      canvas.height = Math.round(height * density);
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(density, 0, 0, density, 0, 0);
      context.clearRect(0, 0, width, height);

      const background = readCssColor(canvas, '--workflow-canvas-background', '#f2f4f1');
      const grid = readCssColor(canvas, '--workflow-canvas-grid', '#dfe4df');
      const linkColor = readCssColor(canvas, '--workflow-canvas-link', '#9ca8a2');
      const nodeSurface = readCssColor(canvas, '--workflow-canvas-node', '#ffffff');
      const nodeText = readCssColor(canvas, '--workflow-canvas-text', '#303532');
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      context.strokeStyle = grid;
      context.globalAlpha = 0.55;
      context.lineWidth = 1;
      for (let x = 12.5; x < width; x += 18) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }
      for (let y = 10.5; y < height; y += 18) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }
      context.globalAlpha = 1;

      const padding = 16;
      const bounds = preview.bounds;
      const scale = Math.max(0.0001, Math.min(
        (width - padding * 2) / Math.max(1, bounds.width),
        (height - padding * 2) / Math.max(1, bounds.height)
      ));
      const drawnWidth = bounds.width * scale;
      const drawnHeight = bounds.height * scale;
      const offsetX = (width - drawnWidth) / 2 - bounds.x * scale;
      const offsetY = (height - drawnHeight) / 2 - bounds.y * scale;
      const byId = new Map(preview.nodes.map((node) => [node.id, node]));

      context.strokeStyle = linkColor;
      context.globalAlpha = 0.65;
      context.lineWidth = Math.max(0.65, Math.min(1.6, scale * 3.2));
      for (const link of preview.links) {
        const source = byId.get(link.from);
        const target = byId.get(link.to);
        if (!source || !target) continue;
        const sourceX = (source.x + source.width) * scale + offsetX;
        const sourceY = (source.y + source.height / 2) * scale + offsetY;
        const targetX = target.x * scale + offsetX;
        const targetY = (target.y + target.height / 2) * scale + offsetY;
        const bend = Math.max(6, Math.abs(targetX - sourceX) * 0.42);
        context.beginPath();
        context.moveTo(sourceX, sourceY);
        context.bezierCurveTo(sourceX + bend, sourceY, targetX - bend, targetY, targetX, targetY);
        context.stroke();
      }
      context.globalAlpha = 1;

      for (const node of preview.nodes) {
        const x = node.x * scale + offsetX;
        const y = node.y * scale + offsetY;
        const nodeWidth = Math.max(2.4, node.width * scale);
        const nodeHeight = Math.max(2, node.height * scale);
        const radius = Math.min(5, nodeWidth / 4, nodeHeight / 4);
        context.fillStyle = nodeSurface;
        context.beginPath();
        context.roundRect(x, y, nodeWidth, nodeHeight, radius);
        context.fill();
        context.fillStyle = node.color;
        context.fillRect(x, y, Math.max(1.5, nodeWidth), Math.min(Math.max(1.5, nodeHeight * 0.17), 6));

        if (nodeWidth > 44 && nodeHeight > 18) {
          context.save();
          context.beginPath();
          context.rect(x + 4, y + 5, Math.max(0, nodeWidth - 8), Math.max(0, nodeHeight - 8));
          context.clip();
          context.fillStyle = nodeText;
          context.font = `${Math.min(10, Math.max(6, nodeHeight * 0.16))}px "Microsoft YaHei UI", sans-serif`;
          context.globalAlpha = 0.82;
          context.fillText(node.label, x + 5, y + Math.min(nodeHeight - 4, 16));
          context.restore();
        }
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [preview]);

  return <canvas ref={canvasRef} className="vela-commerce-preview" role="img" aria-label={`${name} 的节点画布预览`} />;
}
