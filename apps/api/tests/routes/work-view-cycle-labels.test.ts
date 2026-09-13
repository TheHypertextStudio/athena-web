import { defaultCycleName } from '@docket/work/cycle-contract';
import { WorkViewFacetResponse, WorkViewQueryResponse } from '@docket/work/work-view-contract';
import { describe, expect, it } from 'vitest';

import { appWithActor, seedBaseOrg } from '../support/routes-harness';
import { taskRequest } from '../work-views/request-fixtures';
import { JSON_HEADERS, schema, workViews } from './work-views-harness';

describe('work-view cycle labels', () => {
  it('labels a group headed by an unnamed cycle with its window, never its auto-roll number', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const startsAt = new Date('2026-07-27T00:00:00.000Z');
    const endsAt = new Date('2026-08-02T23:59:59.999Z');
    const [cycleRow] = await schema.db
      .insert(schema.cycle)
      .values({
        organizationId: orgId,
        teamId,
        number: 1_000_142,
        name: null,
        startsAt,
        endsAt,
        source: 'native',
      })
      .returning({ id: schema.cycle.id });
    if (!cycleRow) throw new Error('cycle was not seeded');
    await schema.db.insert(schema.task).values({
      organizationId: orgId,
      teamId,
      title: 'Grouped under an unnamed cycle',
      state: 'todo',
      statusId: statusId('task', 'todo'),
      visibility: 'public',
      cycleId: cycleRow.id,
    });
    const app = appWithActor(workViews, orgId, ['view'], humanActorId);

    const response = await app.request('/query', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(
        taskRequest({
          definition: {
            ...taskRequest().definition,
            arrangement: { groupBy: 'cycle', subGroupBy: null, orderBy: [] },
          },
        }),
      ),
    });

    expect(response.status).toBe(200);
    const parsed = WorkViewQueryResponse.parse(await response.json());
    if (parsed.target !== 'task') throw new Error('expected a Task response');
    const group = parsed.groups.find((candidate) => candidate.key === cycleRow.id);
    expect(group?.label).toBe(defaultCycleName(startsAt, endsAt));
    expect(JSON.stringify(parsed)).not.toMatch(/Cycle \d{5,}/);
  });

  it('labels the cycle facet option for an unnamed cycle with its window, never its auto-roll number', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const startsAt = new Date('2026-12-28T00:00:00.000Z');
    const endsAt = new Date('2027-01-03T23:59:59.999Z');
    const [cycleRow] = await schema.db
      .insert(schema.cycle)
      .values({
        organizationId: orgId,
        teamId,
        number: 1_000_143,
        name: null,
        startsAt,
        endsAt,
        source: 'native',
      })
      .returning({ id: schema.cycle.id });
    if (!cycleRow) throw new Error('cycle was not seeded');
    await schema.db.insert(schema.task).values({
      organizationId: orgId,
      teamId,
      title: 'Faceted under an unnamed cycle',
      state: 'todo',
      statusId: statusId('task', 'todo'),
      visibility: 'public',
      cycleId: cycleRow.id,
    });
    const app = appWithActor(workViews, orgId, ['view'], humanActorId);

    const response = await app.request('/facets', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        fields: ['cycle'],
        definition: taskRequest().definition,
        temporaryFilter: null,
        context: { kind: 'organization' },
        limit: 100,
      }),
    });

    expect(response.status).toBe(200);
    const facets = WorkViewFacetResponse.parse(await response.json());
    const option = facets.buckets[0]?.options.find((candidate) => candidate.value === cycleRow.id);
    expect(option?.label).toBe(defaultCycleName(startsAt, endsAt));
    expect(JSON.stringify(facets)).not.toMatch(/Cycle \d{5,}/);
  });
});
