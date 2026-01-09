/**
 * Sortable task list with drag-and-drop reordering.
 *
 * @packageDocumentation
 */

'use client';

import { useCallback, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { type Task } from '@/lib/api-client';
import { AgendaTaskItem } from './agenda-task-item';

interface SortableTaskListProps {
  /** Tasks to display */
  tasks: Task[];
  /** Callback when task order changes */
  onReorder: (taskIds: string[]) => void;
  /** Callback when task status changes */
  onTaskStatusChange?: (taskId: string, completed: boolean) => void;
}

/**
 * A sortable list of tasks with drag-and-drop reordering.
 */
export function SortableTaskList({ tasks, onReorder, onTaskStatusChange }: SortableTaskListProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (over && active.id !== over.id) {
        const oldIndex = tasks.findIndex((t) => t.id === active.id);
        const newIndex = tasks.findIndex((t) => t.id === over.id);

        const newOrder = arrayMove(tasks, oldIndex, newIndex);
        onReorder(newOrder.map((t) => t.id));
      }
    },
    [tasks, onReorder],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  if (tasks.length === 0) {
    return <p className="text-muted-foreground text-sm">No pending tasks for today</p>;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {tasks.map((task) => (
            <SortableTaskItem key={task.id} task={task} onStatusChange={onTaskStatusChange} />
          ))}
        </div>
      </SortableContext>

      {/* Drag overlay for smoother dragging */}
      <DragOverlay>
        {activeTask ? <AgendaTaskItem task={activeTask} isDragging showDragHandle={false} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

interface SortableTaskItemProps {
  task: Task;
  onStatusChange?: (taskId: string, completed: boolean) => void;
}

/**
 * Individual sortable task item wrapper.
 */
function SortableTaskItem({ task, onStatusChange }: SortableTaskItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <AgendaTaskItem
        task={task}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners }}
        onStatusChange={onStatusChange}
      />
    </div>
  );
}
