import { z } from 'zod';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  defineViewContract,
  type FilterPredicateFor,
  type LayoutFor,
  type MutableGroupKey,
} from '@docket/work/view-contract';

import {
  ActorOperand,
  createViewDefinitionSchema,
  ProjectWorkViewOrderRequest,
  ProgramWorkViewOrderRequest,
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

  it('rejects a contract that cannot supply any view fields', () => {
    const filterOnlyContract = defineViewContract({
      target: 'empty',
      layouts: ['list'],
      fields: {
        name: {
          kind: 'text',
          schema: z.string(),
          capabilities: { filter: true },
        },
      },
    });

    expect(() => createViewDefinitionSchema(filterOnlyContract)).toThrow(
      'Group fields requires at least one value',
    );
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
      search: '  launch brief  ',
      limit: 100,
    });

    expect(request.target).toBe('task');
    expect(request.search).toBe('launch brief');
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
        fields: ['status'],
        search: 'will',
        limit: 25,
        definition: TaskWorkViewQueryRequest.parse({
          target: 'task',
          definition: {
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
          },
        }).definition,
        temporaryFilter: {
          kind: 'predicate',
          field: 'priority',
          operator: 'is',
          operand: 'high',
        },
        context: { kind: 'team', teamId: ACTOR_ID },
      }),
    ).toMatchObject({
      target: 'task',
      fields: ['status'],
      context: { kind: 'team' },
    });
    expect(() =>
      TaskWorkViewFacetRequest.parse({
        target: 'task',
        fields: ['status', 'assignee'],
        definition: TaskWorkViewQueryRequest.parse({
          target: 'task',
          definition: {
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
          },
        }).definition,
        temporaryFilter: null,
        context: { kind: 'organization' },
      }),
    ).toThrow();
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
        context: { kind: 'project', projectId: ACTOR_ID },
        groupField: 'status',
        groupValue: 'active',
        beforeId: null,
        afterId: null,
      }),
    ).toMatchObject({ target: 'task', groupField: 'status', context: { kind: 'project' } });
    expect(
      TaskWorkViewOrderRequest.parse({
        target: 'task',
        itemId: ACTOR_ID,
        context: { kind: 'organization' },
        groupField: 'assignee',
        groupValue: null,
        beforeId: null,
        afterId: null,
      }),
    ).toMatchObject({ target: 'task', groupField: 'assignee', groupValue: null });
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
    expect(() =>
      ProgramWorkViewOrderRequest.parse({
        target: 'program',
        itemId: ACTOR_ID,
        context: { kind: 'team', teamId: ACTOR_ID },
        groupField: null,
        groupValue: null,
        beforeId: null,
        afterId: null,
      }),
    ).toThrow();
  });

  it('carries relation-many drag source and empty-target semantics in typed order requests', () => {
    const destination = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
    expect(
      TaskWorkViewOrderRequest.parse({
        target: 'task',
        itemId: ACTOR_ID,
        context: { kind: 'organization' },
        groupField: 'labels',
        sourceGroupValue: ACTOR_ID,
        groupValue: destination,
        beforeId: null,
        afterId: null,
      }),
    ).toMatchObject({
      groupField: 'labels',
      sourceGroupValue: ACTOR_ID,
      groupValue: destination,
    });
    expect(
      ProjectWorkViewOrderRequest.parse({
        target: 'project',
        itemId: ACTOR_ID,
        context: { kind: 'organization' },
        groupField: 'teams',
        sourceGroupValue: ACTOR_ID,
        groupValue: null,
        beforeId: null,
        afterId: null,
      }),
    ).toMatchObject({ groupField: 'teams', sourceGroupValue: ACTOR_ID, groupValue: null });
    expect(() =>
      TaskWorkViewOrderRequest.parse({
        target: 'task',
        itemId: ACTOR_ID,
        context: { kind: 'organization' },
        groupField: 'priority',
        sourceGroupValue: 'low',
        groupValue: 'high',
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

    const fallbackOnly = resolveWorkViewDefinition({
      fallback: { ...saved, filter: null },
    });
    expect(fallbackOnly.filter).toBeNull();
    const temporaryOnly = resolveWorkViewDefinition({
      fallback: { ...saved, filter: null },
      temporaryFilter: {
        kind: 'predicate',
        field: 'priority',
        operator: 'is',
        operand: 'urgent',
      },
    });
    expect(temporaryOnly.filter).toMatchObject({ field: 'priority', operand: 'urgent' });
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
