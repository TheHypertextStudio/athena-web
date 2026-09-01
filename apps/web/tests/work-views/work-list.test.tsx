import '@testing-library/jest-dom/vitest';

import {
  fireEvent,
  render as renderElement,
  screen,
  type RenderResult,
} from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { ViewTarget } from '@docket/work/view-contract';

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

const dragBindings = vi.hoisted(() => ({
  options: [] as {
    readonly object: { readonly id: string } | null;
    readonly objects?: readonly { readonly id: string }[];
    readonly disabled?: boolean;
  }[],
}));

const relationBindings = vi.hoisted(() => ({
  options: [] as {
    readonly target: {
      readonly id: string;
      readonly kind?: string;
      readonly organizationId?: string | null;
      readonly meta?: Readonly<Record<string, unknown>>;
    };
    readonly disabled?: boolean;
  }[],
}));

const dragContext = vi.hoisted(() => ({
  objects: [] as {
    readonly kind: 'initiative';
    readonly id: string;
    readonly organizationId: string;
    readonly title: string;
  }[],
}));

vi.mock('../../src/components/dnd/drag-context', () => ({
  useDragState: () => ({ objects: dragContext.objects }),
}));

vi.mock('../../src/components/dnd/use-draggable', () => ({
  useDraggable: (options: (typeof dragBindings.options)[number]) => {
    dragBindings.options.push(options);
    return {
      ref: (element: Element | null) => {
        if (element instanceof HTMLElement && options.disabled === true) {
          element.setAttribute('aria-disabled', 'true');
        }
      },
      className: options.disabled === true ? '' : 'cursor-grab',
      'data-drag-state': 'idle',
    };
  },
}));

vi.mock('../../src/components/dnd/use-relation-drop-target', () => ({
  useRelationDropTarget: (options: {
    readonly target: {
      readonly id: string;
      readonly kind?: string;
      readonly organizationId?: string | null;
      readonly meta?: Readonly<Record<string, unknown>>;
    };
    readonly disabled?: boolean;
  }) => {
    relationBindings.options.push(options);
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
import { SelectionProvider } from '../../src/components/selection';
import type {
  WorkViewGroupPage,
  WorkViewRowFor,
} from '../../src/components/work-views/renderer-types';
import { workViewSelectionObjects } from '../../src/components/work-views/work-view-object';

const ROUTE_ORGANIZATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA0';
let viewportHeight = 360;
let restoreRect: (() => void) | undefined;
let restoreHeight: (() => void) | undefined;
let restoreWidth: (() => void) | undefined;

function withSelection(element: ReactElement): ReactNode {
  const props = element.props as {
    readonly organizationId: string;
    readonly rows: readonly WorkViewRowFor<ViewTarget>[];
    readonly groupPages: readonly WorkViewGroupPage<ViewTarget>[];
  };
  const rows = [...props.rows, ...props.groupPages.flatMap((page) => page.rows)];
  return (
    <SelectionProvider
      surfaceId={`${props.organizationId}:list:test`}
      organizationId={props.organizationId}
      actionScope="all"
      items={workViewSelectionObjects(rows, props.organizationId)}
    >
      {element}
    </SelectionProvider>
  );
}

function render(element: ReactElement): RenderResult {
  const result = renderElement(withSelection(element));
  return {
    ...result,
    rerender: (next: ReactNode) => {
      result.rerender(withSelection(next as ReactElement));
    },
  };
}

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
  dragBindings.options.length = 0;
  relationBindings.options.length = 0;
  dragContext.objects.length = 0;
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
    const onActivate = vi.fn();
    render(
      <WorkList
        target="task"
        organizationId={ROUTE_ORGANIZATION_ID}
        definition={taskDefinition}
        rows={Array.from({ length: 500 }, (_, index) => task(index))}
        groups={[]}
        groupPages={[]}
        canContribute
        onActivate={onActivate}
      />,
    );

    const grid = screen.getByRole('grid', { name: 'Tasks' });
    expect(grid).toHaveStyle({ '--row-py': '6px' });
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
    expect(screen.getByRole('checkbox', { name: 'Select Task 0' })).toBeChecked();
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
        canContribute
        onActivate={vi.fn()}
      />,
    );

    const treegrid = screen.getByRole('treegrid', { name: 'Initiatives' });
    expect(treegrid).toBeVisible();
    expect(treegrid).toHaveStyle({ '--row-py': '12px' });
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
    expect(screen.getByRole('checkbox', { name: 'Select Matching child' })).toBeChecked();
    expect(screen.getByText('Matching child')).toBeVisible();
  });

  it('carries selected route rows in one drag and keeps a foreign direct row reference-only', () => {
    const first = task(0);
    const second = task(1);
    const foreign = TaskViewRow.parse({
      ...task(2),
      organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FC0',
      title: 'Foreign direct task',
    });
    render(
      <WorkList
        target="task"
        organizationId={ROUTE_ORGANIZATION_ID}
        definition={taskDefinition}
        rows={[first, second, foreign]}
        groups={[]}
        groupPages={[]}
        canContribute
        onActivate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Task 0' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Task 1' }));
    const selectedDrag = dragBindings.options.find(
      (binding) =>
        binding.object?.id === first.id &&
        binding.objects?.length === 2 &&
        binding.objects.every(({ id }) => id === first.id || id === second.id),
    );
    expect(selectedDrag?.objects?.map(({ id }) => id)).toEqual([first.id, second.id]);

    const foreignLink = screen.getByRole('link', { name: 'Foreign direct task' });
    expect(foreignLink).toHaveAttribute(
      'href',
      `/orgs/${foreign.organizationId}/tasks/${foreign.id}`,
    );
    const foreignRow = foreignLink.closest<HTMLElement>('[role="row"]');
    expect(foreignRow).toHaveAttribute('data-object-action-scope', 'reference');
    expect(foreignRow).not.toHaveAttribute('aria-disabled');
    expect(foreignRow).not.toHaveClass('cursor-grab');
    expect(
      screen.queryByRole('checkbox', { name: 'Select Foreign direct task' }),
    ).not.toBeInTheDocument();
    expect(
      dragBindings.options.find((binding) => binding.object?.id === foreign.id)?.disabled,
    ).toBe(true);
  });

  it('uses the route owner for the Initiative root target and the row owner for navigation', () => {
    const foreignOrganizationId = '01ARZ3NDEKTSV4RRFFQ69G5FC0';
    const initiative = InitiativeViewRow.parse({
      target: 'initiative',
      organizationId: foreignOrganizationId,
      organization: foreignOrganizationId,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FC1',
      name: 'Readable foreign Initiative',
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

    render(
      <WorkList
        target="initiative"
        organizationId={ROUTE_ORGANIZATION_ID}
        definition={definition}
        rows={[initiative]}
        groups={[]}
        groupPages={[]}
        canContribute
        onActivate={vi.fn()}
      />,
    );

    expect(
      relationBindings.options.find(({ target }) => target.kind === 'initiative_root')?.target,
    ).toMatchObject({
      id: `${ROUTE_ORGANIZATION_ID}:initiative-root`,
      organizationId: ROUTE_ORGANIZATION_ID,
    });
    expect(screen.getByRole('link', { name: initiative.name })).toHaveAttribute(
      'href',
      `/orgs/${foreignOrganizationId}/initiatives/${initiative.id}`,
    );
  });

  it('marks a proven Initiative cycle and leaves an incomplete hierarchy for API authority', () => {
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
    const ancestor = InitiativeViewRow.parse({
      target: 'initiative',
      organizationId: ROUTE_ORGANIZATION_ID,
      organization: ROUTE_ORGANIZATION_ID,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FC2',
      name: 'Ancestor',
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
    const descendant = InitiativeViewRow.parse({
      ...ancestor,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FC3',
      name: 'Known descendant',
      parent: ancestor.id,
      manualRank: 'a1',
    });
    const incomplete = InitiativeViewRow.parse({
      ...ancestor,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FC4',
      name: 'Incomplete hierarchy',
      parent: '01ARZ3NDEKTSV4RRFFQ69G5FC5',
      manualRank: 'a2',
    });
    dragContext.objects.push({
      kind: 'initiative',
      id: ancestor.id,
      organizationId: ROUTE_ORGANIZATION_ID,
      title: ancestor.name,
    });

    render(
      <WorkList
        target="initiative"
        organizationId={ROUTE_ORGANIZATION_ID}
        definition={definition}
        rows={[ancestor, descendant, incomplete]}
        groups={[]}
        groupPages={[]}
        canContribute
        onActivate={vi.fn()}
      />,
    );

    const descendantTarget = relationBindings.options.find(
      ({ target }) => target.id === descendant.id,
    )?.target;
    const incompleteTarget = relationBindings.options.find(
      ({ target }) => target.id === incomplete.id,
    )?.target;
    expect(descendantTarget?.meta).toMatchObject({ wouldCreateCycle: true });
    expect(incompleteTarget?.meta?.['wouldCreateCycle']).not.toBe(true);
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
        canContribute
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
        canContribute
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
        canContribute
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
        canContribute
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
        canContribute
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
      canContribute: true,
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
