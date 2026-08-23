import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  InitiativeViewDefinition,
  InitiativeViewRow,
  TaskViewDefinition,
  TaskViewRow,
} from '@docket/types';

import { WorkList } from '../../src/components/work-views/work-list';

const VIEWPORT = 360;
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
      height: VIEWPORT,
      top: 0,
      left: 0,
      bottom: VIEWPORT,
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
  it('keeps the mounted row count bounded and selects the active row with X', () => {
    const onSelectionChange = vi.fn();
    render(
      <WorkList
        target="task"
        definition={taskDefinition}
        rows={Array.from({ length: 500 }, (_, index) => task(index))}
        groups={[]}
        groupPages={[]}
        selectedIds={new Set()}
        onSelectionChange={onSelectionChange}
        onActivate={vi.fn()}
      />,
    );

    const grid = screen.getByRole('grid', { name: 'Tasks' });
    expect(screen.getByRole('columnheader', { name: 'Task' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    expect(
      screen.getByRole('checkbox', { name: 'Select Task 0' }).parentElement?.parentElement,
    ).toHaveClass('opacity-0');
    expect(screen.getAllByRole('row').length).toBeLessThan(60);
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'x' });
    expect(onSelectionChange).toHaveBeenCalledWith(new Set([task(0).id]));
  });

  it('renders nested server groups and mutes ancestor-only Initiative context', () => {
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
      activeProjectCount: 1,
      parent: null,
      parentLinkId: null,
      contributingProjects: [],
      manualRank: 'a0',
      isContext: true,
    });
    const child = InitiativeViewRow.parse({
      ...parent,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FC1',
      name: 'Matching child',
      parent: parent.id,
      isContext: false,
      manualRank: 'a1',
    });

    render(
      <WorkList
        target="initiative"
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
        selectedIds={new Set()}
        onSelectionChange={vi.fn()}
        onActivate={vi.fn()}
      />,
    );

    expect(screen.getByRole('row', { name: /Planned/ })).toHaveAttribute('data-level', '0');
    expect(screen.getByRole('row', { name: /High/ })).toHaveAttribute('data-level', '1');
    expect(screen.getByText('Parent context').closest('[role="row"]')).toHaveAttribute(
      'data-context-row',
      'true',
    );
    expect(screen.getByText('Matching child')).toBeVisible();
  });

  it('turns an Initiative row drop into a hierarchy move', () => {
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
      activeProjectCount: 1,
      parent: null,
      parentLinkId: null,
      contributingProjects: [],
      manualRank: 'a0',
      isContext: false,
    });
    const child = InitiativeViewRow.parse({
      ...parent,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FC1',
      name: 'Child',
      parent: parent.id,
      parentLinkId: '01ARZ3NDEKTSV4RRFFQ69G5FD0',
      manualRank: 'a1',
    });
    const onInitiativeReparent = vi.fn();
    const values = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? '',
    } as unknown as DataTransfer;

    render(
      <WorkList
        target="initiative"
        definition={definition}
        rows={[parent, child]}
        groups={[]}
        groupPages={[]}
        selectedIds={new Set()}
        onSelectionChange={vi.fn()}
        onActivate={vi.fn()}
        onInitiativeReparent={onInitiativeReparent}
      />,
    );

    const childRow = screen.getByText('Child').closest('[role="row"]');
    const parentRow = screen.getByText('Parent').closest('[role="row"]');
    if (!(childRow instanceof HTMLElement) || !(parentRow instanceof HTMLElement)) {
      throw new Error('Initiative rows did not render.');
    }
    fireEvent.dragStart(childRow, { dataTransfer });
    fireEvent.drop(parentRow, { dataTransfer });

    expect(onInitiativeReparent).toHaveBeenCalledWith(
      {
        id: child.id,
        parentInitiativeId: parent.id,
        parentLinkId: child.parentLinkId,
      },
      parent.id,
    );
    expect(screen.getAllByTestId('initiative-hierarchy-rail')).not.toHaveLength(0);
  });
});
