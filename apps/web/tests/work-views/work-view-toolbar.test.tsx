import '@testing-library/jest-dom/vitest';

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactElement, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  InitiativeViewDefinition,
  TaskViewDefinition,
  TaskWorkViewFacetResponse,
} from '@docket/types';

import { FilterBuilder } from '../../src/components/work-views/filter-builder';
import { SortBuilder } from '../../src/components/work-views/sort-builder';
import { WorkViewToolbar } from '../../src/components/work-views/work-view-toolbar';

const taskDefinition = TaskViewDefinition.parse({
  version: 2,
  target: 'task',
  filter: { kind: 'predicate', field: 'priority', operator: 'is', operand: 'high' },
  arrangement: {
    groupBy: null,
    subGroupBy: null,
    orderBy: [
      { field: 'priority', direction: 'desc' },
      { field: 'dueDate', direction: 'asc' },
    ],
  },
  presentation: {
    layout: 'list',
    properties: ['status', 'priority', 'assignee'],
    density: 'compact',
    showEmptyGroups: false,
  },
});

const taskAssigneeFacets = TaskWorkViewFacetResponse.parse({
  target: 'task',
  buckets: [
    {
      field: 'assignee',
      options: [
        {
          value: { kind: 'actor', actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAA' },
          label: 'Alex Chen',
          count: 3,
        },
      ],
      emptyCount: 1,
      nextCursor: null,
    },
  ],
  distinctCount: 4,
});

function PaginatedFacetBuilder(): ReactElement {
  const firstOptions = Array.from({ length: 50 }, (_, index) => ({
    value: {
      kind: 'actor' as const,
      actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAA',
    },
    label: `Actor ${String(index + 1)}`,
    count: index,
  }));
  const [facets, setFacets] = useState(() =>
    TaskWorkViewFacetResponse.parse({
      target: 'task',
      buckets: [
        {
          field: 'assignee',
          options: firstOptions,
          emptyCount: 0,
          nextCursor: 'page-2',
        },
      ],
      distinctCount: 50,
    }),
  );
  return (
    <FilterBuilder
      target="task"
      open
      onOpenChange={vi.fn()}
      onApply={vi.fn()}
      facetResponse={facets}
      facetHasMore
      facetLoadingMore={false}
      onFacetRequest={vi.fn()}
      onFacetLoadMore={() => {
        setFacets(
          TaskWorkViewFacetResponse.parse({
            target: 'task',
            buckets: [
              {
                field: 'assignee',
                options: [
                  ...firstOptions,
                  {
                    value: {
                      kind: 'actor',
                      actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAB',
                    },
                    label: 'Actor 51',
                    count: 0,
                  },
                ],
                emptyCount: 0,
                nextCursor: null,
              },
            ],
            distinctCount: 51,
          }),
        );
      }}
    />
  );
}

describe('WorkViewToolbar', () => {
  let resize: ResizeObserverCallback;

  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserverMock {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe(): void {
          return undefined;
        }
        unobserve(): void {
          return undefined;
        }
        disconnect(): void {
          return undefined;
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function resizeToolbar(width: number): void {
    act(() => {
      resize([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    });
  }

  function renderToolbar(target: 'task' | 'initiative' = 'task'): void {
    if (target === 'task') {
      render(
        <WorkViewToolbar
          target="task"
          definition={taskDefinition}
          onDefinitionChange={vi.fn()}
          onSaveView={vi.fn()}
          onSetDefault={vi.fn()}
          onReset={vi.fn()}
        />,
      );
      return;
    }
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
    render(
      <WorkViewToolbar
        target="initiative"
        definition={definition}
        onDefinitionChange={vi.fn()}
        onSaveView={vi.fn()}
        onSetDefault={vi.fn()}
        onReset={vi.fn()}
      />,
    );
  }

  it('uses a non-wrapping MD3 control group and compact active-filter chips', () => {
    renderToolbar();
    resizeToolbar(1400);

    const toolbar = screen.getByRole('toolbar', { name: 'Task view controls' });
    expect(toolbar).toHaveClass('flex-nowrap');
    expect(toolbar).toHaveAttribute('data-control-size', 'sm');
    const activeFilters = screen.getByRole('list', { name: 'Active filters' });
    expect(activeFilters).toHaveAttribute('data-control-size', 'xs');
    const chip = within(activeFilters).getByText('Priority is high').closest('[data-chip-variant]');
    expect(chip).not.toBeNull();
    expect(chip).toHaveClass('text-label-small');
    expect(chip?.className).not.toMatch(/text-xs|px-\[/);
  });

  it('partitions responsive controls so overflow never duplicates visible options', async () => {
    const user = userEvent.setup();
    renderToolbar();
    resizeToolbar(600);

    const toolbar = screen.getByRole('toolbar', { name: 'Task view controls' });
    expect(within(toolbar).getByRole('button', { name: 'Filter' })).toBeVisible();
    expect(within(toolbar).getByRole('button', { name: 'Save view' })).toBeVisible();
    expect(within(toolbar).queryByRole('button', { name: 'Sort' })).not.toBeInTheDocument();
    expect(within(toolbar).queryByRole('button', { name: 'Group' })).not.toBeInTheDocument();

    const visibleLabels = within(toolbar)
      .getAllByRole('button')
      .map((button) => button.textContent.trim())
      .filter(Boolean);
    await user.click(within(toolbar).getByRole('button', { name: 'More view controls' }));
    const overflow = await screen.findByRole('menu', { name: 'More view controls' });
    const hiddenLabels = within(overflow)
      .getAllByRole('menuitem')
      .map((item) => item.textContent.trim())
      .filter(Boolean);

    expect(hiddenLabels).toEqual([
      'Sort',
      'Group',
      'Layout',
      'Properties',
      'Set as default',
      'Reset to default',
    ]);
    expect(hiddenLabels.filter((label) => visibleLabels.includes(label))).toEqual([]);
  });

  it('resets personal state from the narrow overflow', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    render(
      <WorkViewToolbar
        target="task"
        definition={taskDefinition}
        onDefinitionChange={vi.fn()}
        onSaveView={vi.fn()}
        onSetDefault={vi.fn()}
        onReset={onReset}
      />,
    );
    resizeToolbar(600);

    await user.click(screen.getByRole('button', { name: 'More view controls' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Reset to default' }));

    expect(onReset).toHaveBeenCalledOnce();
  });

  it('changes group, layout, and properties from the narrow overflow', async () => {
    const user = userEvent.setup();
    const onDefinitionChange = vi.fn();
    render(
      <WorkViewToolbar
        target="task"
        definition={taskDefinition}
        onDefinitionChange={onDefinitionChange}
        onSaveView={vi.fn()}
        onSetDefault={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    resizeToolbar(600);

    async function openControl(label: 'Group' | 'Layout' | 'Properties'): Promise<HTMLElement> {
      await user.click(screen.getByRole('button', { name: 'More view controls' }));
      await user.click(await screen.findByRole('menuitem', { name: label }));
      return screen.findByRole('dialog', { name: `${label} view` });
    }

    let dialog = await openControl('Group');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Group by' }), 'status');
    expect(onDefinitionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ arrangement: expect.objectContaining({ groupBy: 'status' }) }),
    );
    await user.keyboard('{Escape}');

    dialog = await openControl('Layout');
    await user.click(within(dialog).getByRole('radio', { name: 'Board' }));
    expect(onDefinitionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ presentation: expect.objectContaining({ layout: 'board' }) }),
    );
    expect(screen.queryByRole('dialog', { name: 'Layout view' })).not.toBeInTheDocument();

    dialog = await openControl('Properties');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Due date' }));
    expect(onDefinitionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        presentation: expect.objectContaining({
          properties: ['status', 'priority', 'assignee', 'dueDate'],
        }),
      }),
    );
  });

  it('adds an assignee filter without discarding the active priority filter', async () => {
    const user = userEvent.setup();
    const onDefinitionChange = vi.fn();
    render(
      <WorkViewToolbar
        target="task"
        definition={taskDefinition}
        facetResponse={taskAssigneeFacets}
        onFacetRequest={vi.fn()}
        onDefinitionChange={onDefinitionChange}
        onSaveView={vi.fn()}
        onSetDefault={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.click(screen.getByRole('button', { name: 'Add condition to root filter group' }));
    const fields = screen.getAllByRole('combobox', { name: 'Filter field' });
    const addedField = fields[1];
    expect(addedField).toBeDefined();
    if (!addedField) return;
    await user.selectOptions(addedField, 'assignee');
    await user.click(screen.getByRole('checkbox', { name: 'Alex Chen, 3 matches' }));
    await user.click(screen.getByRole('button', { name: 'Apply filter' }));

    expect(onDefinitionChange).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: {
          kind: 'all',
          children: [
            {
              kind: 'predicate',
              field: 'assignee',
              operator: 'is',
              operand: { kind: 'actor', actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAA' },
            },
            { kind: 'predicate', field: 'priority', operator: 'is', operand: 'high' },
          ],
        },
      }),
    );
  });

  it('reopens one active chip for editing and preserves its sibling filters', async () => {
    const user = userEvent.setup();
    const onDefinitionChange = vi.fn();
    const definition = TaskViewDefinition.parse({
      ...taskDefinition,
      filter: {
        kind: 'all',
        children: [
          { kind: 'predicate', field: 'priority', operator: 'is', operand: 'high' },
          {
            kind: 'predicate',
            field: 'assignee',
            operator: 'is',
            operand: { kind: 'actor', actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAA' },
          },
        ],
      },
    });
    const facets = TaskWorkViewFacetResponse.parse({
      target: 'task',
      buckets: [
        {
          field: 'priority',
          options: [
            { value: 'high', label: 'High', count: 4 },
            { value: 'urgent', label: 'Urgent', count: 2 },
          ],
          emptyCount: 0,
          nextCursor: null,
        },
      ],
      distinctCount: 6,
    });
    render(
      <WorkViewToolbar
        target="task"
        definition={definition}
        facetResponse={facets}
        onFacetRequest={vi.fn()}
        onDefinitionChange={onDefinitionChange}
        onSaveView={vi.fn()}
        onSetDefault={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Priority is high' }));
    await user.click(screen.getByRole('checkbox', { name: 'Urgent, 2 matches' }));
    await user.click(screen.getByRole('button', { name: 'Apply filter' }));

    const changed = onDefinitionChange.mock.lastCall?.[0];
    expect(JSON.stringify(changed?.filter)).toContain('urgent');
    expect(JSON.stringify(changed?.filter)).toContain('01ARZ3NDEKTSV4RRFFQ69G5FAA');
    expect(JSON.stringify(changed?.filter)).not.toContain('"high"');
  });

  it('renders actor and non-actor relation chips from named facet metadata', () => {
    const actorId = '01ARZ3NDEKTSV4RRFFQ69G5FAA';
    const teamId = '01ARZ3NDEKTSV4RRFFQ69G5FAB';
    const definition = TaskViewDefinition.parse({
      ...taskDefinition,
      filter: {
        kind: 'all',
        children: [
          {
            kind: 'predicate',
            field: 'assignee',
            operator: 'is',
            operand: { kind: 'actor', actorId },
          },
          { kind: 'predicate', field: 'team', operator: 'is', operand: teamId },
        ],
      },
    });
    const facets = TaskWorkViewFacetResponse.parse({
      target: 'task',
      buckets: [
        {
          field: 'assignee',
          options: [{ value: { kind: 'actor', actorId }, label: 'Alex Chen', count: 2 }],
          emptyCount: 0,
          nextCursor: null,
        },
        {
          field: 'team',
          options: [{ value: teamId, label: 'Platform', count: 5 }],
          emptyCount: 0,
          nextCursor: null,
        },
      ],
      distinctCount: 5,
    });
    render(
      <WorkViewToolbar
        target="task"
        definition={definition}
        facetResponse={facets}
        onDefinitionChange={vi.fn()}
        onSaveView={vi.fn()}
        onSetDefault={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    const active = screen.getByRole('list', { name: 'Active filters' });
    expect(active).toHaveTextContent('Alex Chen');
    expect(active).toHaveTextContent('Platform');
    expect(active).not.toHaveTextContent(actorId);
    expect(active).not.toHaveTextContent(teamId);
  });

  it('supports catalog arrow navigation, Enter, Escape, and trigger focus restoration', async () => {
    const user = userEvent.setup();
    renderToolbar();
    const trigger = screen.getByRole('button', { name: 'Filter' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Choose property' }));
    const search = screen.getByRole('searchbox', { name: 'Search filters' });
    await user.type(search, 'due');
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'Due date' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('combobox', { name: 'Filter field' })).toHaveValue('dueDate');
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });

  it('removes overflow when the measured row fits every control', () => {
    renderToolbar();
    resizeToolbar(1400);

    expect(screen.getByRole('button', { name: 'Sort' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Group' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Layout' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Properties' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Set as default' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reset to default' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'More view controls' })).not.toBeInTheDocument();
  });

  it('opens the ordered-sort editor from its visible toolbar trigger', async () => {
    const user = userEvent.setup();
    renderToolbar();
    resizeToolbar(1400);

    await user.click(screen.getByRole('button', { name: 'Sort' }));

    expect(screen.getByRole('menu', { name: 'Sort' })).toBeVisible();
  });

  it('opens grouping from its visible toolbar trigger', async () => {
    const user = userEvent.setup();
    renderToolbar();
    resizeToolbar(1400);

    await user.click(screen.getByRole('button', { name: 'Group' }));

    expect(screen.getByRole('dialog', { name: 'Group view' })).toBeVisible();
  });

  it('uses health throughout Initiative controls and never renders verdict', async () => {
    const user = userEvent.setup();
    renderToolbar('initiative');
    resizeToolbar(1400);

    await user.click(screen.getByRole('button', { name: 'Filter' }));
    const builder = await screen.findByRole('dialog', { name: 'Filter initiatives' });
    expect(within(builder).getByText('Health')).toBeVisible();
    expect(builder).not.toHaveTextContent(/verdict/i);
    expect(document.body).not.toHaveTextContent(/verdict/i);
  });
});

describe('FilterBuilder', () => {
  it('searches the target catalog and parses a nested draft before apply', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<FilterBuilder target="task" open onOpenChange={vi.fn()} onApply={onApply} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search filters' }), 'due');
    expect(screen.getByRole('button', { name: 'Due date' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Assignee' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Due date' }));
    expect(screen.getByRole('combobox', { name: 'Filter field' })).toHaveValue('dueDate');
    expect(screen.getByRole('combobox', { name: 'Filter operator' })).toHaveTextContent('Is');

    await user.clear(screen.getByRole('searchbox', { name: 'Search filters' }));
    await user.click(screen.getByRole('button', { name: 'Add group to root filter group' }));
    expect(screen.getAllByRole('group', { name: /Filter group/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Apply filter' })).toBeDisabled();
  });

  it('shows searchable named facet options with counts, including zero-count options', async () => {
    const user = userEvent.setup();
    const onFacetRequest = vi.fn();
    const facets = TaskWorkViewFacetResponse.parse({
      target: 'task',
      buckets: [
        {
          field: 'assignee',
          options: [
            {
              value: { kind: 'actor', actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAA' },
              label: 'Alex Chen',
              count: 3,
            },
            {
              value: { kind: 'actor', actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAB' },
              label: 'Willie Chalmers',
              count: 0,
            },
          ],
          emptyCount: 1,
          nextCursor: null,
        },
      ],
      distinctCount: 4,
    });
    render(
      <FilterBuilder
        target="task"
        open
        onOpenChange={vi.fn()}
        onApply={vi.fn()}
        facetResponse={facets}
        facetLoading={false}
        onFacetRequest={onFacetRequest}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Assignee' }));
    expect(screen.getByRole('checkbox', { name: 'Alex Chen, 3 matches' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Willie Chalmers, 0 matches' })).toBeVisible();
    expect(document.body).not.toHaveTextContent('01ARZ3NDEKTSV4RRFFQ69G5FAA');

    await user.type(screen.getByRole('searchbox', { name: 'Search Assignee options' }), 'will');
    expect(onFacetRequest).toHaveBeenLastCalledWith('assignee', 'will');
  });

  it('loads and exposes the fifty-first facet option', async () => {
    const user = userEvent.setup();
    render(<PaginatedFacetBuilder />);

    await user.click(screen.getByRole('button', { name: 'Assignee' }));
    expect(screen.queryByRole('checkbox', { name: 'Actor 51, 0 matches' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more Assignee options' }));
    expect(screen.getByRole('checkbox', { name: 'Actor 51, 0 matches' })).toBeVisible();
  });

  it('offers the typed current actor operand as Me', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <FilterBuilder
        target="task"
        open
        onOpenChange={vi.fn()}
        onApply={onApply}
        facetResponse={taskAssigneeFacets}
        onFacetRequest={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Assignee' }));
    await user.click(screen.getByRole('checkbox', { name: 'Me' }));
    await user.click(screen.getByRole('button', { name: 'Apply filter' }));
    expect(onApply).toHaveBeenCalledWith({
      kind: 'all',
      children: [
        {
          kind: 'predicate',
          field: 'assignee',
          operator: 'is',
          operand: { kind: 'current-actor' },
        },
      ],
    });
  });

  it('builds multi-value operands from two independent facet selections', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const facets = TaskWorkViewFacetResponse.parse({
      target: 'task',
      buckets: [
        {
          field: 'assignee',
          options: [
            {
              value: { kind: 'actor', actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAA' },
              label: 'Alex Chen',
              count: 3,
            },
            {
              value: { kind: 'actor', actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAB' },
              label: 'Willie Chalmers',
              count: 0,
            },
          ],
          emptyCount: 1,
          nextCursor: null,
        },
      ],
      distinctCount: 4,
    });
    render(
      <FilterBuilder
        target="task"
        open
        onOpenChange={vi.fn()}
        onApply={onApply}
        facetResponse={facets}
        facetLoading={false}
        onFacetRequest={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Assignee' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter operator' }), 'isAnyOf');
    await user.click(screen.getByRole('checkbox', { name: 'Alex Chen, 3 matches' }));
    await user.click(screen.getByRole('checkbox', { name: 'Willie Chalmers, 0 matches' }));
    await user.click(screen.getByRole('button', { name: 'Apply filter' }));

    expect(onApply).toHaveBeenCalledWith({
      kind: 'all',
      children: [
        {
          kind: 'predicate',
          field: 'assignee',
          operator: 'isAnyOf',
          operand: [
            { kind: 'actor', actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAA' },
            { kind: 'actor', actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAB' },
          ],
        },
      ],
    });
  });

  it('keeps two independent endpoints for range operands', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<FilterBuilder target="task" open onOpenChange={vi.fn()} onApply={onApply} />);

    await user.click(screen.getByRole('button', { name: 'Estimate' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter operator' }), 'between');
    await user.type(screen.getByRole('spinbutton', { name: 'Minimum Estimate' }), '2');
    await user.type(screen.getByRole('spinbutton', { name: 'Maximum Estimate' }), '8');
    await user.click(screen.getByRole('button', { name: 'Apply filter' }));

    expect(onApply).toHaveBeenCalledWith({
      kind: 'all',
      children: [{ kind: 'predicate', field: 'estimate', operator: 'between', operand: [2, 8] }],
    });
  });

  it('converts one datetime-local operand through the viewer timezone before apply', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <FilterBuilder
        target="task"
        timezone="America/Los_Angeles"
        open
        onOpenChange={vi.fn()}
        onApply={onApply}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Created' }));
    await user.type(screen.getByLabelText('Filter value'), '2026-08-21T09:30');
    await user.click(screen.getByRole('button', { name: 'Apply filter' }));

    expect(onApply).toHaveBeenCalledWith({
      kind: 'all',
      children: [
        {
          kind: 'predicate',
          field: 'createdAt',
          operator: 'on',
          operand: { kind: 'absolute', value: '2026-08-21T16:30:00Z' },
        },
      ],
    });
  });

  it('keeps unequal datetime range endpoints as canonical instants', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <FilterBuilder
        target="task"
        timezone="America/Los_Angeles"
        open
        onOpenChange={vi.fn()}
        onApply={onApply}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Created' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter operator' }), 'between');
    await user.type(screen.getByLabelText('Minimum Created'), '2026-08-21T09:30');
    await user.type(screen.getByLabelText('Maximum Created'), '2026-08-21T12:45');
    await user.click(screen.getByRole('button', { name: 'Apply filter' }));

    expect(onApply).toHaveBeenCalledWith({
      kind: 'all',
      children: [
        {
          kind: 'predicate',
          field: 'createdAt',
          operator: 'between',
          operand: [
            { kind: 'absolute', value: '2026-08-21T16:30:00Z' },
            { kind: 'absolute', value: '2026-08-21T19:45:00Z' },
          ],
        },
      ],
    });
  });

  it('applies named preset date operands without replacing them with absolute dates', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<FilterBuilder target="task" open onOpenChange={vi.fn()} onApply={onApply} />);

    await user.click(screen.getByRole('button', { name: 'Due date' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Date value type' }), 'preset');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Date preset' }), 'next-week');
    await user.click(screen.getByRole('button', { name: 'Apply filter' }));

    expect(onApply).toHaveBeenCalledWith({
      kind: 'all',
      children: [
        {
          kind: 'predicate',
          field: 'dueDate',
          operator: 'on',
          operand: { kind: 'preset', value: 'next-week' },
        },
      ],
    });
  });

  it('applies symbolic relative date operands with anchor, unit, and offset', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<FilterBuilder target="task" open onOpenChange={vi.fn()} onApply={onApply} />);

    await user.click(screen.getByRole('button', { name: 'Due date' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Date value type' }), 'relative');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Relative anchor' }), 'now');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Relative unit' }), 'week');
    await user.clear(screen.getByLabelText('Relative offset'));
    await user.type(screen.getByLabelText('Relative offset'), '-2');
    await user.click(screen.getByRole('button', { name: 'Apply filter' }));

    expect(onApply).toHaveBeenCalledWith({
      kind: 'all',
      children: [
        {
          kind: 'predicate',
          field: 'dueDate',
          operator: 'on',
          operand: { kind: 'relative', anchor: 'now', unit: 'week', offset: -2 },
        },
      ],
    });
  });

  it('keeps the visible relative offset and executable draft equal through repeated mode changes', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<FilterBuilder target="task" open onOpenChange={vi.fn()} onApply={onApply} />);

    await user.click(screen.getByRole('button', { name: 'Due date' }));
    const valueType = screen.getByRole('combobox', { name: 'Date value type' });
    await user.selectOptions(valueType, 'relative');
    await user.clear(screen.getByLabelText('Relative offset'));
    await user.type(screen.getByLabelText('Relative offset'), '-2');
    await user.selectOptions(valueType, 'preset');
    await user.selectOptions(valueType, 'relative');
    await user.selectOptions(valueType, 'preset');
    await user.selectOptions(valueType, 'relative');

    expect(screen.getByLabelText('Relative offset')).toHaveValue('-2');
    await user.click(screen.getByRole('button', { name: 'Apply filter' }));
    expect(onApply).toHaveBeenCalledWith({
      kind: 'all',
      children: [
        {
          kind: 'predicate',
          field: 'dueDate',
          operator: 'on',
          operand: { kind: 'relative', anchor: 'today', unit: 'day', offset: -2 },
        },
      ],
    });
  });

  it('keeps NOT attached to a child when earlier siblings are removed and later siblings are added', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<FilterBuilder target="task" open onOpenChange={vi.fn()} onApply={onApply} />);

    await user.click(screen.getByRole('button', { name: 'Advanced filter' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter field' }), 'blocked');
    await user.click(screen.getByRole('button', { name: 'Add condition to root filter group' }));
    const fields = screen.getAllByRole('combobox', { name: 'Filter field' });
    const secondField = fields[1];
    expect(secondField).toBeDefined();
    if (!secondField) return;
    await user.selectOptions(secondField, 'archived');
    await user.click(screen.getByRole('button', { name: 'Negate condition 2' }));
    await user.click(screen.getByRole('button', { name: 'Remove condition 1' }));
    await user.click(screen.getByRole('button', { name: 'Add condition to root filter group' }));
    const updatedFields = screen.getAllByRole('combobox', { name: 'Filter field' });
    const addedField = updatedFields[1];
    expect(addedField).toBeDefined();
    if (!addedField) return;
    await user.selectOptions(addedField, 'blocking');
    await user.click(screen.getByRole('button', { name: 'Apply filter' }));

    expect(onApply).toHaveBeenCalledWith({
      kind: 'all',
      children: [
        {
          kind: 'not',
          child: { kind: 'predicate', field: 'archived', operator: 'is', operand: true },
        },
        { kind: 'predicate', field: 'blocking', operator: 'is', operand: true },
      ],
    });
  });

  it('constructs and applies a nested all-any-not formula at selected nodes', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<FilterBuilder target="task" open onOpenChange={vi.fn()} onApply={onApply} />);

    await user.click(screen.getByRole('button', { name: 'Advanced filter' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter field' }), 'archived');
    await user.click(screen.getByRole('button', { name: 'Negate condition 1' }));
    await user.click(screen.getByRole('button', { name: 'Add group to root filter group' }));

    const groupOperators = screen.getAllByRole('combobox', { name: 'Filter group operator' });
    const nestedGroupOperator = groupOperators[1];
    expect(nestedGroupOperator).toBeDefined();
    if (!nestedGroupOperator) return;
    await user.selectOptions(nestedGroupOperator, 'any');
    const fieldInputs = screen.getAllByRole('combobox', { name: 'Filter field' });
    const nestedFirstField = fieldInputs[1];
    expect(nestedFirstField).toBeDefined();
    if (!nestedFirstField) return;
    await user.selectOptions(nestedFirstField, 'blocked');
    await user.click(screen.getByRole('button', { name: 'Add condition to filter group 2' }));
    const updatedFieldInputs = screen.getAllByRole('combobox', { name: 'Filter field' });
    const nestedSecondField = updatedFieldInputs[2];
    expect(nestedSecondField).toBeDefined();
    if (!nestedSecondField) return;
    await user.selectOptions(nestedSecondField, 'blocking');
    await user.click(screen.getByRole('button', { name: 'Apply filter' }));

    expect(onApply).toHaveBeenCalledWith({
      kind: 'all',
      children: [
        {
          kind: 'not',
          child: { kind: 'predicate', field: 'archived', operator: 'is', operand: true },
        },
        {
          kind: 'any',
          children: [
            { kind: 'predicate', field: 'blocked', operator: 'is', operand: true },
            { kind: 'predicate', field: 'blocking', operator: 'is', operand: true },
          ],
        },
      ],
    });
  });
});

describe('SortBuilder', () => {
  it('keeps ordered sort terms and moves one term without replacing the others', () => {
    const onChange = vi.fn();
    render(
      <SortBuilder target="task" terms={taskDefinition.arrangement.orderBy} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Move Due date before Priority' }));
    expect(onChange).toHaveBeenCalledWith([
      { field: 'dueDate', direction: 'asc' },
      { field: 'priority', direction: 'desc' },
    ]);
  });
});
