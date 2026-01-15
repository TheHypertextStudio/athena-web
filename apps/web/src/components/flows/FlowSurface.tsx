'use client';

import { useCallback, type ReactNode } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import DownloadIcon from '@mui/icons-material/Download';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import { Button } from '@/components/ui/button';
import { FlowBackground } from './shared/FlowBackground';
import { FlowControls } from './shared/FlowControls';
import { FlowMinimap } from './shared/FlowMinimap';
import { useFlowExport } from '@/hooks/use-flow-export';
import { cn } from '@/lib/utils';

export interface FlowSurfaceProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange?: OnNodesChange;
  onEdgesChange?: OnEdgesChange;
  onConnect?: OnConnect;
  onNodeClick?: (event: React.MouseEvent, node: Node) => void;
  onEdgeClick?: (event: React.MouseEvent, edge: Edge) => void;
  nodeTypes?: NodeTypes;
  edgeTypes?: EdgeTypes;
  title?: string;
  showMinimap?: boolean;
  showControls?: boolean;
  showBackground?: boolean;
  /** Enable export button. Pass string for custom filename. */
  exportFileName?: string | boolean;
  onExpand?: () => void;
  fitView?: boolean;
  /** Disable node dragging for read-only graphs */
  nodesDraggable?: boolean;
  /** Disable edge creation via drag */
  nodesConnectable?: boolean;
  className?: string;
  children?: ReactNode;
}

function FlowSurfaceInner({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeClick,
  onEdgeClick,
  nodeTypes,
  edgeTypes,
  title,
  showMinimap = true,
  showControls = true,
  showBackground = true,
  exportFileName,
  onExpand,
  fitView = true,
  nodesDraggable = true,
  nodesConnectable = true,
  className,
  children,
}: FlowSurfaceProps) {
  const fileName =
    typeof exportFileName === 'string'
      ? exportFileName
      : exportFileName
        ? 'flow-export'
        : undefined;

  const { exportToPng } = useFlowExport({
    fileName: fileName ?? 'flow-export',
  });

  const handleExport = useCallback(() => {
    void exportToPng();
  }, [exportToPng]);

  return (
    <div
      className={cn(
        'border-outline-variant bg-surface flex h-full w-full flex-col rounded-xl border',
        className,
      )}
    >
      {title && (
        <div className="border-outline-variant flex items-center justify-between border-b px-4 py-2">
          <h3 className="text-on-surface font-medium">{title}</h3>
          <div className="flex gap-1">
            {fileName && (
              <Button variant="text" size="icon" onClick={handleExport} title="Export">
                <DownloadIcon sx={{ fontSize: 18 }} />
              </Button>
            )}
            {onExpand && (
              <Button variant="text" size="icon" onClick={onExpand} title="Expand">
                <FullscreenIcon sx={{ fontSize: 18 }} />
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="relative flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView={fitView}
          nodesDraggable={nodesDraggable}
          nodesConnectable={nodesConnectable}
          proOptions={{ hideAttribution: true }}
          className="bg-surface"
        >
          {showBackground && <FlowBackground />}
          {showControls && <FlowControls />}
          {showMinimap && <FlowMinimap />}
          {children}
        </ReactFlow>
      </div>
    </div>
  );
}

/**
 * Reusable flow surface component.
 *
 * Provides a consistent container for ReactFlow graphs with:
 * - Title bar with optional export/expand actions
 * - Background pattern
 * - Zoom/pan controls
 * - Minimap navigation
 *
 * @example
 * ```tsx
 * <FlowSurface
 *   nodes={nodes}
 *   edges={edges}
 *   title="Task Dependencies"
 *   onNodeClick={(e, node) => openTaskDetail(node.id)}
 * />
 * ```
 */
export function FlowSurface(props: FlowSurfaceProps) {
  return (
    <ReactFlowProvider>
      <FlowSurfaceInner {...props} />
    </ReactFlowProvider>
  );
}
