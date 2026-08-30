import '@testing-library/jest-dom/vitest';

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSchedulingSlotDropTarget } from '../../src/components/dnd/use-scheduling-slot-drop-target';
import { ActionRegistryProvider } from '../../src/lib/actions/registry-context';
import { createActionRegistry, defineActionDomain } from '../../src/lib/actions/registry';
import type { ObjectRef } from '../../src/lib/actions/object';

let currentSource: { readonly data: unknown } | null = null;
let droppableInput: unknown;
let monitor: {
  readonly onDragMove?: (event: unknown) => void;
  readonly onDragEnd?: (event: unknown) => void;
} = {};

vi.mock('@dnd-kit/react', () => ({
  useDragOperation: () => ({ source: currentSource, target: null }),
  useDroppable: (input: unknown) => {
    droppableInput = input;
    return { ref: vi.fn(), isDropTarget: true };
  },
  useDragDropMonitor: (handlers: typeof monitor) => {
    monitor = handlers;
  },
}));

const task: ObjectRef = {
  kind: 'task',
  id: 'task-1',
  organizationId: 'org-1',
  title: 'Write the plan',
};
const slot: ObjectRef = {
  kind: 'calendar_slot',
  id: 'slot-600',
  organizationId: 'org-1',
  title: '10:00 AM',
};

interface CollisionInput {
  readonly droppable: {
    readonly id: string;
    readonly shape: {
      readonly center: { readonly x: number; readonly y: number };
      readonly containsPoint: () => boolean;
    };
  };
  readonly dragOperation: {
    readonly source: { readonly data: unknown } | null;
    readonly position: { readonly current: { readonly x: number; readonly y: number } };
  };
}

interface DroppableInput {
  readonly id: string;
  readonly collisionPriority?: number;
  readonly collisionDetector?: (input: CollisionInput) => { readonly priority: number } | null;
}

function collisionPriorityFor(source: { readonly data: unknown } | null): number | undefined {
  const input = droppableInput as DroppableInput;
  return input.collisionDetector?.({
    droppable: {
      id: input.id,
      shape: {
        center: { x: 0, y: 0 },
        containsPoint: () => true,
      },
    },
    dragOperation: {
      source,
      position: { current: { x: 20, y: 20 } },
    },
  })?.priority;
}

function source(actionScope: 'all' | 'reference'): { readonly data: unknown } {
  return {
    data: {
      kind: 'docket-object',
      object: task,
      objects: [task],
      sourceSurfaceId: 'tasks-list',
      actionScope,
    },
  };
}

function Target(): React.JSX.Element {
  const drop = useSchedulingSlotDropTarget({
    startMinutesAt: () => 600,
    targetAt: () => slot,
  });
  return (
    <div ref={drop.ref} data-testid="target" data-drop-state={drop.dropState}>
      {drop.effectLabel}
    </div>
  );
}

beforeEach(() => {
  currentSource = source('reference');
  droppableInput = undefined;
  monitor = {};
});

afterEach(cleanup);

describe('useSchedulingSlotDropTarget', () => {
  it('rejects a reference source before advertising a scheduling preview', () => {
    const registry = createActionRegistry();
    registry.register(
      'task',
      defineActionDomain('task', [
        {
          id: 'task.schedule',
          relationId: 'task.calendar-slot',
          label: 'Schedule task',
          objectKinds: ['task'],
          run: () => undefined,
        },
      ]),
    );
    render(
      <ActionRegistryProvider registry={registry}>
        <Target />
      </ActionRegistryProvider>,
    );

    const input = droppableInput as { readonly id: string };
    act(() => {
      monitor.onDragMove?.({
        nativeEvent: { clientY: 20 },
        operation: {
          source: currentSource,
          target: { id: input.id },
          position: { current: { y: 20 } },
        },
      });
    });

    expect(screen.getByTestId('target')).toHaveAttribute('data-drop-state', 'reject');
    expect(screen.getByTestId('target')).not.toHaveTextContent('Schedule at 10:00 AM');
    expect(droppableInput).toMatchObject({
      data: { canDrop: false, effectLabel: null },
    });
    expect(collisionPriorityFor(currentSource)).toBe(-2);
  });

  it('resolves and commits a writable slot without waiting for source state to render', async () => {
    const activeSource = source('all');
    currentSource = null;
    const run = vi.fn();
    const registry = createActionRegistry();
    registry.register(
      'task',
      defineActionDomain('task', [
        {
          id: 'task.schedule',
          relationId: 'task.calendar-slot',
          label: 'Schedule task',
          objectKinds: ['task'],
          run,
        },
      ]),
    );
    render(
      <ActionRegistryProvider registry={registry}>
        <Target />
      </ActionRegistryProvider>,
    );

    expect((droppableInput as DroppableInput).collisionPriority).toBeUndefined();
    expect(collisionPriorityFor(activeSource)).toBe(2);

    const input = droppableInput as DroppableInput;
    act(() => {
      monitor.onDragEnd?.({
        nativeEvent: { clientY: 20 },
        operation: {
          source: activeSource,
          target: { id: input.id },
          position: { current: { x: 20, y: 20 } },
        },
      });
    });

    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledOnce();
    });
  });
});
