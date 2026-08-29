import '@testing-library/jest-dom/vitest';

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSchedulingSlotDropTarget } from '../../src/components/dnd/use-scheduling-slot-drop-target';
import { ActionRegistryProvider } from '../../src/lib/actions/registry-context';
import { createActionRegistry, defineActionDomain } from '../../src/lib/actions/registry';
import type { ObjectRef } from '../../src/lib/actions/object';

let currentSource: { readonly data: unknown } | null = null;
let droppableInput: unknown;
let monitor: { readonly onDragMove?: (event: unknown) => void } = {};

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
  currentSource = {
    data: {
      kind: 'docket-object',
      object: task,
      objects: [task],
      sourceSurfaceId: 'reference-tasks',
      actionScope: 'reference',
    },
  };
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
      collisionPriority: -2,
      data: { canDrop: false, effectLabel: null },
    });
  });
});
