import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { WorkViewQueryRequest } from '@docket/work/work-view-contract';
import { queryWorkView } from '../../src/lib/work-views/query';
import { fingerprintWorkViewQuery } from '../../src/lib/work-views/cursor';
import { getDb, seedBaseOrg } from '../support/routes-harness';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
function request(target: 'task' | 'project' | 'program' | 'initiative', activeOnly?: boolean) {
  return WorkViewQueryRequest.parse({
    target,
    definition: {
      version: 2,
      target,
      filter: null,
      arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
      presentation: {
        layout: 'list',
        properties: [],
        density: 'comfortable',
        showEmptyGroups: false,
      },
    },
    context: { kind: 'organization' },
    limit: 100,
    ...(activeOnly === undefined ? {} : { activeOnly }),
  });
}
describe('explicit active work selection through the canonical query', () => {
  it.each(['task', 'project', 'program', 'initiative'] as const)(
    'omits archived %s rows before counting and pagination',
    async (kind) => {
      const f = await seedBaseOrg(schema.db, schema),
        common = { organizationId: f.orgId };
      const rows = [{ archivedAt: null }, { archivedAt: new Date('2026-10-01T00:00:00Z') }];
      if (kind === 'task')
        await schema.db.insert(schema.task).values(
          rows.map((row, i) => ({
            ...common,
            ...row,
            title: `Work ${i}`,
            teamId: f.teamId,
            state: 'todo' as const,
            statusId: f.statusId('task', 'todo'),
          })),
        );
      else if (kind === 'project')
        await schema.db.insert(schema.project).values(
          rows.map((row, i) => ({
            ...common,
            ...row,
            name: `Work ${i}`,
            teamId: f.teamId,
            status: 'planned' as const,
            statusId: f.statusId('project', 'planned'),
          })),
        );
      else if (kind === 'program')
        await schema.db.insert(schema.program).values(
          rows.map((row, i) => ({
            ...common,
            ...row,
            name: `Work ${i}`,
            status: 'active' as const,
            statusId: f.statusId('program', 'active'),
          })),
        );
      else
        await schema.db.insert(schema.initiative).values(
          rows.map((row, i) => ({
            ...common,
            ...row,
            name: `Work ${i}`,
            status: 'active' as const,
            statusId: f.statusId('initiative', 'active'),
          })),
        );
      const result = await queryWorkView({
        database: schema.db,
        organizationId: f.orgId,
        actorId: f.humanActorId,
        request: request(kind, true),
      });
      expect(result.rows).toHaveLength(1);
      expect(result.totalCount).toBe(1);
    },
  );
  it('binds active-only scope in cursors while preserving preexisting query fingerprints', () => {
    const base = request('task');
    expect(fingerprintWorkViewQuery({ ...base, activeOnly: false })).toBe(
      fingerprintWorkViewQuery(base),
    );
    expect(fingerprintWorkViewQuery({ ...base, activeOnly: true })).not.toBe(
      fingerprintWorkViewQuery(base),
    );
  });
});
