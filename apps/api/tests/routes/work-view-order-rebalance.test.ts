import { FractionalRank } from '@docket/work/work-view-contract';
import { describe, expect, it } from 'vitest';

import {
  contributorFixture,
  patchOrder,
  rankOf,
  readRanks,
  seedRank,
  seedTasks,
} from './work-view-order-fixture';
import { schema } from './work-views-harness';

describe('work-view rank rebalancing', () => {
  it('rebalances a full-length tail before appending one unranked neighbor', async () => {
    const fixture = await contributorFixture();
    const [tail, after, moved] = await seedTasks(fixture, ['Long tail', 'Unranked after', 'Moved']);
    if (!tail || !after || !moved) throw new Error('long-tail seed failed');
    await seedRank(fixture.orgId, tail, 'z'.repeat(128));

    const response = await patchOrder(fixture.app, {
      target: 'task',
      itemId: moved,
      groupField: null,
      groupValue: null,
      beforeId: null,
      afterId: after,
    });

    expect(response.status).toBe(200);
    const ranks = await readRanks(fixture.orgId);
    expect(rankOf(ranks, tail).length).toBeLessThan(128);
    expect(rankOf(ranks, tail) < rankOf(ranks, after)).toBe(true);
    expect(rankOf(ranks, after) < rankOf(ranks, moved)).toBe(true);
  });

  it('rebalances a full-length tail before appending two unranked neighbors', async () => {
    const fixture = await contributorFixture();
    const [tail, after, before, moved] = await seedTasks(fixture, [
      'Long tail',
      'Unranked after',
      'Unranked before',
      'Moved',
    ]);
    if (!tail || !after || !before || !moved) throw new Error('two-neighbor seed failed');
    await seedRank(fixture.orgId, tail, 'z'.repeat(128));

    const response = await patchOrder(fixture.app, {
      target: 'task',
      itemId: moved,
      groupField: null,
      groupValue: null,
      beforeId: before,
      afterId: after,
    });

    expect(response.status).toBe(200);
    const ranks = await readRanks(fixture.orgId);
    expect(rankOf(ranks, tail) < rankOf(ranks, after)).toBe(true);
    expect(rankOf(ranks, after) < rankOf(ranks, moved)).toBe(true);
    expect(rankOf(ranks, moved) < rankOf(ranks, before)).toBe(true);
    for (const rank of ranks.values()) expect(FractionalRank.safeParse(rank).success).toBe(true);
  });

  it('reports a conflict when every open position has already been taken', async () => {
    const fixture = await contributorFixture();
    const titles = Array.from({ length: 66 }, (_, index) => `Saturated ${index}`);
    const [moved, ...occupants] = await seedTasks(fixture, titles);
    if (!moved) throw new Error('saturated seed failed');
    await schema.db.insert(schema.workItemOrder).values(
      occupants.map((itemId, index) => ({
        organizationId: fixture.orgId,
        contextType: 'organization' as const,
        contextId: fixture.orgId,
        target: 'task' as const,
        itemId,
        rank: FractionalRank.parse('V'.repeat(index + 1)),
      })),
    );

    const response = await patchOrder(fixture.app, {
      target: 'task',
      itemId: moved,
      groupField: null,
      groupValue: null,
      beforeId: null,
      afterId: null,
    });

    expect(response.status).toBe(409);
    const ranks = await readRanks(fixture.orgId);
    expect(ranks.has(moved)).toBe(false);
  });
});
