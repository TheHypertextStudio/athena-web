import { describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { InitiativeWorkViewQueryRequest, WorkViewQueryResponse } from '@docket/types';
import { and, eq, gt, sql } from 'drizzle-orm';

import { queryWorkView } from '../../src/lib/work-views/query';
import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';
import { programRequest, projectRequest, taskRequest } from './request-fixtures';

process.env['BETTER_AUTH_SECRET'] ??= 'work-view-performance-test-secret-at-least-32-characters';

const COUNTS = { task: 50_000, project: 5_000, program: 1_000, initiative: 1_000 } as const;
const INSERT_CHUNK = 500;
const SAMPLE_COUNT = 20;
const P95_LIMIT_MS = 300;
const JSON_HEADERS = { 'content-type': 'application/json' };

async function grantOrganizationCapability(
  schema: typeof DbModule,
  organizationId: string,
  actorId: string,
): Promise<void> {
  await schema.db.insert(schema.grant).values({
    organizationId,
    subjectKind: 'actor',
    subjectId: actorId,
    resourceKind: 'organization',
    resourceId: organizationId,
    capabilities: ['contribute'],
    effect: 'allow',
    cascades: true,
  });
}

async function insertInChunks(
  count: number,
  insert: (start: number, size: number) => Promise<unknown>,
): Promise<void> {
  for (let start = 0; start < count; start += INSERT_CHUNK) {
    await insert(start, Math.min(INSERT_CHUNK, count - start));
  }
}

function percentile95(samples: readonly number[]): number {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? Number.POSITIVE_INFINITY;
}

async function measureWarmQuery(run: () => Promise<unknown>): Promise<number> {
  await run();
  const samples: number[] = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const started = performance.now();
    await run();
    samples.push(performance.now() - started);
  }
  return percentile95(samples);
}

describe('work-view production-size performance', () => {
  it(
    'keeps warm 100-row pages below 300ms at the release data volumes',
    { timeout: 300_000 },
    async () => {
      const schema: typeof DbModule = await getDb();
      const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);

      await insertInChunks(COUNTS.program, (start, size) =>
        schema.db.insert(schema.program).values(
          Array.from({ length: size }, (_, offset) => ({
            organizationId: orgId,
            name: `Program ${String(start + offset).padStart(4, '0')}`,
            status: 'active',
            statusId: statusId('program', 'active'),
            visibility: 'public' as const,
          })),
        ),
      );
      await insertInChunks(COUNTS.initiative, (start, size) =>
        schema.db.insert(schema.initiative).values(
          Array.from({ length: size }, (_, offset) => ({
            organizationId: orgId,
            name: `Initiative ${String(start + offset).padStart(4, '0')}`,
            status: 'active',
            statusId: statusId('initiative', 'active'),
          })),
        ),
      );
      await insertInChunks(COUNTS.project, (start, size) =>
        schema.db.insert(schema.project).values(
          Array.from({ length: size }, (_, offset) => ({
            organizationId: orgId,
            teamId,
            name: `Project ${String(start + offset).padStart(5, '0')}`,
            status: 'planned',
            statusId: statusId('project', 'planned'),
            visibility: 'public' as const,
          })),
        ),
      );
      await insertInChunks(COUNTS.task, (start, size) =>
        schema.db.insert(schema.task).values(
          Array.from({ length: size }, (_, offset) => ({
            organizationId: orgId,
            teamId,
            title: `Task ${String(start + offset).padStart(5, '0')}`,
            state: 'todo',
            statusId: statusId('task', 'todo'),
            visibility: 'public' as const,
          })),
        ),
      );
      await schema.db.execute(
        sql.raw('analyze task, project, program, initiative, work_item_order'),
      );

      const initiativeRequest = InitiativeWorkViewQueryRequest.parse({
        target: 'initiative',
        definition: {
          version: 2,
          target: 'initiative',
          filter: null,
          arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
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
      const input = { database: schema.db, organizationId: orgId, actorId: humanActorId };
      const results = {
        task: await measureWarmQuery(() =>
          queryWorkView({ ...input, request: taskRequest({ limit: 100 }) }),
        ),
        project: await measureWarmQuery(() =>
          queryWorkView({ ...input, request: projectRequest({ limit: 100 }) }),
        ),
        program: await measureWarmQuery(() =>
          queryWorkView({ ...input, request: programRequest({ limit: 100 }) }),
        ),
        initiative: await measureWarmQuery(() =>
          queryWorkView({ ...input, request: initiativeRequest }),
        ),
      };

      const failures = Object.entries(results)
        .filter(([, milliseconds]) => milliseconds > P95_LIMIT_MS)
        .map(([target, milliseconds]) => `${target}: ${milliseconds.toFixed(1)}ms`);
      expect(failures, `Work-view p95 results: ${JSON.stringify(results)}`).toEqual([]);
    },
  );

  it(
    'rebalances a fixed neighborhood inside 50,000 rows and preserves window continuation',
    { timeout: 300_000 },
    async () => {
      const schema = await getDb();
      const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
      await grantOrganizationCapability(schema, orgId, humanActorId);
      const taskStatusId = statusId('task', 'todo');
      const oldWrite = new Date('2020-01-01T00:00:00.000Z');
      await schema.db.execute(sql`insert into task (
          id, organization_id, team_id, title, state, status_id, visibility
        )
        select 'B' || lpad(series::text, 25, '0'), ${orgId}, ${teamId},
          case when series between 24940 and 25070 then 'Window ' || series else 'Bulk ' || series end,
          'todo', ${taskStatusId}, 'public'
        from generate_series(1, 50000) series`);
      await schema.db.execute(sql`insert into work_item_order (
          organization_id, context_type, context_id, target, item_id, rank, updated_at
        )
        select ${orgId}, 'organization', ${orgId}, 'task',
          'B' || lpad(series::text, 25, '0'),
          'R' || lpad((series * 1000)::text, 20, '0'), ${oldWrite}
        from generate_series(1, 50000) series`);
      const itemId = (position: number): string => `B${String(position).padStart(25, '0')}`;
      const afterId = itemId(25000);
      const beforeId = itemId(25001);
      const movedId = itemId(25070);
      const exhaustedRank = `R${String(25000 * 1000).padStart(20, '0')}`;
      await schema.db.execute(
        sql`update work_item_order set rank=${exhaustedRank}, updated_at=${oldWrite}
        where organization_id=${orgId} and item_id between ${itemId(24981)} and ${itemId(25020)}`,
      );

      const workViews = (await import('../../src/routes/work-views')).default;
      const app = appWithActor(workViews, orgId, ['contribute'], humanActorId);
      const response = await app.request('/order', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          target: 'task',
          itemId: movedId,
          context: { kind: 'organization' },
          groupField: null,
          groupValue: null,
          beforeId,
          afterId,
        }),
      });
      expect(response.status).toBe(200);
      const rewritten = await schema.db
        .select({ itemId: schema.workItemOrder.itemId })
        .from(schema.workItemOrder)
        .where(
          and(
            eq(schema.workItemOrder.organizationId, orgId),
            gt(schema.workItemOrder.updatedAt, oldWrite),
          ),
        );
      expect(rewritten.length).toBeGreaterThan(65);
      expect(rewritten.length).toBeLessThanOrEqual(129);
      await schema.db.execute(
        sql`delete from task where organization_id=${orgId} and title not like 'Window %'`,
      );

      const baseRequest = taskRequest();
      const request = taskRequest({
        definition: {
          ...baseRequest.definition,
          filter: { kind: 'predicate', field: 'title', operator: 'contains', operand: 'Window' },
        },
        limit: 100,
      });
      const expected = Array.from({ length: 131 }, (_, index) => itemId(index + 24940)).filter(
        (id) => id !== movedId,
      );
      expected.splice(expected.indexOf(afterId) + 1, 0, movedId);
      const firstResponse = await app.request('/query', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(request),
      });
      const firstPage = WorkViewQueryResponse.parse(await firstResponse.json());
      if (firstPage.target !== 'task') throw new Error('expected bounded-rank first page');
      expect(firstPage.rows.map((row) => row.id)).toEqual(expected.slice(0, 100));
      expect(firstPage.nextCursor).not.toBeNull();
      const secondResponse = await app.request('/query', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ...request, cursor: firstPage.nextCursor }),
      });
      const secondPage = WorkViewQueryResponse.parse(await secondResponse.json());
      if (secondPage.target !== 'task') throw new Error('expected bounded-rank continuation');
      expect(secondPage.rows.map((row) => row.id)).toEqual(expected.slice(100));
      expect(secondPage.nextCursor).toBeNull();
    },
  );
});
