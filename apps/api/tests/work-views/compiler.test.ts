import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { TaskWorkViewQueryRequest } from '@docket/types';

import {
  compileFilterSql,
  type ExecutableFilterNode,
  type FilterCompilerMap,
} from '../../src/lib/work-views/filter-sql';
import {
  compileSortSql,
  sortValueExpressions,
  type SortCompilerMap,
} from '../../src/lib/work-views/sort-sql';
import { taskRequest, type TaskQueryRequest } from './request-fixtures';

type FixtureField =
  'status' | 'priority' | 'title' | 'dueDate' | 'createdAt' | 'estimate' | 'archived' | 'labels';

process.env['BETTER_AUTH_SECRET'] ??= 'work-view-query-test-secret-at-least-32-characters';

const filterFields = {
  status: { kind: 'enum', value: sql.raw('status') },
  priority: { kind: 'enum', value: sql.raw('priority') },
  title: { kind: 'text', value: sql.raw('title') },
  dueDate: { kind: 'date', value: sql.raw('due_date') },
  createdAt: { kind: 'datetime', value: sql.raw('created_at') },
  estimate: { kind: 'number', value: sql.raw('estimate') },
  archived: { kind: 'boolean', value: sql.raw('archived') },
  labels: {
    kind: 'relation-many',
    exists: (operand: unknown): SQL => sql`${operand} = any(labels)`,
    isEmpty: sql`cardinality(labels) = 0`,
  },
} satisfies FilterCompilerMap<FixtureField>;

const sortFields = {
  status: {
    value: sql.raw('status'),
    cursor: z.string().nullable(),
    semanticRanks: [
      sql`case status when 'backlog' then 0 when 'todo' then 1 when 'started' then 2 else 3 end`,
      sql`case status when 'todo' then 10 when 'started' then 20 else 30 end`,
    ],
    semanticCursorSchemas: [z.number().nullable(), z.number().nullable()],
  },
  priority: {
    value: sql.raw('priority'),
    cursor: z.string().nullable(),
    semanticRanks: [
      sql`case priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end`,
    ],
    semanticCursorSchemas: [z.number().nullable()],
  },
  health: {
    value: sql.raw('health'),
    cursor: z.string().nullable(),
    semanticRanks: [
      sql`case health when 'off_track' then 0 when 'at_risk' then 1 when 'on_track' then 2 else null end`,
    ],
    semanticCursorSchemas: [z.number().nullable()],
  },
  dueDate: { value: sql.raw('due_date'), cursor: z.string().nullable() },
  title: { value: sql.raw('title'), cursor: z.string().nullable() },
} satisfies SortCompilerMap<'status' | 'priority' | 'health' | 'dueDate' | 'title'>;

let client: PGlite;
let db: ReturnType<typeof drizzle>;

async function ids(where: SQL): Promise<string[]> {
  const result = await db.execute<{ id: string }>(
    sql`select id from work_view_fixture where ${where} order by id`,
  );
  return result.rows.map((row) => row.id);
}

async function timestampIds(where: SQL, prefix?: string): Promise<string[]> {
  const transitionScope = prefix ? sql`id like ${`${prefix}-%`}` : sql`true`;
  const result = await db.execute<{ id: string }>(
    sql`select id from work_view_timestamp_fixture where ${transitionScope} and ${where} order by id`,
  );
  return result.rows.map((row) => row.id);
}

async function textIds(where: SQL): Promise<string[]> {
  const result = await db.execute<{ id: string }>(
    sql`select id from work_view_text_fixture where ${where} order by id`,
  );
  return result.rows.map((row) => row.id);
}

beforeAll(async () => {
  client = new PGlite('memory://');
  db = drizzle(client);
  await client.exec(`
    create table work_view_fixture (
      id text primary key,
      status text not null,
      priority text not null,
      health text,
      title text not null,
      due_date timestamp,
      created_at timestamp,
      estimate integer,
      archived boolean not null,
      labels text[] not null
    );
    insert into work_view_fixture values
      ('a', 'todo', 'high', 'at_risk', 'Alpha launch', '2026-08-20', '2026-08-20 06:30:00', 3, false, array['red', 'blue']),
      ('b', 'started', 'urgent', 'off_track', 'Beta repair', null, '2026-08-20 07:30:00', 8, false, array['blue']),
      ('c', 'done', 'none', 'on_track', 'Gamma archive', '2026-08-22', '2026-08-21 07:30:00', null, true, array[]::text[]);
    create table work_view_timestamp_fixture (
      id text primary key,
      created_at timestamp not null
    );
    insert into work_view_timestamp_fixture values
      ('fall-first', '2026-11-01 08:30:00'),
      ('fall-second', '2026-11-01 09:30:00'),
      ('spring-before', '2026-03-08 09:30:00'),
      ('spring-after', '2026-03-08 10:30:00'),
      ('havana-spring-before', '2026-03-08 04:30:00'),
      ('havana-spring-after', '2026-03-08 05:30:00'),
      ('havana-fall-first', '2026-11-01 04:30:00'),
      ('havana-fall-second', '2026-11-01 05:30:00');
    create table work_view_text_fixture (id text primary key, title text not null);
    insert into work_view_text_fixture values
      ('literal', E'Literal 100%_done\\\\path'),
      ('plain', 'Literal 100XXdone path');
  `);
});

afterAll(async () => client.close());

describe('work-view SQL compilers', () => {
  it('executes scalar-choice, text, temporal, number, boolean, and unary operators', async () => {
    expect(
      await ids(
        compileFilterSql(
          {
            kind: 'all',
            children: [
              {
                kind: 'predicate',
                field: 'status',
                operator: 'isAnyOf',
                operand: ['todo', 'started'],
              },
              { kind: 'predicate', field: 'priority', operator: 'isNot', operand: 'none' },
              { kind: 'predicate', field: 'title', operator: 'contains', operand: 'a' },
              {
                kind: 'predicate',
                field: 'dueDate',
                operator: 'onOrBefore',
                operand: { kind: 'absolute', value: '2026-08-20' },
              },
              { kind: 'predicate', field: 'estimate', operator: 'greaterThanOrEqual', operand: 3 },
              { kind: 'predicate', field: 'archived', operator: 'is', operand: false },
            ],
          },
          filterFields,
        ),
      ),
    ).toEqual(['a']);

    expect(
      await ids(
        compileFilterSql(
          { kind: 'predicate', field: 'estimate', operator: 'isEmpty' },
          filterFields,
        ),
      ),
    ).toEqual(['c']);

    const timestampRequest = TaskWorkViewQueryRequest.parse(
      taskRequest({
        definition: {
          ...taskRequest().definition,
          filter: {
            kind: 'predicate',
            field: 'createdAt',
            operator: 'on',
            operand: { kind: 'preset', value: 'today' },
          },
        },
      }),
    );
    expect(
      await ids(
        compileFilterSql(fixtureFilter(timestampRequest), filterFields, {
          now: new Date('2026-08-20T16:00:00.000Z'),
          timeZone: 'America/Los_Angeles',
        }),
      ),
    ).toEqual(['b']);
  });

  it('resolves validated preset and relative dates in the request timezone', async () => {
    const presetRequest = TaskWorkViewQueryRequest.parse(
      taskRequest({
        definition: {
          ...taskRequest().definition,
          filter: {
            kind: 'predicate',
            field: 'dueDate',
            operator: 'on',
            operand: { kind: 'preset', value: 'today' },
          },
        },
      }),
    );
    const relativeRequest = TaskWorkViewQueryRequest.parse(
      taskRequest({
        definition: {
          ...taskRequest().definition,
          filter: {
            kind: 'predicate',
            field: 'dueDate',
            operator: 'on',
            operand: { kind: 'relative', anchor: 'today', unit: 'day', offset: 2 },
          },
        },
      }),
    );

    expect(
      await ids(
        compileFilterSql(fixtureFilter(presetRequest), filterFields, {
          now: new Date('2026-08-20T16:00:00.000Z'),
          timeZone: 'America/Los_Angeles',
        }),
      ),
    ).toEqual(['a']);
    expect(
      await ids(
        compileFilterSql(fixtureFilter(relativeRequest), filterFields, {
          now: new Date('2026-08-20T16:00:00.000Z'),
          timeZone: 'America/Los_Angeles',
        }),
      ),
    ).toEqual(['c']);

    const todayWindow = TaskWorkViewQueryRequest.parse(
      taskRequest({
        definition: {
          ...taskRequest().definition,
          filter: {
            kind: 'predicate',
            field: 'createdAt',
            operator: 'on',
            operand: { kind: 'relative', anchor: 'today', unit: 'day', offset: 0 },
          },
        },
      }),
    );
    const nowWindow = TaskWorkViewQueryRequest.parse(
      taskRequest({
        definition: {
          ...taskRequest().definition,
          filter: {
            kind: 'predicate',
            field: 'createdAt',
            operator: 'on',
            operand: { kind: 'relative', anchor: 'now', unit: 'day', offset: 0 },
          },
        },
      }),
    );
    const temporalContext = {
      now: new Date('2026-08-20T16:00:00.000Z'),
      timeZone: 'America/Los_Angeles',
    } as const;
    expect(
      await ids(compileFilterSql(fixtureFilter(todayWindow), filterFields, temporalContext)),
    ).toEqual(['b']);
    expect(
      await ids(compileFilterSql(fixtureFilter(nowWindow), filterFields, temporalContext)),
    ).toEqual(['c']);

    const betweenRequest = TaskWorkViewQueryRequest.parse(
      taskRequest({
        definition: {
          ...taskRequest().definition,
          filter: {
            kind: 'predicate',
            field: 'createdAt',
            operator: 'between',
            operand: [
              { kind: 'preset', value: 'yesterday' },
              { kind: 'preset', value: 'today' },
            ],
          },
        },
      }),
    );
    expect(
      await ids(
        compileFilterSql(fixtureFilter(betweenRequest), filterFields, {
          now: new Date('2026-08-20T16:00:00.000Z'),
          timeZone: 'America/Los_Angeles',
        }),
      ),
    ).toEqual(['a', 'b']);
  });

  it('keeps a fall-back now anchor on the exact repeated instant', async () => {
    const timeZone = 'America/Los_Angeles';
    const fallNow = new Date('2026-11-01T09:30:00.000Z');

    expect(
      await timestampIds(
        compileFilterSql(fixtureFilter(relativeCreatedAtRequest(0)), filterFields, {
          now: fallNow,
          timeZone,
        }),
      ),
    ).toEqual(['fall-second']);
  });

  it('moves a spring-forward now window by elapsed time instead of resolving backward', async () => {
    const timeZone = 'America/Los_Angeles';
    const springNow = new Date('2026-03-07T10:30:00.000Z');

    expect(
      await timestampIds(
        compileFilterSql(fixtureFilter(relativeCreatedAtRequest(1)), filterFields, {
          now: springNow,
          timeZone,
        }),
      ),
    ).toEqual(['spring-after']);
  });

  it('disambiguates calendar-sized now shifts with the source offset', async () => {
    const timeZone = 'America/Los_Angeles';
    const fallSource = new Date('2026-10-01T08:30:00.000Z');
    const springSource = new Date('2026-02-08T10:30:00.000Z');
    const springSourceAfter = new Date('2026-04-08T09:30:00.000Z');

    expect(
      await timestampIds(
        compileFilterSql(
          fixtureFilter(relativeCreatedAtRequest(1, 'month', 'before')),
          filterFields,
          { now: fallSource, timeZone },
        ),
        'fall',
      ),
    ).toEqual([]);
    expect(
      await timestampIds(
        compileFilterSql(fixtureFilter(relativeCreatedAtRequest(1, 'month', 'on')), filterFields, {
          now: springSource,
          timeZone,
        }),
        'spring',
      ),
    ).toEqual(['spring-after']);
    expect(
      await timestampIds(
        compileFilterSql(fixtureFilter(relativeCreatedAtRequest(-1, 'month', 'on')), filterFields, {
          now: springSourceAfter,
          timeZone,
        }),
        'spring',
      ),
    ).toEqual(['spring-after']);
  });

  it('moves midnight gaps forward and chooses the first midnight in a fold', async () => {
    const calendarRequest = (operator: 'on' | 'before'): TaskQueryRequest =>
      TaskWorkViewQueryRequest.parse(
        taskRequest({
          definition: {
            ...taskRequest().definition,
            filter: {
              kind: 'predicate',
              field: 'createdAt',
              operator,
              operand: { kind: 'relative', anchor: 'today', unit: 'day', offset: 0 },
            },
          },
        }),
      );
    const timeZone = 'America/Havana';
    expect(
      await timestampIds(
        compileFilterSql(fixtureFilter(calendarRequest('on')), filterFields, {
          now: new Date('2026-03-08T17:00:00.000Z'),
          timeZone,
        }),
        'havana-spring',
      ),
    ).toEqual(['havana-spring-after']);
    expect(
      await timestampIds(
        compileFilterSql(fixtureFilter(calendarRequest('before')), filterFields, {
          now: new Date('2026-11-01T17:00:00.000Z'),
          timeZone,
        }),
        'havana-fall',
      ),
    ).not.toContain('havana-fall-first');
  });

  it('executes nested all, any, and not without flattening away meaning', async () => {
    const filter = compileFilterSql(
      {
        kind: 'all',
        children: [
          {
            kind: 'any',
            children: [
              { kind: 'predicate', field: 'status', operator: 'is', operand: 'todo' },
              { kind: 'predicate', field: 'status', operator: 'is', operand: 'started' },
            ],
          },
          {
            kind: 'not',
            child: { kind: 'predicate', field: 'title', operator: 'contains', operand: 'repair' },
          },
        ],
      },
      filterFields,
    );

    expect(await ids(filter)).toEqual(['a']);
  });

  it('treats LIKE metacharacters as literal text in contains filters', async () => {
    for (const operand of ['%', '_', '\\']) {
      expect(
        await textIds(
          compileFilterSql(
            { kind: 'predicate', field: 'title', operator: 'contains', operand },
            filterFields,
          ),
        ),
      ).toEqual(['literal']);
    }
  });

  it('uses correlated relation predicates for any, all, none, and emptiness', async () => {
    expect(
      await ids(
        compileFilterSql(
          { kind: 'predicate', field: 'labels', operator: 'includesAll', operand: ['red', 'blue'] },
          filterFields,
        ),
      ),
    ).toEqual(['a']);
    expect(
      await ids(
        compileFilterSql(
          { kind: 'predicate', field: 'labels', operator: 'includesNone', operand: ['blue'] },
          filterFields,
        ),
      ),
    ).toEqual(['c']);
    expect(
      await ids(
        compileFilterSql({ kind: 'predicate', field: 'labels', operator: 'isEmpty' }, filterFields),
      ),
    ).toEqual(['c']);
  });

  it('executes every scalar and relation operator used by validated view contracts', async () => {
    const cases: readonly (readonly [ExecutableFilterNode<FixtureField>, string[]])[] = [
      [{ kind: 'predicate', field: 'status', operator: 'isNoneOf', operand: ['done'] }, ['a', 'b']],
      [
        { kind: 'predicate', field: 'title', operator: 'notContains', operand: 'repair' },
        ['a', 'c'],
      ],
      [
        {
          kind: 'predicate',
          field: 'dueDate',
          operator: 'before',
          operand: { kind: 'absolute', value: '2026-08-22' },
        },
        ['a'],
      ],
      [{ kind: 'predicate', field: 'estimate', operator: 'lessThan', operand: 8 }, ['a']],
      [
        {
          kind: 'predicate',
          field: 'dueDate',
          operator: 'after',
          operand: { kind: 'absolute', value: '2026-08-20' },
        },
        ['c'],
      ],
      [{ kind: 'predicate', field: 'estimate', operator: 'greaterThan', operand: 3 }, ['b']],
      [{ kind: 'predicate', field: 'estimate', operator: 'after', operand: 3 }, ['b']],
      [{ kind: 'predicate', field: 'estimate', operator: 'onOrBefore', operand: 3 }, ['a']],
      [
        {
          kind: 'predicate',
          field: 'dueDate',
          operator: 'onOrAfter',
          operand: { kind: 'absolute', value: '2026-08-22' },
        },
        ['c'],
      ],
      [{ kind: 'predicate', field: 'estimate', operator: 'lessThanOrEqual', operand: 3 }, ['a']],
      [{ kind: 'predicate', field: 'estimate', operator: 'between', operand: [3, 8] }, ['a', 'b']],
      [{ kind: 'predicate', field: 'dueDate', operator: 'isNotEmpty' }, ['a', 'c']],
      [{ kind: 'predicate', field: 'labels', operator: 'includesAny', operand: ['red'] }, ['a']],
      [{ kind: 'predicate', field: 'labels', operator: 'isNotEmpty' }, ['a', 'b']],
      [{ kind: 'all', children: [] }, ['a', 'b', 'c']],
      [{ kind: 'any', children: [] }, []],
    ];

    for (const [filter, expected] of cases) {
      expect(await ids(compileFilterSql(filter, filterFields))).toEqual(expected);
    }

    expect(
      await ids(
        compileFilterSql(
          {
            kind: 'predicate',
            field: 'status',
            operator: 'is',
            operand: { kind: 'current-actor' },
          },
          filterFields,
          { currentActorId: 'todo' },
        ),
      ),
    ).toEqual(['a']);
    expect(
      await ids(
        compileFilterSql(
          {
            kind: 'predicate',
            field: 'status',
            operator: 'is',
            operand: { kind: 'actor', actorId: 'todo' },
          },
          filterFields,
        ),
      ),
    ).toEqual(['a']);
  });

  it('rejects operands and operators that bypass target validation', () => {
    expect(() =>
      compileFilterSql(
        { kind: 'predicate', field: 'status', operator: 'isAnyOf', operand: [] },
        filterFields,
      ),
    ).toThrow('A set predicate requires at least one operand');
    expect(() =>
      compileFilterSql(
        { kind: 'predicate', field: 'status', operator: 'isAnyOf', operand: 'urgent' },
        filterFields,
      ),
    ).toThrow('A set predicate requires at least one operand');
    expect(() =>
      compileFilterSql(
        { kind: 'predicate', field: 'estimate', operator: 'between', operand: [3] },
        filterFields,
      ),
    ).toThrow('A between predicate requires exactly two operands');
    expect(() =>
      compileFilterSql(
        {
          kind: 'predicate',
          field: 'status',
          operator: 'is',
          operand: { kind: 'current-actor' },
        },
        filterFields,
      ),
    ).toThrow('A current-actor filter requires an authenticated actor');
    expect(() =>
      compileFilterSql(
        { kind: 'predicate', field: 'status', operator: 'unsupported' },
        filterFields,
      ),
    ).toThrow('Unsupported enum filter operator');
    expect(() =>
      compileFilterSql(
        { kind: 'predicate', field: 'labels', operator: 'unsupported' },
        filterFields,
      ),
    ).toThrow('Unsupported relation filter operator');
  });

  it('orders semantic priority first, places nulls last, preserves multi-sort order, and ties by id', async () => {
    const order = compileSortSql(
      [
        { field: 'priority', direction: 'asc' },
        { field: 'dueDate', direction: 'desc' },
      ],
      sortFields,
      sql.raw('id'),
    );
    const result = await db.execute<{ id: string }>(
      sql`select id from work_view_fixture order by ${sql.join(order, sql`, `)}`,
    );

    expect(result.rows.map((row) => row.id)).toEqual(['b', 'a', 'c']);

    const statusOrder = compileSortSql(
      [{ field: 'status', direction: 'asc' }],
      sortFields,
      sql.raw('id'),
    );
    const statusRows = await db.execute<{ id: string }>(
      sql`select id from work_view_fixture order by ${sql.join(statusOrder, sql`, `)}`,
    );
    expect(statusRows.rows.map((row) => row.id)).toEqual(['a', 'b', 'c']);

    const healthOrder = compileSortSql(
      [{ field: 'health', direction: 'asc' }],
      sortFields,
      sql.raw('id'),
    );
    const healthRows = await db.execute<{ id: string }>(
      sql`select id from work_view_fixture order by ${sql.join(healthOrder, sql`, `)}`,
    );
    expect(healthRows.rows.map((row) => row.id)).toEqual(['b', 'a', 'c']);

    expect(sortValueExpressions([{ field: 'status', direction: 'asc' }], sortFields)).toHaveLength(
      3,
    );
  });
});
function fixtureFilter(request: TaskQueryRequest): ExecutableFilterNode<FixtureField> {
  if (!request.definition.filter) throw new TypeError('The fixture request requires a filter.');
  return request.definition.filter as ExecutableFilterNode<FixtureField>;
}

function relativeCreatedAtRequest(
  offset: number,
  unit: 'day' | 'week' | 'month' | 'quarter' | 'year' = 'day',
  operator: 'on' | 'before' = 'on',
): TaskQueryRequest {
  return TaskWorkViewQueryRequest.parse(
    taskRequest({
      definition: {
        ...taskRequest().definition,
        filter: {
          kind: 'predicate',
          field: 'createdAt',
          operator,
          operand: { kind: 'relative', anchor: 'now', unit, offset },
        },
      },
    }),
  );
}
