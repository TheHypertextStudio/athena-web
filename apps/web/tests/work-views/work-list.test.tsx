import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  InitiativeViewDefinition,
  InitiativeViewRow,
  TaskViewDefinition,
  TaskViewRow,
} from '@docket/work/work-view-contract';

const relationPreview = vi.hoisted<{
  targetId: string | null;
  dropState: 'idle' | 'accept' | 'reject';
  effectLabel: string | null;
}>(() => ({
  targetId: null,
  dropState: 'idle',
  effectLabel: null,
}));

vi.mock('../../src/components/dnd/use-relation-drop-target', () => ({
  useRelationDropTarget: (options: {
    readonly target: { readonly id: string };
    readonly disabled?: boolean;
  }) => {
    const active = options.target.id === relationPreview.targetId && options.disabled !== true;
    const dropState = active ? relationPreview.dropState : 'idle';
    return {
      dropProps: {
        ref: () => undefined,
        className: '',
      },
      isOver: active,
      canDrop: active && dropState === 'accept',
      dropState,
      effectLabel: active ? relationPreview.effectLabel : null,
      relationId: null,
    };
  },
}));

import { WorkList } from '../../src/components/work-views/work-list';

const ROUTE_ORGANIZATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA0';
let viewportHeight = 360;
let restoreRect: (() => void) | undefined;
let restoreHeight: (() => void) | undefined;
let restoreWidth: (() => void) | undefined;

beforeAll(() => {
  const original = HTMLElement.prototype.getBoundingClientRect.bind(HTMLElement.prototype);
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 40,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 900,
  });
  HTMLElement.prototype.getBoundingClientRect = function getRect(): DOMRect {
    return {
      width: 900,
      height: viewportHeight,
      top: 0,
      left: 0,
      bottom: viewportHeight,
      right: 900,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  };
  restoreRect = () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
  restoreHeight = () => {
    if (height) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', height);
  };
  restoreWidth = () => {
    if (width) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', width);
  };
});

afterAll(() => {
  restoreRect?.();
  restoreHeight?.();
  restoreWidth?.();
});

afterEach(() => {
  viewportHeight = 360;
  relationPreview.targetId = null;
  relationPreview.dropState = 'idle';
  relationPreview.effectLabel = null;
});

const taskDefinition = TaskViewDefinition.parse({
  version: 2,
  target: 'task',
  filter: null,
  arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
  presentation: {
    layout: 'list',
    properties: ['status', 'priority'],
    density: 'compact',
    showEmptyGroups: false,
  },
});

function task(index: number) {
  return TaskViewRow.parse({
    target: 'task',
    organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
    id: `01ARZ3NDEKTSV4RRFFQ69${String(index).padStart(5, '0')}`,
    title: `Task ${String(index)}`,
    status: 'todo',
    priority: 'medium',
    assignee: null,
    delegate: null,
    team: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
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
    manualRank: `a${String(index)}`,
    isContext: false,
  });
}

describe('WorkList', () => {
  it('renders through the bounded shared table and activates the active row with Enter', () => {
    const onSelectionChange = vi.fn();
    const onActivate = vi.fn();
    render(
      <WorkList
        target="task"
        organizationId={ROUTE_ORGANIZATION_ID}
        definition={taskDefinition}
        rows={Array.from({ length: 500 }, (_, index) => task(index))}
        groups={[]}
        groupPages={[]}
        selectedIds={new Set()}
        onSelectionChange={onSelectionChange}
        onActivate={onActivate}
      />,
    );

    const grid = screen.getByRole('grid', { name: 'Tasks' });
    expect(screen.getByRole('columnheader', { name: 'Task' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    expect(
      screen.getByRole('checkbox', { name: 'Select Task 0' }).parentElement?.parentElement,
    ).toHaveClass('opacity-0');
    expect(screen.getAllByRole('row').length).toBeLessThan(60);
    expect(screen.getByRole('row', { name: /Task 0/ })).toHaveAttribute('data-row-height', '44');
    const taskLink = screen.getByRole('link', { name: 'Task 0' });
    expect(taskLink).toHaveAttribute(
      'href',
      '/orgs/01ARZ3NDEKTSV4RRFFQ69G5FA0/tasks/01ARZ3NDEKTSV4RRFFQ6900000',
    );
    expect(taskLink).not.toContainElement(screen.getByRole('checkbox', { name: 'Select Task 0' }));
    taskLink.addEventListener(
      'click',
      (event) => {
        event.preventDefault();
      },
      { once: true },
    );
    fireEvent.click(taskLink, { metaKey: true });
    expect(onActivate).not.toHaveBeenCalled();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledWith(task(0));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Task 0' }));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set([task(0).id]));
  });

  it('keeps context ancestors navigable without selection, write actions, or drag state', () => {
    const definition = InitiativeViewDefinition.parse({
      version: 2,
      target: 'initiative',
      filter: null,
      arrangement: { groupBy: 'status', subGroupBy: 'priority', orderBy: [] },
      presentation: {
        layout: 'list',
        properties: ['health', 'targetDate'],
        density: 'comfortable',
        showEmptyGroups: false,
      },
    });
    const parent = InitiativeViewRow.parse({
      target: 'initiative',
      organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
      organization: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
      id: '01ARZ3NDEKTSV4RRFFQ69G5FC0',
      name: 'Parent context',
      status: 'planned',
      priority: 'high',
      health: null,
      owner: null,
      leadTeam: null,
      labels: [],
      targetDate: null,
      updateCadence: 'monthly',
      latestUpdate: null,
      parent: null,
      parentLinkId: null,
      contributingProjects: [],
      manualRank: 'a0',
      isContext: true,
      updatedAt: '2026-08-23T00:00:00.000Z',
    });
    const child = InitiativeViewRow.parse({
      ...parent,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FC1',
      name: 'Matching child',
      parent: parent.id,
      isContext: false,
      manualRank: 'a1',
    });
    relationPreview.targetId = parent.id;
    relationPreview.dropState = 'accept';
    relationPreview.effectLabel = 'Move to Parent context';

    const onSelectionChange = vi.fn();
    render(
      <WorkList
        target="initiative"
        organizationId={ROUTE_ORGANIZATION_ID}
        definition={definition}
        rows={[]}
        groups={[
          { path: ['planned'], key: 'planned', label: 'Planned', count: 1 },
          { path: ['planned', 'high'], key: 'high', label: 'High', count: 1 },
        ]}
        groupPages={[
          {
            path: ['planned', 'high'],
            rows: [parent, child],
            nextCursor: null,
            loading: false,
          },
        ]}
        selectedIds={new Set([parent.id])}
        onSelectionChange={onSelectionChange}
        onActivate={vi.fn()}
      />,
    );

    const treegrid = screen.getByRole('treegrid', { name: 'Initiatives' });
    expect(treegrid).toBeVisible();
    const plannedGroup = screen.getByRole('row', { name: /Planned/ });
    expect(plannedGroup).toHaveAttribute('data-level', '0');
    expect(plannedGroup).toHaveTextContent('1');
    expect(plannedGroup).not.toHaveTextContent('2');
    expect(screen.getByRole('row', { name: /High/ })).toHaveAttribute('data-level', '1');
    const parentRow = screen.getByText('Parent context').closest('[role="row"]');
    expect(parentRow).toHaveAttribute('data-context-row', 'true');
    expect(parentRow).toHaveAttribute('aria-level', '1');
    expect(parentRow).toHaveAttribute('aria-posinset', '1');
    expect(parentRow).toHaveAttribute('aria-setsize', '1');
    expect(parentRow).toHaveAttribute('aria-expanded', 'true');
    expect(parentRow).toHaveAttribute('data-row-height', '56');
    expect(screen.getByRole('link', { name: 'Parent context' })).toHaveAttribute(
      'href',
      `/orgs/${ROUTE_ORGANIZATION_ID}/initiatives/${parent.id}`,
    );
    expect(
      screen.queryByRole('checkbox', { name: 'Select Parent context' }),
    ).not.toBeInTheDocument();
    expect(parentRow).not.toHaveAttribute('data-object-kind');
    expect(parentRow).not.toHaveAttribute('data-object-id');
    expect(parentRow).toHaveAttribute('aria-selected', 'false');
    expect(parentRow).toHaveAttribute('data-drop-state', 'idle');
    expect(parentRow).not.toHaveClass('cursor-grab');
    expect(
      screen.queryByText('Move to Parent context', { selector: '[role="status"]' }),
    ).not.toBeInTheDocument();
    const childRow = screen.getByText('Matching child').closest('[role="row"]');
    expect(childRow).toHaveAttribute('aria-level', '2');
    expect(childRow).toHaveAttribute('aria-posinset', '1');
    expect(childRow).toHaveAttribute('aria-setsize', '1');
    expect(childRow).toHaveAttribute('data-object-kind', 'initiative');
    expect(childRow).toHaveAttribute('data-object-id', child.id);
    expect(childRow).toHaveClass('cursor-grab');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Matching child' }));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set([child.id]));
    expect(screen.getByText('Matching child')).toBeVisible();
  });

  it.each([
    ['Move', 'Move to Parent', 'accept'],
    ['Link', 'Link to Initiative', 'accept'],
    ['Assign', 'Assign to Willie', 'accept'],
    ['Reject', 'This move would create a hierarchy cycle', 'reject'],
  ] as const)('shows visible row feedback for a %s preview', (_operation, label, state) => {
    const row = task(0);
    relationPreview.targetId = row.id;
    relationPreview.dropState = state;
    relationPreview.effectLabel = label;

    render(
      <WorkList
        target="task"
        organizationId={ROUTE_ORGANIZATION_ID}
        definition={taskDefinition}
        rows={[row]}
        groups={[]}
        groupPages={[]}
        selectedIds={new Set()}
        onSelectionChange={vi.fn()}
        onActivate={vi.fn()}
      />,
    );

    const status = screen.getByText(label, { selector: '[role="status"]' });
    expect(status).toBeVisible();
    expect(status).not.toHaveClass('sr-only');
    expect(status).toHaveClass('absolute');
    expect(screen.getByRole('row', { name: /Task 0/ })).toHaveAttribute('data-drop-state', state);
  });

  it('orders grouped Initiative ancestors before child-first server rows', () => {
    const definition = InitiativeViewDefinition.parse({
      version: 2,
      target: 'initiative',
      filter: null,
      arrangement: { groupBy: 'status', subGroupBy: null, orderBy: [] },
      presentation: {
        layout: 'list',
        properties: ['health'],
        density: 'compact',
        showEmptyGroups: false,
      },
    });
    const parent = InitiativeViewRow.parse({
      target: 'initiative',
      organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
      organization: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
      id: '01ARZ3NDEKTSV4RRFFQ69G5FC0',
      name: 'Parent first',
      status: 'planned',
      priority: 'high',
      health: null,
      owner: null,
      leadTeam: null,
      labels: [],
      targetDate: null,
      updateCadence: 'monthly',
      latestUpdate: null,
      parent: null,
      parentLinkId: null,
      contributingProjects: [],
      manualRank: 'a0',
      isContext: true,
      updatedAt: '2026-08-23T00:00:00.000Z',
    });
    const child = InitiativeViewRow.parse({
      ...parent,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FC1',
      name: 'Child second',
      parent: parent.id,
      manualRank: 'a1',
      isContext: false,
    });

    render(
      <WorkList
        target="initiative"
        organizationId={ROUTE_ORGANIZATION_ID}
        definition={definition}
        rows={[]}
        groups={[{ path: ['planned'], key: 'planned', label: 'Planned', count: 1 }]}
        groupPages={[
          { path: ['planned'], rows: [child, parent], nextCursor: null, loading: false },
        ]}
        selectedIds={new Set()}
        onSelectionChange={vi.fn()}
        onActivate={vi.fn()}
      />,
    );

    const labels = screen
      .getAllByRole('row')
      .map((row) => row.textContent)
      .filter((label): label is string => Boolean(label));
    expect(labels.findIndex((label) => label.includes('Parent first'))).toBeLessThan(
      labels.findIndex((label) => label.includes('Child second')),
    );
  });

  it('publishes Initiative rows through the shared object interaction contract', () => {
    const definition = InitiativeViewDefinition.parse({
      version: 2,
      target: 'initiative',
      filter: null,
      arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
      presentation: {
        layout: 'list',
        properties: ['health'],
        density: 'compact',
        showEmptyGroups: false,
      },
    });
    const parent = InitiativeViewRow.parse({
      target: 'initiative',
      organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
      organization: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
      id: '01ARZ3NDEKTSV4RRFFQ69G5FC0',
      name: 'Parent',
      status: 'planned',
      priority: 'high',
      health: null,
      owner: null,
      leadTeam: null,
      labels: [],
      targetDate: null,
      updateCadence: 'monthly',
      latestUpdate: null,
      parent: null,
      parentLinkId: null,
      contributingProjects: [],
      manualRank: 'a0',
      isContext: false,
      updatedAt: '2026-08-23T00:00:00.000Z',
    });
    const child = InitiativeViewRow.parse({
      ...parent,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FC1',
      name: 'Child',
      parent: parent.id,
      parentLinkId: '01ARZ3NDEKTSV4RRFFQ69G5FD0',
      manualRank: 'a1',
    });
    const onActivate = vi.fn();

    render(
      <WorkList
        target="initiative"
        organizationId={ROUTE_ORGANIZATION_ID}
        definition={definition}
        rows={[parent, child]}
        groups={[]}
        groupPages={[]}
        selectedIds={new Set()}
        onSelectionChange={vi.fn()}
        onActivate={onActivate}
      />,
    );

    const childRow = screen.getByText('Child').closest('[role="row"]');
    if (!(childRow instanceof HTMLElement)) {
      throw new Error('Initiative rows did not render.');
    }
    expect(childRow).toHaveAttribute('data-object-kind', 'initiative');
    expect(childRow).toHaveAttribute('data-object-id', child.id);
    expect(childRow).not.toHaveAttribute('draggable');
    expect(childRow).toHaveClass('cursor-grab');
    fireEvent.click(childRow);
    expect(onActivate).toHaveBeenCalledWith(child);
    const rails = screen.getAllByTestId('initiative-hierarchy-rail');
    expect(rails).not.toHaveLength(0);
    rails.forEach((rail) => {
      expect(rail).toHaveAttribute('aria-hidden', 'true');
    });
  });

  it('keeps duplicate context memberships and their rails independent by full path', () => {
    const definition = InitiativeViewDefinition.parse({
      version: 2,
      target: 'initiative',
      filter: null,
      arrangement: { groupBy: 'status', subGroupBy: null, orderBy: [] },
      presentation: {
        layout: 'list',
        properties: ['health'],
        density: 'compact',
        showEmptyGroups: false,
      },
    });
    const root = InitiativeViewRow.parse({
      target: 'initiative',
      organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
      organization: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
      id: '01ARZ3NDEKTSV4RRFFQ69G5FC0',
      name: 'Shared root',
      status: 'planned',
      priority: 'high',
      health: null,
      owner: null,
      leadTeam: null,
      labels: [],
      targetDate: null,
      updateCadence: 'monthly',
      latestUpdate: null,
      parent: null,
      parentLinkId: null,
      contributingProjects: [],
      manualRank: 'a0',
      isContext: true,
      updatedAt: '2026-08-23T00:00:00.000Z',
    });
    const child = InitiativeViewRow.parse({
      ...root,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FC1',
      name: 'Shared child',
      parent: root.id,
      manualRank: 'a1',
    });
    const grandchild = InitiativeViewRow.parse({
      ...root,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FC2',
      name: 'Shared grandchild',
      parent: child.id,
      manualRank: 'a2',
      isContext: false,
    });
    const later = InitiativeViewRow.parse({
      ...root,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FC3',
      name: 'Later active sibling',
      parent: root.id,
      manualRank: 'a3',
      isContext: false,
    });

    render(
      <WorkList
        target="initiative"
        organizationId={ROUTE_ORGANIZATION_ID}
        definition={definition}
        rows={[]}
        groups={[
          { path: ['active'], key: 'active', label: 'Active', count: 2 },
          { path: ['planned'], key: 'planned', label: 'Planned', count: 1 },
        ]}
        groupPages={[
          {
            path: ['active'],
            rows: [root, child, grandchild, later],
            nextCursor: null,
            loading: false,
          },
          { path: ['planned'], rows: [root, child, grandchild], nextCursor: null, loading: false },
        ]}
        selectedIds={new Set()}
        onSelectionChange={vi.fn()}
        onActivate={vi.fn()}
      />,
    );

    const grandchildRows = screen
      .getAllByText('Shared grandchild')
      .map((label) => label.closest('[role="row"]'));
    expect(grandchildRows).toHaveLength(2);
    expect(grandchildRows[0]).toHaveAttribute('data-entry-key', expect.stringContaining('active'));
    expect(grandchildRows[1]).toHaveAttribute('data-entry-key', expect.stringContaining('planned'));
    expect(grandchildRows[0]?.querySelector('[data-ancestor-rail="0"]')).not.toBeNull();
    expect(grandchildRows[1]?.querySelector('[data-ancestor-rail="0"]')).toBeNull();
  });

  it('terminates a corrupt Initiative cycle with one deterministic visible root', () => {
    const definition = InitiativeViewDefinition.parse({
      version: 2,
      target: 'initiative',
      filter: null,
      arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
      presentation: {
        layout: 'list',
        properties: [],
        density: 'compact',
        showEmptyGroups: false,
      },
    });
    const first = InitiativeViewRow.parse({
      target: 'initiative',
      organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
      organization: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
      id: '01ARZ3NDEKTSV4RRFFQ69G5FC0',
      name: 'Cycle first',
      status: 'planned',
      priority: 'high',
      health: null,
      owner: null,
      leadTeam: null,
      labels: [],
      targetDate: null,
      updateCadence: 'monthly',
      latestUpdate: null,
      parent: '01ARZ3NDEKTSV4RRFFQ69G5FC1',
      parentLinkId: null,
      contributingProjects: [],
      manualRank: 'a0',
      isContext: false,
      updatedAt: '2026-08-23T00:00:00.000Z',
    });
    const second = InitiativeViewRow.parse({
      ...first,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FC1',
      name: 'Cycle second',
      parent: first.id,
      manualRank: 'a1',
    });

    render(
      <WorkList
        target="initiative"
        organizationId={ROUTE_ORGANIZATION_ID}
        definition={definition}
        rows={[first, second]}
        groups={[]}
        groupPages={[]}
        selectedIds={new Set()}
        onSelectionChange={vi.fn()}
        onActivate={vi.fn()}
      />,
    );

    const rows = [
      screen.getByText('Cycle first').closest('[role="row"]'),
      screen.getByText('Cycle second').closest('[role="row"]'),
    ];
    expect(rows.map((row) => row?.getAttribute('aria-level'))).toEqual(['1', '2']);
    expect(rows.filter((row) => row?.getAttribute('aria-level') === '1')).toHaveLength(1);
  });

  it('renders path-scoped group continuations with server counts and keyboard activation', async () => {
    viewportHeight = 10_000;
    const definition = TaskViewDefinition.parse({
      ...taskDefinition,
      arrangement: { groupBy: 'status', subGroupBy: null, orderBy: [] },
    });
    const onLoadMore = vi.fn();
    const rows = Array.from({ length: 100 }, (_, index) => task(index));
    const props = {
      target: 'task' as const,
      organizationId: ROUTE_ORGANIZATION_ID,
      definition,
      rows: [],
      groups: [{ path: ['todo'], key: 'todo', label: 'Active', count: 101 }],
      selectedIds: new Set<string>(),
      onSelectionChange: vi.fn(),
      onActivate: vi.fn(),
      onLoadMore,
    };
    const { rerender } = render(
      <WorkList
        {...props}
        groupPages={[{ path: ['todo'], rows, nextCursor: 'next', loading: false }]}
      />,
    );

    expect(screen.getByRole('row', { name: 'Active101' })).toHaveTextContent('101');
    const grid = screen.getByRole('grid', { name: 'Tasks' });
    fireEvent.keyDown(grid, { key: 'End' });
    fireEvent.scroll(grid, { target: { scrollTop: 10_000 } });
    const loadMore = await screen.findByRole('button', { name: 'Load more Active' });
    expect(loadMore).toHaveAttribute('id', 'work-list-continuation:todo');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(onLoadMore).toHaveBeenCalledWith(['todo']);

    rerender(
      <WorkList
        {...props}
        groupPages={[{ path: ['todo'], rows, nextCursor: 'next', loading: true }]}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Loading Active' })).toHaveAttribute(
      'id',
      'work-list-continuation:todo',
    );
    expect(screen.getByRole('button', { name: 'Loading Active' })).toHaveAttribute(
      'aria-busy',
      'true',
    );

    rerender(
      <WorkList
        {...props}
        groupPages={[
          {
            path: ['todo'],
            rows,
            nextCursor: null,
            retryCursor: 'next',
            loading: false,
            error: new Error('failed'),
          },
        ]}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Retry Active' })).toHaveAttribute(
      'id',
      'work-list-continuation:todo',
    );
  });
});
