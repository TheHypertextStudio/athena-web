import { describe, expect, expectTypeOf, it } from 'vitest';

import type { FilterPredicateFor, LayoutFor, MutableGroupKey } from '@docket/work/view-contract';

import {
  ActorOperand,
  resolveWorkViewDefinition,
  TaskWorkViewFacetRequest,
  TaskWorkViewOrderRequest,
  InitiativeViewDefinition,
  RelativeDateOperand,
  TaskWorkViewQueryRequest,
  ViewInstanceKey,
  WorkViewFacetResponse,
  WorkViewQueryRequest,
  WorkViewQueryResponse,
  type InitiativeViewDefinition as InitiativeViewDefinitionType,
  type INITIATIVE_VIEW_CONTRACT,
  type InitiativeStatusKey,
  type PROGRAM_VIEW_CONTRACT,
  type PROJECT_VIEW_CONTRACT,
  type ProjectStatusKey,
  type TASK_VIEW_CONTRACT,
  type TaskStatusKey,
} from '../src/work-view';

const ACTOR_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('work-view contracts', () => {
  it('closes each target over its supported layouts', () => {
    expectTypeOf<LayoutFor<typeof TASK_VIEW_CONTRACT>>().toEqualTypeOf<'list' | 'board'>();
    expectTypeOf<LayoutFor<typeof PROJECT_VIEW_CONTRACT>>().toEqualTypeOf<
      'list' | 'board' | 'timeline'
    >();
    expectTypeOf<LayoutFor<typeof PROGRAM_VIEW_CONTRACT>>().toEqualTypeOf<'list' | 'board'>();
    expectTypeOf<LayoutFor<typeof INITIATIVE_VIEW_CONTRACT>>().toEqualTypeOf<'list' | 'timeline'>();

    expect(() =>
      InitiativeViewDefinition.parse({
        version: 2,
        target: 'initiative',
        filter: null,
        arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
        presentation: {
          layout: 'board',
          properties: [],
          density: 'comfortable',
          showEmptyGroups: false,
        },
      }),
    ).toThrow();
  });

  it('keeps symbolic actors and dates unresolved in validated filters', () => {
    expect(ActorOperand.parse({ kind: 'current-actor' })).toEqual({ kind: 'current-actor' });
    expect(ActorOperand.parse({ kind: 'actor', actorId: ACTOR_ID })).toEqual({
      kind: 'actor',
      actorId: ACTOR_ID,
    });
    expect(
      RelativeDateOperand.parse({
        kind: 'relative',
        anchor: 'today',
        unit: 'week',
        offset: 1,
      }),
    ).toEqual({ kind: 'relative', anchor: 'today', unit: 'week', offset: 1 });
  });

  it('accepts target-discriminated query and result variants', () => {
    const request = WorkViewQueryRequest.parse({
      target: 'task',
      definition: {
        version: 2,
        target: 'task',
        filter: {
          kind: 'predicate',
          field: 'assignee',
          operator: 'is',
          operand: { kind: 'current-actor' },
        },
        arrangement: {
          groupBy: 'status',
          subGroupBy: null,
          orderBy: [{ field: 'priority', direction: 'asc' }],
        },
        presentation: {
          layout: 'board',
          properties: ['priority', 'assignee', 'dueDate'],
          density: 'compact',
          showEmptyGroups: true,
        },
      },
      temporaryFilter: null,
      context: { kind: 'organization' },
      limit: 100,
    });

    expect(request.target).toBe('task');
    expect(() =>
      WorkViewQueryRequest.parse({
        ...request,
        target: 'program',
        definition: { ...request.definition, target: 'program' },
        context: { kind: 'team', teamId: ACTOR_ID },
      }),
    ).toThrow();
    expect(
      WorkViewQueryResponse.parse({
        target: 'task',
        rows: [],
        groups: [],
        totalCount: 0,
        nextCursor: null,
        queryFingerprint: 'sha256:0123456789abcdef',
      }),
    ).toMatchObject({ target: 'task', totalCount: 0 });
  });

  it('validates view instance keys and mutable group keys', () => {
    expect(ViewInstanceKey.parse('builtin:task:01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(
      'builtin:task:01ARZ3NDEKTSV4RRFFQ69G5FAV',
    );
    expect(ViewInstanceKey.parse('saved:01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(
      'saved:01ARZ3NDEKTSV4RRFFQ69G5FAV',
    );
    expect(() => ViewInstanceKey.parse('builtin:unknown:nope')).toThrow();

    expectTypeOf<MutableGroupKey<typeof PROJECT_VIEW_CONTRACT>>().toEqualTypeOf<
      'status' | 'priority' | 'lead' | 'teams' | 'labels'
    >();

    expect(
      TaskWorkViewFacetRequest.parse({
        target: 'task',
        fields: ['status', 'assignee', 'labels'],
        search: 'will',
        limit: 25,
      }),
    ).toMatchObject({ target: 'task', fields: ['status', 'assignee', 'labels'] });
    expect(
      WorkViewFacetResponse.parse({
        target: 'task',
        buckets: [
          {
            field: 'assignee',
            options: [{ value: { kind: 'actor', actorId: ACTOR_ID }, label: 'Willie', count: 12 }],
            emptyCount: 3,
            nextCursor: null,
          },
        ],
        distinctCount: 15,
      }),
    ).toMatchObject({ target: 'task', distinctCount: 15 });
    expect(
      TaskWorkViewOrderRequest.parse({
        target: 'task',
        itemId: ACTOR_ID,
        groupField: 'status',
        groupValue: 'active',
        beforeId: null,
        afterId: null,
      }),
    ).toMatchObject({ target: 'task', groupField: 'status' });
    expect(() =>
      TaskWorkViewOrderRequest.parse({
        target: 'task',
        itemId: ACTOR_ID,
        groupField: 'blocked',
        groupValue: true,
        beforeId: null,
        afterId: null,
      }),
    ).toThrow();
  });

  it('applies personal arrangement and presentation without replacing saved filters', () => {
    const saved = TaskWorkViewQueryRequest.parse({
      target: 'task',
      definition: {
        version: 2,
        target: 'task',
        filter: {
          kind: 'predicate',
          field: 'priority',
          operator: 'is',
          operand: 'high',
        },
        arrangement: { groupBy: 'status', subGroupBy: null, orderBy: [] },
        presentation: {
          layout: 'list',
          properties: ['priority'],
          density: 'comfortable',
          showEmptyGroups: false,
        },
      },
      temporaryFilter: null,
      context: { kind: 'organization' },
    }).definition;

    const resolved = resolveWorkViewDefinition({
      fallback: { ...saved, filter: null },
      savedOrDefault: saved,
      personal: {
        arrangement: { groupBy: 'assignee' },
        presentation: { layout: 'board', density: 'compact' },
      },
      temporaryFilter: {
        kind: 'predicate',
        field: 'dueDate',
        operator: 'before',
        operand: { kind: 'preset', value: 'next-week' },
      },
    });

    expect(resolved.arrangement.groupBy).toBe('assignee');
    expect(resolved.presentation).toMatchObject({ layout: 'board', density: 'compact' });
    expect(resolved.filter).toMatchObject({ kind: 'all' });
  });
});

type TaskPredicate = FilterPredicateFor<typeof TASK_VIEW_CONTRACT>;

const validTaskStatus = {
  kind: 'predicate',
  field: 'status',
  operator: 'is',
  operand: 'active' as TaskStatusKey,
} as const satisfies TaskPredicate;

const projectStatus = 'active' as ProjectStatusKey;

const invalidTaskStatus = {
  kind: 'predicate',
  field: 'status',
  operator: 'is',
  // @ts-expect-error Project status keys cannot enter Task predicates.
  operand: projectStatus,
} as const satisfies TaskPredicate;

const invalidInitiativeLayout = {
  version: 2,
  target: 'initiative',
  filter: null,
  arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
  presentation: {
    // @ts-expect-error Initiative views do not support boards.
    layout: 'board',
    properties: [],
    density: 'comfortable',
    showEmptyGroups: false,
  },
} as const satisfies InitiativeViewDefinitionType;

void validTaskStatus;
void invalidTaskStatus;
void invalidInitiativeLayout;
void (null as InitiativeStatusKey | null);
