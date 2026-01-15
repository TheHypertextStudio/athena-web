'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import { useActions } from '@/components/objects/context/ActionContext';
import { useObjectRegistry } from '@/components/objects/context/ObjectRegistryContext';
import { createObject, surfaceId, type TaskObject } from '@/components/objects/types';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { Task as DomainTask, TaskStatus, TaskPriority, TaskId, UserId } from '@athena/types';
import { cn } from '@/lib/utils';

const DEPENDENCY_GRAPH_SURFACE_ID = surfaceId('task-dependency-graph');

export interface TaskNodeContextMenuProps {
  taskId: string;
  taskData: {
    title?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    deadline?: string | null;
  };
  children: ReactNode;
  onRemoveDependencies?: () => void;
}

/**
 * Context menu wrapper for task nodes in the dependency graph.
 *
 * Integrates with ActionContext to provide standard task actions
 * plus graph-specific actions like viewing/removing dependencies.
 */
export function TaskNodeContextMenu({
  taskId,
  taskData,
  children,
  onRemoveDependencies,
}: TaskNodeContextMenuProps) {
  const { getActionGroups, executeAction } = useActions();
  const registry = useObjectRegistry();

  // Create a task object from the node data
  const taskObject: TaskObject = useMemo(() => {
    const now = new Date();
    const task: DomainTask = {
      id: taskId as TaskId,
      title: taskData.title ?? 'Untitled',
      status: taskData.status ?? 'pending',
      priority: taskData.priority ?? 'medium',
      creatorId: '' as UserId,
      createdAt: now,
      updatedAt: now,
      deadline: taskData.deadline ? new Date(taskData.deadline) : undefined,
    };
    return createObject('task', task);
  }, [taskId, taskData]);

  // Register task in object registry for global awareness
  useEffect(() => {
    registry.register(taskObject, DEPENDENCY_GRAPH_SURFACE_ID);
    return () => {
      registry.unregister(taskId);
    };
  }, [registry, taskObject, taskId]);

  // Get action groups for this task
  const actionGroups = useMemo(() => getActionGroups([taskObject]), [getActionGroups, taskObject]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {actionGroups.map((group, groupIndex) => (
          <div key={group.id}>
            {groupIndex > 0 && <ContextMenuSeparator />}
            {group.actions.map((action) => {
              const Icon = action.icon;
              return (
                <ContextMenuItem
                  key={action.id}
                  onClick={() => void executeAction(action.id, [taskObject])}
                  className={cn(action.isDestructive && 'text-error focus:text-error')}
                >
                  {Icon && <Icon className="mr-2 h-4 w-4" />}
                  {action.label}
                  {action.shortcut && <ContextMenuShortcut>{action.shortcut}</ContextMenuShortcut>}
                </ContextMenuItem>
              );
            })}
          </div>
        ))}

        {/* Graph-specific actions */}
        {onRemoveDependencies && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onRemoveDependencies}>View dependencies</ContextMenuItem>
            <ContextMenuItem onClick={onRemoveDependencies}>Add dependency...</ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
