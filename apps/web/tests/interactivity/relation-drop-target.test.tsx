import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionRegistryProvider } from '../../src/lib/actions/registry-context';
import { createActionRegistry, defineActionDomain } from '../../src/lib/actions/registry';
import type { ObjectRef } from '../../src/lib/actions/object';
import {
  type RelationDropExecutor,
  useRelationDropTarget,
} from '../../src/components/dnd/use-relation-drop-target';

let currentSource: { readonly data: unknown } | null = null;
let isDropTarget = false;
let monitor: { readonly onDragEnd?: (event: unknown) => void } = {};
const ref = vi.fn();

vi.mock('@dnd-kit/react', () => ({
  useDragOperation: () => ({ source: currentSource, target: null }),
  useDroppable: (input: unknown) => {
    droppableInput = input;
    return { ref, isDropTarget };
  },
  useDragDropMonitor: (handlers: typeof monitor) => {
    monitor = handlers;
  },
}));

let droppableInput: unknown;

const task: ObjectRef = {
  kind: 'task',
  id: 'task-1',
  organizationId: 'org-1',
  title: 'Write the plan',
};
const project: ObjectRef = {
  kind: 'project',
  id: 'project-1',
  organizationId: 'org-1',
  title: 'Launch Athena',
};

function Target({
  object = project,
  execute,
}: {
  readonly object?: ObjectRef;
  readonly execute?: RelationDropExecutor;
}): React.JSX.Element {
  const drop = useRelationDropTarget({ target: object, execute });
  return (
    <div {...drop.dropProps} data-testid="target">
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
      sourceSurfaceId: 'tasks-list',
      actionScope: 'all',
    },
  };
  isDropTarget = true;
  monitor = {};
  droppableInput = undefined;
  ref.mockClear();
});

afterEach(cleanup);

describe('useRelationDropTarget', () => {
  it('resolves source and target through the domain catalog and registered relation action', () => {
    const registry = createActionRegistry();
    registry.register(
      'task',
      defineActionDomain('task', [
        {
          id: 'task.moveToProject',
          relationId: 'task.project',
          label: 'Move to project',
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

    expect(screen.getByTestId('target')).toHaveAttribute('data-drop-state', 'accept');
    expect(screen.getByTestId('target')).toHaveTextContent('Move to Launch Athena');
    expect(droppableInput).toMatchObject({
      type: 'docket-relation-target',
      collisionPriority: 4,
    });
  });

  it('dispatches the one registered relation action with ordered subjects and target', async () => {
    const run = vi.fn();
    const registry = createActionRegistry();
    registry.register(
      'task',
      defineActionDomain('task', [
        {
          id: 'task.moveToProject',
          relationId: 'task.project',
          label: 'Move to project',
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

    const input = droppableInput as { readonly id: string };
    monitor.onDragEnd?.({
      operation: {
        source: currentSource,
        target: { id: input.id, data: (droppableInput as { readonly data: unknown }).data },
      },
    });
    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledOnce();
    });

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        objects: [task],
        target: project,
        source: 'drag',
        organizationId: 'org-1',
        actionScope: 'all',
      }),
    );
  });

  it('does not advertise a reference source as an accepted relationship', () => {
    const run = vi.fn();
    const registry = createActionRegistry();
    registry.register(
      'task',
      defineActionDomain('task', [
        {
          id: 'task.moveToProject',
          relationId: 'task.project',
          label: 'Move to project',
          objectKinds: ['task'],
          run,
        },
      ]),
    );
    currentSource = {
      data: {
        kind: 'docket-object',
        object: task,
        objects: [task],
        sourceSurfaceId: 'reference-tasks',
        actionScope: 'reference',
      },
    };
    render(
      <ActionRegistryProvider registry={registry}>
        <Target />
      </ActionRegistryProvider>,
    );

    expect(screen.getByTestId('target')).toHaveAttribute('data-drop-state', 'reject');
    expect(screen.getByTestId('target')).not.toHaveTextContent('Move to Launch Athena');
    expect(droppableInput).toMatchObject({
      collisionPriority: -1,
      data: { canDrop: false, effectLabel: null },
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('does not send a reference source to a surface-owned executor', () => {
    const execute = vi.fn<RelationDropExecutor>().mockResolvedValue('applied');
    currentSource = {
      data: {
        kind: 'docket-object',
        object: task,
        objects: [task],
        sourceSurfaceId: 'reference-tasks',
        actionScope: 'reference',
      },
    };
    render(<Target execute={execute} />);

    const input = droppableInput as { readonly id: string; readonly data: unknown };
    monitor.onDragEnd?.({
      operation: {
        source: currentSource,
        target: { id: input.id, data: input.data },
      },
    });

    expect(execute).not.toHaveBeenCalled();
  });

  it('prefers a surface-owned executor so a canvas drop stays in its receipt history', async () => {
    const execute = vi.fn<RelationDropExecutor>().mockResolvedValue('applied');
    render(<Target execute={execute} />);

    expect(screen.getByTestId('target')).toHaveAttribute('data-drop-state', 'accept');
    expect(screen.getByTestId('target')).toHaveTextContent('Move to Launch Athena');

    const input = droppableInput as { readonly id: string; readonly data: unknown };
    monitor.onDragEnd?.({
      operation: {
        source: currentSource,
        target: { id: input.id, data: input.data },
      },
    });

    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledOnce();
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        relationId: 'task.project',
        subjects: [expect.objectContaining({ id: task.id })],
        target: expect.objectContaining({ id: project.id }),
      }),
    );
  });

  it('shows a stable rejection without dispatching an action for a cross-workspace target', () => {
    const registry = createActionRegistry();
    render(
      <ActionRegistryProvider registry={registry}>
        <Target object={{ ...project, organizationId: 'org-2' }} />
      </ActionRegistryProvider>,
    );

    expect(screen.getByTestId('target')).toHaveAttribute('data-drop-state', 'reject');
    expect(screen.getByTestId('target')).toHaveTextContent(
      'This item belongs to another workspace',
    );
    expect(droppableInput).toMatchObject({ collisionPriority: -1 });
  });
});
