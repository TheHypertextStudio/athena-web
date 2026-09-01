import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EntityTable } from '@docket/ui/components';
import { InitiativeViewDefinition, InitiativeViewRow } from '@docket/work/work-view-contract';

import {
  buildWorkListColumns,
  WORK_ROSTER_FIELD_WIDTH_PX,
  WORK_ROSTER_IDENTITY_MIN_WIDTH,
  WORK_ROSTER_ROW_HEIGHT,
} from '../../src/components/work-views/work-list-columns';
import {
  type ListMembership,
  workListMembershipKey,
} from '../../src/components/work-views/work-list-groups';

const definition = InitiativeViewDefinition.parse({
  version: 2,
  target: 'initiative',
  filter: null,
  arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
  presentation: {
    layout: 'list',
    properties: [
      'status',
      'priority',
      'health',
      'owner',
      'leadTeam',
      'labels',
      'targetDate',
      'updateCadence',
      'latestUpdate',
      'parent',
      'organization',
      'name',
    ],
    density: 'compact',
    showEmptyGroups: false,
  },
});

const identityOnlyDefinition = InitiativeViewDefinition.parse({
  ...definition,
  presentation: {
    ...definition.presentation,
    properties: ['name'],
  },
});

const initiative = InitiativeViewRow.parse({
  target: 'initiative',
  organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
  organization: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
  id: '01ARZ3NDEKTSV4RRFFQ69G5FC0',
  name: 'Identity contract',
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

const membership: ListMembership<'initiative'> = {
  key: workListMembershipKey([], initiative.id),
  path: [],
  row: initiative,
};

function columns(viewDefinition = definition) {
  return buildWorkListColumns({
    target: 'initiative',
    definition: viewDefinition,
    selectedIds: new Set(),
    selectionActive: false,
    isWritable: () => true,
    onToggleSelection: vi.fn(),
    statusOf: (key) => ({ key, name: 'Planned', category: 'backlog' }),
    positions: new Map(),
    rowHeight: WORK_ROSTER_ROW_HEIGHT.compact,
  });
}

function tailwindSpacingPx(element: Element, prefix: string): number {
  const className = [...element.classList].find((candidate) => candidate.startsWith(`${prefix}-`));
  if (className === undefined) {
    throw new Error(`Missing ${prefix} spacing class.`);
  }
  const step = Number(className.slice(prefix.length + 1));
  if (!Number.isFinite(step)) {
    throw new Error(`Unsupported ${className} spacing class.`);
  }
  return step * 4;
}

function identityMinWidthPx(cell: HTMLElement, containerWidthPx: number): number {
  const match = /^min\(([\d.]+)rem, calc\(100cqw - ([\d.]+)rem\)\)$/.exec(cell.style.minWidth);
  if (match === null) {
    throw new Error(`Unsupported identity width: ${cell.style.minWidth}`);
  }
  return Math.min(Number(match[1]) * 16, containerWidthPx - Number(match[2]) * 16);
}

describe('work-list column policy', () => {
  it('assigns numeric widths and monotonic priorities from cumulative container requirements', () => {
    expect(WORK_ROSTER_FIELD_WIDTH_PX).toMatchObject({
      status: 128,
      priority: 80,
      health: 96,
      owner: 176,
      leadTeam: 128,
      labels: 128,
      targetDate: 112,
      updateCadence: 128,
      latestUpdate: 176,
      parent: 128,
      organization: 128,
    });

    const metadata = columns().slice(1);
    expect(metadata.map(({ key, width, priority }) => ({ key, width, priority }))).toEqual([
      { key: 'status', width: '128px', priority: 2 },
      { key: 'priority', width: '80px', priority: 4 },
      { key: 'health', width: '96px', priority: 5 },
      { key: 'owner', width: '176px', priority: 6 },
      { key: 'leadTeam', width: '128px', priority: 7 },
      { key: 'labels', width: '128px', priority: 9 },
      { key: 'targetDate', width: '112px', priority: 9 },
      { key: 'updateCadence', width: '128px', priority: 9 },
      { key: 'latestUpdate', width: '176px', priority: 9 },
      { key: 'parent', width: '128px', priority: 9 },
      { key: 'organization', width: '128px', priority: 9 },
    ]);
    expect(metadata.map(({ priority }) => priority)).toEqual(
      [...metadata]
        .map(({ priority }) => priority)
        .sort((left, right) => Number(left) - Number(right)),
    );
  });

  it('uses one responsive identity contract for the header and root cell', () => {
    const { container } = render(
      <EntityTable
        aria-label="Initiatives"
        columns={columns()}
        rows={[membership]}
        getRowKey={({ key }) => key}
      />,
    );

    const identity = container.querySelectorAll('[data-col="identity"]');
    expect(identity).toHaveLength(2);
    identity.forEach((cell) => {
      expect(cell).toHaveStyle({ minWidth: WORK_ROSTER_IDENTITY_MIN_WIDTH });
      expect(cell.querySelector('[data-work-roster-leading-slot]')).toHaveClass(
        'size-8',
        'shrink-0',
      );
    });
    expect(screen.getByRole('columnheader', { name: 'Initiative' })).toBeVisible();
    expect(screen.getByRole('gridcell', { name: /Identity contract/ })).toBeVisible();
  });

  it('fits the identity column into a 320px container when metadata is hidden', () => {
    const viewportWidth = 320;
    render(
      <div data-testid="roster-viewport" style={{ width: `${String(viewportWidth)}px` }}>
        <EntityTable
          aria-label="Narrow initiatives"
          columns={columns(identityOnlyDefinition)}
          rows={[membership]}
          getRowKey={({ key }) => key}
        />
      </div>,
    );

    const viewport = screen.getByTestId('roster-viewport');
    const table = screen.getByRole('grid', { name: 'Narrow initiatives' });
    const identityCell = screen.getByRole('gridcell', { name: /Identity contract/ });
    const identityRow = identityCell.parentElement;
    const leadingSlot = identityCell.querySelector('[data-work-roster-leading-slot]');
    const identityContent = leadingSlot?.parentElement;
    if (
      !(identityRow instanceof HTMLElement) ||
      !(identityCell instanceof HTMLElement) ||
      !(leadingSlot instanceof HTMLElement) ||
      !(identityContent instanceof HTMLElement)
    ) {
      throw new Error('The rendered identity geometry is incomplete.');
    }

    const rowInlinePadding = tailwindSpacingPx(identityRow, 'px') * 2;
    const identityWidth = identityMinWidthPx(identityCell, viewportWidth);
    const leadingSlotWidth = tailwindSpacingPx(leadingSlot, 'size');
    const identityGap = tailwindSpacingPx(identityContent, 'gap');

    expect(viewport).toHaveStyle({ width: '320px' });
    expect(table).toHaveClass('w-full', 'overflow-x-auto');
    expect(table.querySelectorAll('[data-col]')).toHaveLength(2);
    expect(identityCell).toHaveClass('min-w-0', 'flex-1');
    expect(identityWidth + rowInlinePadding).toBeLessThanOrEqual(viewportWidth);
    expect(leadingSlotWidth + identityGap).toBeLessThan(identityWidth);
    expect(screen.queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument();
  });

  it('resolves one row height from the saved-view density', () => {
    expect(WORK_ROSTER_ROW_HEIGHT).toEqual({ compact: 44, comfortable: 56 });
  });
});
