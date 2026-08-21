import { sql, type SQL } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { TaskWorkViewQueryRequest } from '@docket/types';

import { queryWorkView } from '../../src/lib/work-views/query';
import { getDb, seedBaseOrg } from '../support/routes-harness';

process.env['BETTER_AUTH_SECRET'] ??= 'work-view-query-plan-test-secret-at-least-32-characters';

describe('work-view query plan', () => {
  let schema: typeof DbModule;

  beforeAll(async () => {
    schema = await getDb();
  });

  it('uses one shared roster statement for page, count, and groups and produces an explainable plan', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    await schema.db.insert(schema.task).values({
      organizationId: orgId,
      teamId,
      title: 'Plan probe',
      state: 'todo',
      statusId: statusId('task', 'todo'),
      visibility: 'public',
    });
    const statements: SQL[] = [];
    const countingDatabase = new Proxy(schema.db, {
      get(target, property, receiver) {
        if (property === 'execute') {
          return (statement: SQL) => {
            statements.push(statement);
            return target.execute(statement);
          };
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const request = TaskWorkViewQueryRequest.parse({
      target: 'task',
      definition: {
        version: 2,
        target: 'task',
        filter: null,
        arrangement: { groupBy: 'status', subGroupBy: null, orderBy: [] },
        presentation: {
          layout: 'list',
          properties: ['status', 'priority'],
          density: 'comfortable',
          showEmptyGroups: false,
        },
      },
      temporaryFilter: null,
      context: { kind: 'organization' },
      limit: 100,
    });

    await queryWorkView({
      database: countingDatabase,
      organizationId: orgId,
      actorId: humanActorId,
      request,
    });

    expect(statements).toHaveLength(2);
    const rosterStatement = statements[1];
    if (!rosterStatement) throw new Error('roster statement was not captured');
    const explained: unknown = await schema.db.execute(sql`explain ${rosterStatement}`);
    if (explained === null || typeof explained !== 'object') {
      throw new TypeError('EXPLAIN returned an invalid result.');
    }
    const planRows: unknown = Reflect.get(explained, 'rows');
    expect(Array.isArray(planRows) ? planRows.length : 0).toBeGreaterThan(0);
  });
});
