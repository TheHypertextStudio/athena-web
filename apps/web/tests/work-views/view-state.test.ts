import { describe, expect, it } from 'vitest';

import {
  InitiativeViewDefinition,
  TaskViewDefinition,
  ViewInstanceKey,
} from '@docket/work/work-view-contract';

import {
  moveSortTerm,
  parseFilterDraft,
  removePersonalViewState,
  resolveControllerViewState,
  toggleDisplayedProperty,
} from '../../src/components/work-views/view-state';

const fallback = TaskViewDefinition.parse({
  version: 2,
  target: 'task',
  filter: null,
  arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
  presentation: {
    layout: 'list',
    properties: ['status'],
    density: 'comfortable',
    showEmptyGroups: false,
  },
});

describe('typed work-view state', () => {
  it('keeps URL refinement separate while applying it after the durable filter', () => {
    const durable = TaskViewDefinition.parse({
      ...fallback,
      filter: { kind: 'predicate', field: 'priority', operator: 'is', operand: 'high' },
      arrangement: { ...fallback.arrangement, groupBy: 'status' },
    });
    const temporaryFilter = {
      kind: 'predicate',
      field: 'dueDate',
      operator: 'before',
      operand: { kind: 'preset', value: 'next-week' },
    } as const;

    const state = resolveControllerViewState({
      fallback,
      savedOrDefault: durable,
      personal: {
        arrangement: { groupBy: 'assignee' },
        presentation: { layout: 'board', density: 'compact' },
      },
      temporaryFilter,
    });

    expect(state.definition.filter).toEqual(durable.filter);
    expect(state.temporaryFilter).toEqual(temporaryFilter);
    expect(state.effectiveDefinition.filter).toMatchObject({ kind: 'all' });
    expect(state.definition.arrangement.groupBy).toBe('assignee');
    expect(state.definition.presentation).toMatchObject({ layout: 'board', density: 'compact' });
  });

  it('removes a reset personal override instead of copying the durable definition into it', () => {
    const selected = ViewInstanceKey.parse('builtin:task:01ARZ3NDEKTSV4RRFFQ69G5FAV');
    const other = ViewInstanceKey.parse('builtin:project:01ARZ3NDEKTSV4RRFFQ69G5FAV');
    const result = removePersonalViewState(
      [
        {
          instanceKey: selected,
          target: 'task',
          arrangement: { groupBy: 'status' },
          collapsedGroups: [],
          hiddenBoardColumns: [],
          favoriteViewIds: [],
        },
        {
          instanceKey: other,
          target: 'project',
          collapsedGroups: [],
          hiddenBoardColumns: [],
          favoriteViewIds: [],
        },
      ],
      selected,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.instanceKey).toBe(other);
  });

  it('rejects incomplete and field-invalid drafts before they become executable', () => {
    expect(parseFilterDraft('task', { kind: 'predicate', field: null, operator: null })).toEqual({
      success: false,
      error: 'Choose a filter property.',
    });
    expect(
      parseFilterDraft('task', {
        kind: 'predicate',
        field: 'assignee',
        operator: 'before',
        operand: { kind: 'current-actor' },
      }),
    ).toEqual({ success: false, error: 'Choose a valid Assignee operator.' });
    expect(
      parseFilterDraft('task', {
        kind: 'predicate',
        field: 'dueDate',
        operator: 'between',
        operand: [{ kind: 'preset', value: 'today' }],
      }),
    ).toEqual({ success: false, error: 'Enter both Due date endpoints.' });
  });

  it('parses nested drafts and removes operands from unary predicates', () => {
    const parsed = parseFilterDraft('task', {
      kind: 'group',
      join: 'any',
      children: [
        { kind: 'predicate', field: 'blocked', operator: 'is', operand: true },
        {
          kind: 'predicate',
          field: 'assignee',
          operator: 'isEmpty',
          operand: 'unfinished editor residue',
        },
      ],
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toMatchObject({
      kind: 'any',
      children: [
        { kind: 'predicate', field: 'assignee', operator: 'isEmpty' },
        { kind: 'predicate', field: 'blocked', operator: 'is', operand: true },
      ],
    });
    expect(JSON.stringify(parsed.data)).not.toContain('unfinished editor residue');
  });

  it('keeps every ordered sort term and reorders terms without replacing the first', () => {
    const terms = [
      { field: 'priority', direction: 'desc' },
      { field: 'dueDate', direction: 'asc' },
      { field: 'title', direction: 'asc' },
    ] as const;

    expect(moveSortTerm(terms, 2, 0)).toEqual([terms[2], terms[0], terms[1]]);
  });

  it('toggles displayed properties without duplicating or reordering the remaining keys', () => {
    expect(toggleDisplayedProperty(['status', 'priority'], 'assignee', true)).toEqual([
      'status',
      'priority',
      'assignee',
    ]);
    expect(toggleDisplayedProperty(['status', 'priority', 'assignee'], 'priority', false)).toEqual([
      'status',
      'assignee',
    ]);
    expect(toggleDisplayedProperty(['status', 'assignee'], 'status', true)).toEqual([
      'status',
      'assignee',
    ]);
  });

  it('accepts Initiative health without introducing verdict vocabulary', () => {
    const definition = InitiativeViewDefinition.parse({
      version: 2,
      target: 'initiative',
      filter: { kind: 'predicate', field: 'health', operator: 'is', operand: 'at_risk' },
      arrangement: { groupBy: 'health', subGroupBy: null, orderBy: [] },
      presentation: {
        layout: 'list',
        properties: ['health'],
        density: 'compact',
        showEmptyGroups: false,
      },
    });

    expect(JSON.stringify(definition)).toContain('health');
    expect(JSON.stringify(definition)).not.toMatch(/verdict/i);
  });
});
