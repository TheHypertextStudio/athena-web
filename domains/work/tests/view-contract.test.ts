import { z } from 'zod';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  canonicalizeFilter,
  createFilterNodeSchema,
  defineViewContract,
  type FilterNodeFor,
  type FilterPredicateFor,
  type FilterableFieldKey,
  type GroupableFieldKey,
  type LayoutFor,
  type MutableGroupKey,
  type SortableFieldKey,
  type ViewDefinitionFor,
} from '../src/view-contract';

const ActorId = z.string().brand<'ActorId'>();
const DateOperand = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('absolute'), value: z.iso.date() }),
  z.object({
    kind: z.literal('relative'),
    anchor: z.enum(['today', 'now']),
    unit: z.enum(['day', 'week', 'month', 'quarter', 'year']),
    offset: z.number().int(),
  }),
]);

const TASK_VIEW = defineViewContract({
  target: 'task',
  layouts: ['list', 'board'],
  fields: {
    status: {
      kind: 'enum',
      schema: z.enum(['backlog', 'active', 'done']),
      capabilities: {
        filter: true,
        sort: true,
        group: true,
        display: true,
        mutateGroup: true,
      },
    },
    assigneeId: {
      kind: 'relation-one',
      schema: ActorId.nullable(),
      operandSchema: z.union([ActorId, z.object({ kind: z.literal('current-actor') })]),
      capabilities: {
        filter: true,
        group: true,
        display: true,
        mutateGroup: true,
      },
    },
    dueDate: {
      kind: 'date',
      schema: z.iso.date().nullable(),
      operandSchema: DateOperand,
      capabilities: { filter: true, sort: true, display: true },
    },
    estimateMinutes: {
      kind: 'number',
      schema: z.number().int().nonnegative().nullable(),
      capabilities: { filter: true, sort: true, display: true },
    },
    title: {
      kind: 'text',
      schema: z.string(),
      capabilities: { filter: true, sort: true, display: true },
    },
    createdAt: {
      kind: 'datetime',
      schema: z.iso.datetime(),
      capabilities: { sort: true, display: true },
    },
  },
});

type TaskPredicate = FilterPredicateFor<typeof TASK_VIEW>;
type TaskViewDefinition = ViewDefinitionFor<typeof TASK_VIEW>;

const statusPredicate: TaskPredicate = {
  kind: 'predicate',
  field: 'status',
  operator: 'isAnyOf',
  operand: ['active', 'backlog'],
};

const relativeDatePredicate: TaskPredicate = {
  kind: 'predicate',
  field: 'dueDate',
  operator: 'before',
  operand: { kind: 'relative', anchor: 'today', unit: 'week', offset: 1 },
};

const emptyAssigneePredicate: TaskPredicate = {
  kind: 'predicate',
  field: 'assigneeId',
  operator: 'isEmpty',
};

describe('typed work-view contract', () => {
  it('derives capability-specific field keys from one literal contract', () => {
    expectTypeOf<FilterableFieldKey<typeof TASK_VIEW>>().toEqualTypeOf<
      'status' | 'assigneeId' | 'dueDate' | 'estimateMinutes' | 'title'
    >();
    expectTypeOf<SortableFieldKey<typeof TASK_VIEW>>().toEqualTypeOf<
      'status' | 'dueDate' | 'estimateMinutes' | 'title' | 'createdAt'
    >();
    expectTypeOf<GroupableFieldKey<typeof TASK_VIEW>>().toEqualTypeOf<'status' | 'assigneeId'>();
    expectTypeOf<MutableGroupKey<typeof TASK_VIEW>>().toEqualTypeOf<'status' | 'assigneeId'>();
    expectTypeOf<LayoutFor<typeof TASK_VIEW>>().toEqualTypeOf<'list' | 'board'>();
  });

  it('uses the derived keys and layouts throughout a view definition', () => {
    const definition = {
      version: 2,
      target: 'task',
      filter: statusPredicate,
      arrangement: {
        groupBy: 'status',
        subGroupBy: 'assigneeId',
        orderBy: [
          { field: 'status', direction: 'asc' },
          { field: 'createdAt', direction: 'desc' },
        ],
      },
      presentation: {
        layout: 'board',
        properties: ['status', 'assigneeId', 'createdAt'],
        density: 'compact',
        showEmptyGroups: false,
      },
    } as const satisfies TaskViewDefinition;

    expect(definition.arrangement.orderBy).toHaveLength(2);
  });

  it('keeps operator operands specific to the selected field', () => {
    expect(statusPredicate.operand).toEqual(['active', 'backlog']);
    expect(relativeDatePredicate.operand).toEqual({
      kind: 'relative',
      anchor: 'today',
      unit: 'week',
      offset: 1,
    });
    expect(emptyAssigneePredicate).not.toHaveProperty('operand');
  });

  it('rejects field/operator combinations and operand shapes at runtime', () => {
    const schema = createFilterNodeSchema(TASK_VIEW);

    expect(() =>
      schema.parse({
        kind: 'predicate',
        field: 'assigneeId',
        operator: 'before',
        operand: { kind: 'absolute', value: '2026-08-20' },
      }),
    ).toThrow();
    expect(() =>
      schema.parse({ kind: 'predicate', field: 'status', operator: 'isEmpty', operand: 'active' }),
    ).toThrow();
    expect(
      schema.parse({
        kind: 'all',
        children: [statusPredicate, relativeDatePredicate, emptyAssigneePredicate],
      }),
    ).toEqual({
      kind: 'all',
      children: [statusPredicate, relativeDatePredicate, emptyAssigneePredicate],
    });
  });

  it('rejects filters deeper than five groups or larger than one hundred predicates', () => {
    const schema = createFilterNodeSchema(TASK_VIEW);
    let tooDeep: unknown = statusPredicate;
    for (let depth = 0; depth < 6; depth += 1) {
      tooDeep = { kind: 'all', children: [tooDeep] };
    }

    expect(() => schema.parse(tooDeep)).toThrow(/five nested groups/i);
    expect(() =>
      schema.parse({ kind: 'all', children: Array.from({ length: 101 }, () => statusPredicate) }),
    ).toThrow(/100 predicates/i);
  });

  it('canonicalizes commutative groups without mutating the input', () => {
    const input: FilterNodeFor<typeof TASK_VIEW> = {
      kind: 'all',
      children: [
        relativeDatePredicate,
        { kind: 'all', children: [statusPredicate, statusPredicate] },
        { kind: 'not', child: { kind: 'not', child: emptyAssigneePredicate } },
      ],
    };

    const canonical = canonicalizeFilter(input);

    expect(canonical).toEqual({
      kind: 'all',
      children: [emptyAssigneePredicate, relativeDatePredicate, statusPredicate],
    });
    expect(input.children).toHaveLength(3);
  });
});

// @ts-expect-error Assignee relations do not support date comparison.
const invalidAssigneeDate: TaskPredicate = {
  kind: 'predicate',
  field: 'assigneeId',
  operator: 'before',
  operand: { kind: 'absolute', value: '2026-08-20' },
};

const invalidEmptyOperand: TaskPredicate = {
  kind: 'predicate',
  field: 'status',
  operator: 'isEmpty',
  // @ts-expect-error Unary operators cannot carry an operand.
  operand: 'active',
};

const invalidStatusValue: TaskPredicate = {
  kind: 'predicate',
  field: 'status',
  operator: 'isAnyOf',
  // @ts-expect-error A status set accepts only values from the status schema.
  operand: ['unknown'],
};

void invalidAssigneeDate;
void invalidEmptyOperand;
void invalidStatusValue;

const invalidLayout = {
  version: 2,
  target: 'task',
  filter: null,
  arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
  presentation: {
    // @ts-expect-error Task views do not support timelines.
    layout: 'timeline',
    properties: [],
    density: 'comfortable',
    showEmptyGroups: false,
  },
} as const satisfies TaskViewDefinition;

void invalidLayout;
