'use client';

import { useCallback } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { TaskDependencyFlow } from './TaskDependencyFlow';
import { useGraphKeyboardNav } from './useGraphKeyboardNav';
import { useDependencyGraph } from './useDependencyGraph';
import { surfaceId } from '@/components/objects/types';
import { cn } from '@/lib/utils';

const SURFACE_ID = surfaceId('project-task-graph');

export interface ProjectTaskGraphSurfaceProps {
  /** Project ID to display task dependencies for */
  projectId: string;
  /** Callback when a task is selected */
  onTaskSelect?: (taskId: string) => void;
  /** Title for the surface header */
  title?: string;
  /** Whether to show the minimap */
  showMinimap?: boolean;
  /** Whether to show zoom/pan controls */
  showControls?: boolean;
  /** Whether to include completed tasks */
  includeCompleted?: boolean;
  /** Callback for expand/fullscreen action */
  onExpand?: () => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Self-contained surface for displaying project task dependencies.
 *
 * This is the primary component for embedding a task dependency graph
 * in project views. It handles data fetching, keyboard navigation,
 * and integrates with the Athena object system.
 *
 * Per the Human Interface Guidelines, this is a Surface component
 * that can be embedded in various contexts (project detail page,
 * modals, side panels) while maintaining consistent behavior.
 *
 * @example
 * ```tsx
 * // In a project detail page
 * <ProjectTaskGraphSurface
 *   projectId={project.id}
 *   onTaskSelect={(id) => router.push(`/tasks/${id}`)}
 *   title="Task Dependencies"
 * />
 *
 * // In a modal
 * <Dialog>
 *   <DialogContent className="max-w-4xl h-[600px]">
 *     <ProjectTaskGraphSurface
 *       projectId={project.id}
 *       showMinimap={false}
 *     />
 *   </DialogContent>
 * </Dialog>
 * ```
 */
export function ProjectTaskGraphSurface({
  projectId,
  onTaskSelect,
  title = 'Task Dependencies',
  showMinimap = true,
  showControls = true,
  includeCompleted = false,
  onExpand,
  className,
}: ProjectTaskGraphSurfaceProps) {
  return (
    <ReactFlowProvider>
      <ProjectTaskGraphSurfaceInner
        projectId={projectId}
        onTaskSelect={onTaskSelect}
        title={title}
        showMinimap={showMinimap}
        showControls={showControls}
        includeCompleted={includeCompleted}
        onExpand={onExpand}
        className={className}
      />
    </ReactFlowProvider>
  );
}

function ProjectTaskGraphSurfaceInner({
  projectId,
  onTaskSelect,
  title,
  showMinimap,
  showControls,
  includeCompleted,
  onExpand,
  className,
}: ProjectTaskGraphSurfaceProps) {
  const { nodes, edges, topologicalOrder } = useDependencyGraph({
    projectId,
    includeCompleted,
  });

  const { handleKeyDown, setHasFocus } = useGraphKeyboardNav({
    nodes,
    edges,
    topologicalOrder,
    surfaceId: SURFACE_ID,
  });

  const handleNodeClick = useCallback(
    (taskId: string) => {
      onTaskSelect?.(taskId);
    },
    [onTaskSelect],
  );

  const handleFocus = useCallback(() => {
    setHasFocus(true);
  }, [setHasFocus]);

  const handleBlur = useCallback(() => {
    setHasFocus(false);
  }, [setHasFocus]);

  return (
    <div
      className={cn('h-full w-full', className)}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      tabIndex={0}
      role="application"
      aria-label="Task dependency graph"
      aria-describedby="graph-instructions"
    >
      <span id="graph-instructions" className="sr-only">
        Use Tab to navigate between tasks in dependency order. Use arrow keys to navigate visually.
        Press Enter or Space to open task actions. Press Escape to clear selection. Press Command+A
        to select all tasks.
      </span>
      <TaskDependencyFlow
        projectId={projectId}
        title={title}
        showMinimap={showMinimap}
        showControls={showControls}
        includeCompleted={includeCompleted}
        onNodeClick={handleNodeClick}
        onExpand={onExpand}
      />
    </div>
  );
}
