import '@testing-library/jest-dom/vitest';

import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskViewDefinition, TaskViewRow } from '@docket/types';

import { ObjectContextMenuProvider } from '../../src/components/context-menu/object-context-menu';
import {
  objectForWorkViewRow,
  workViewRowInteractionPolicy,
} from '../../src/components/work-views/work-view-object';
import { WorkBoard } from '../../src/components/work-views/work-board';
import { ActionRegistryProvider } from '../../src/lib/actions/registry-context';
import { createActionRegistry, defineActionDomain } from '../../src/lib/actions/registry';

const dnd = vi.hoisted(() => ({
  source: null as { readonly data: unknown } | null,
  droppables: [] as unknown[],
  draggables: [] as unknown[],
  monitors: [] as { readonly onDragEnd?: (event: unknown) => void }[],
}));

vi.mock('@dnd-kit/react', () => ({
  useDragOperation: () => ({ source: dnd.source, target: null }),
  useDroppable: (input: unknown) => {
    dnd.droppables.push(input);
    return { ref: vi.fn(), isDropTarget: false };
  },
  useDraggable: (input: unknown) => {
    dnd.draggables.push(input);
    return { ref: vi.fn(), isDragging: false };
  },
  useDragDropMonitor: (handlers: { readonly onDragEnd?: (event: unknown) => void }) => {
    dnd.monitors.push(handlers);
  },
}));

const ROUTE_ORGANIZATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA0';
const FOREIGN_ORGANIZATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB0';

const definition = TaskViewDefinition.parse({
  version: 2,
  target: 'task',
  filter: null,
  arrangement: { groupBy: 'status', subGroupBy: null, orderBy: [] },
  presentation: {
    layout: 'board',
    properties: [],
    density: 'compact',
    showEmptyGroups: true,
  },
});

function task(
  id: string,
  title: string,
  organizationId = ROUTE_ORGANIZATION_ID,
  isContext = false,
) {
  return TaskViewRow.parse({
    target: 'task',
    organizationId,
    id,
    title,
    status: 'todo',
    priority: 'medium',
    assignee: null,
    delegate: null,
    team: '01ARZ3NDEKTSV4RRFFQ69G5FC0',
    project: null,
    program: null,
    cycle: null,
    milestone: null,
    parent: null,
    labels: [],
    creator: null,
    startDate: null,
    dueDate: null,
    createdAt: '2026-08-21T12:00:00.000Z',
    updatedAt: '2026-08-21T12:00:00.000Z',
    estimate: null,
    estimateMinutes: null,
    blocked: false,
    blocking: false,
    unfiled: true,
    archived: false,
    manualRank: 'a0',
    isContext,
  });
}

const local = task('01ARZ3NDEKTSV4RRFFQ69G5FD0', 'Local task');
const foreign = task('01ARZ3NDEKTSV4RRFFQ69G5FD1', 'Foreign task', FOREIGN_ORGANIZATION_ID);
const context = task('01ARZ3NDEKTSV4RRFFQ69G5FD2', 'Context task', ROUTE_ORGANIZATION_ID, true);

function rowInteraction(row: typeof local) {
  return workViewRowInteractionPolicy(row, ROUTE_ORGANIZATION_ID);
}

function menuRegistry() {
  const registry = createActionRegistry();
  registry.register(
    'task',
    defineActionDomain('task', [
      {
        id: 'task.open',
        label: 'Open task',
        objectKinds: ['task'],
        run: () => undefined,
      },
      {
        id: 'task.copy',
        label: 'Copy',
        objectKinds: ['task'],
        section: 'share',
        run: () => undefined,
      },
      {
        id: 'task.move',
        label: 'Move task',
        objectKinds: ['task'],
        section: 'organize',
        run: () => undefined,
      },
    ]),
  );
  return registry;
}

interface DndInput {
  readonly id: string;
  readonly type: string;
  readonly disabled?: boolean;
  readonly accept?: (source: { readonly data: unknown }) => boolean;
  readonly collisionPriority?: number;
  readonly data?: {
    readonly kind?: string;
    readonly path?: readonly string[];
    readonly effectLabel?: string | null;
    readonly canDrop?: boolean;
    readonly target?: { readonly id: string };
  };
}

function inputs(type: string): readonly DndInput[] {
  return dnd.droppables.filter((candidate): candidate is DndInput => {
    if (typeof candidate !== 'object' || candidate === null || !('type' in candidate)) {
      return false;
    }
    return candidate.type === type;
  });
}

function sourceFor(row: typeof local, path: readonly string[]) {
  const object = objectForWorkViewRow(row);
  return {
    data: {
      kind: 'docket-object' as const,
      object,
      objects: [object],
      sourceSurfaceId: `work-board:${JSON.stringify(path)}`,
      actionScope: rowInteraction(row).actionScope,
    },
  };
}

function renderBoard(
  onDrop = vi.fn(),
  onSelectionChange = vi.fn(),
  groupPages = [
    { path: ['todo'], rows: [local, foreign, context], nextCursor: null, loading: false },
    { path: ['started'], rows: [], nextCursor: null, loading: false },
  ],
) {
  const onActivate = vi.fn();
  const view = () => (
    <ActionRegistryProvider registry={menuRegistry()}>
      <ObjectContextMenuProvider>
        <WorkBoard
          target="task"
          definition={definition}
          totalCount={101}
          groups={[
            { path: ['todo'], key: 'todo', label: 'Todo', count: 101 },
            { path: ['started'], key: 'started', label: 'Started', count: 0 },
          ]}
          groupPages={groupPages}
          hiddenColumns={new Set()}
          selectedIds={new Set()}
          rowInteraction={rowInteraction}
          onSelectionChange={onSelectionChange}
          onCreate={vi.fn()}
          onActivate={onActivate}
          onDrop={onDrop}
          onLoadMore={vi.fn()}
        />
      </ObjectContextMenuProvider>
    </ActionRegistryProvider>
  );
  render(view());
  return { onActivate };
}

function rightClick(element: Element): MouseEvent {
  const event = createEvent.contextMenu(element, {
    clientX: 120,
    clientY: 80,
    bubbles: true,
    cancelable: true,
  });
  fireEvent(element, event);
  return event as MouseEvent;
}

beforeEach(() => {
  cleanup();
  dnd.source = null;
  dnd.droppables.length = 0;
  dnd.draggables.length = 0;
  dnd.monitors.length = 0;
});

describe('WorkBoard route-owned row interaction policy', () => {
  it('keeps foreign navigation but excludes context rows from the board and its count', () => {
    const onSelectionChange = vi.fn();
    const { onActivate } = renderBoard(vi.fn(), onSelectionChange);

    const localCard = screen.getByRole('article', { name: 'Local task' });
    const foreignCard = screen.getByRole('article', { name: 'Foreign task' });

    expect(localCard).toHaveAttribute('data-object-id', local.id);
    expect(localCard).toHaveClass('cursor-grab');
    expect(foreignCard).toHaveAttribute('data-object-id', foreign.id);
    expect(foreignCard).toHaveAttribute('data-object-action-scope', 'reference');
    expect(foreignCard).not.toHaveClass('cursor-grab');
    expect(screen.queryByRole('article', { name: 'Context task' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Todo column' })).toHaveTextContent('Todo101');
    expect(screen.getByRole('checkbox', { name: 'Select Local task' })).toBeEnabled();
    expect(screen.queryByRole('checkbox', { name: 'Select Foreign task' })).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Local task' }));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set([local.id]));

    fireEvent.click(screen.getByRole('link', { name: 'Foreign task' }));
    expect(onActivate).toHaveBeenNthCalledWith(1, foreign);

    const relationTargets = inputs('docket-relation-target');
    expect(relationTargets.find((input) => input.data?.target?.id === local.id)?.disabled).toBe(
      false,
    );
    expect(relationTargets.find((input) => input.data?.target?.id === foreign.id)?.disabled).toBe(
      true,
    );
    expect(relationTargets.find((input) => input.data?.target?.id === context.id)).toBeUndefined();
  });

  it('limits a foreign object menu to single-row Open and Copy actions', async () => {
    renderBoard();

    const foreignCard = screen.getByRole('article', { name: 'Foreign task' });
    expect(rightClick(foreignCard).defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Open task' })).toBeVisible();
    });
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Move task' })).toBeNull();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });

    expect(screen.queryByRole('article', { name: 'Context task' })).toBeNull();
  });

  it('registers mutable board destinations before a pointer drag has a source', () => {
    dnd.source = null;
    renderBoard();

    const cells = inputs('work-board-cell');
    expect(cells).toHaveLength(2);
    for (const cell of cells) {
      expect(cell.disabled).toBe(false);
      expect(cell.data?.effectLabel).toMatch(/^Move to /);
    }
  });

  it('accepts a writable source synchronously without waiting for a render', () => {
    dnd.source = null;
    renderBoard();
    const cells = inputs('work-board-cell');
    expect(cells).toHaveLength(2);
    for (const cell of cells) {
      expect(cell.collisionPriority).toBe(2);
      expect(cell.accept?.(sourceFor(local, ['todo']))).toBe(true);
      expect(cell.accept?.(sourceFor(foreign, ['todo']))).toBe(false);
    }
  });

  it('does not advertise or commit board destinations for a foreign source', () => {
    const onDrop = vi.fn();
    dnd.source = sourceFor(foreign, ['todo']);
    renderBoard(onDrop);

    const cells = inputs('work-board-cell');
    expect(cells).toHaveLength(2);
    for (const cell of cells) {
      expect(cell.disabled).toBe(false);
      expect(cell.accept?.(dnd.source)).toBe(false);
    }

    const destination = cells.find((cell) => cell.data?.path?.[0] === 'started');
    if (destination === undefined) throw new Error('expected the Started destination');
    const event = {
      operation: { source: dnd.source, target: { id: destination.id, data: destination.data } },
    };
    for (const monitor of dnd.monitors) monitor.onDragEnd?.(event);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('does not advertise or commit destinations for a reference-scoped local payload', () => {
    const onDrop = vi.fn();
    const localSource = sourceFor(local, ['todo']);
    dnd.source = {
      data: {
        ...localSource.data,
        actionScope: 'reference',
      },
    };
    renderBoard(onDrop);

    const cells = inputs('work-board-cell');
    expect(cells).toHaveLength(2);
    for (const cell of cells) {
      expect(cell.disabled).toBe(false);
      expect(cell.accept?.(dnd.source)).toBe(false);
    }

    const destination = cells.find((cell) => cell.data?.path?.[0] === 'started');
    if (destination === undefined) throw new Error('expected the Started destination');
    const event = {
      operation: { source: dnd.source, target: { id: destination.id, data: destination.data } },
    };
    for (const monitor of dnd.monitors) monitor.onDragEnd?.(event);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('does not authorize a context membership from a direct row with the same id', () => {
    const sharedId = '01ARZ3NDEKTSV4RRFFQ69G5FD3';
    const directMembership = task(sharedId, 'Direct membership');
    const contextMembership = task(sharedId, 'Context membership', ROUTE_ORGANIZATION_ID, true);
    const onDrop = vi.fn();
    dnd.source = sourceFor(contextMembership, ['started']);
    renderBoard(onDrop, vi.fn(), [
      {
        path: ['started'],
        rows: [contextMembership],
        nextCursor: null,
        loading: false,
      },
      { path: ['todo'], rows: [directMembership], nextCursor: null, loading: false },
    ]);

    const cells = inputs('work-board-cell');
    for (const cell of cells) {
      expect(cell.disabled).toBe(false);
      expect(cell.accept?.(dnd.source)).toBe(false);
    }
    const destination = cells.find((cell) => cell.data?.path?.[0] === 'todo');
    if (destination === undefined) throw new Error('expected the Todo destination');
    const event = {
      operation: { source: dnd.source, target: { id: destination.id, data: destination.data } },
    };
    for (const monitor of dnd.monitors) monitor.onDragEnd?.(event);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('accepts and commits a group-loaded local source', () => {
    const onDrop = vi.fn();
    dnd.source = sourceFor(local, ['todo']);
    renderBoard(onDrop);

    const cells = inputs('work-board-cell');
    for (const cell of cells) {
      expect(cell.disabled).toBe(false);
      expect(cell.accept?.(dnd.source)).toBe(true);
      expect(cell.data?.effectLabel).toMatch(/^Move to /);
    }

    const destination = cells.find((cell) => cell.data?.path?.[0] === 'started');
    if (destination === undefined) throw new Error('expected the Started destination');
    const event = {
      operation: { source: dnd.source, target: { id: destination.id, data: destination.data } },
    };
    for (const monitor of dnd.monitors) monitor.onDragEnd?.(event);
    expect(onDrop).toHaveBeenCalledWith({
      item: local,
      sourcePath: ['todo'],
      destinationPath: ['started'],
      beforeId: null,
      afterId: null,
    });
  });
});
