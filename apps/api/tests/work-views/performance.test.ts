import { describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { InitiativeWorkViewQueryRequest } from '@docket/types';
import { sql } from 'drizzle-orm';

import { queryWorkView } from '../../src/lib/work-views/query';
import { getDb, seedBaseOrg } from '../support/routes-harness';
import { programRequest, projectRequest, taskRequest } from './request-fixtures';

process.env['BETTER_AUTH_SECRET'] ??= 'work-view-performance-test-secret-at-least-32-characters';

const COUNTS = { task: 50_000, project: 5_000, program: 1_000, initiative: 1_000 } as const;
const INSERT_CHUNK = 500;
const SAMPLE_COUNT = 20;
const P95_LIMIT_MS = 300;

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
});
