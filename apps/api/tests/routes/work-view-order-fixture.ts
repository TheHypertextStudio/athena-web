import { FractionalRank } from '@docket/work/work-view-contract';
import { eq } from 'drizzle-orm';

import { appWithActor, seedBaseOrg } from '../support/routes-harness';
import { grantOrganizationCapability, JSON_HEADERS, schema, workViews } from './work-views-harness';

/** A seeded organization from the shared route harness. */
export type SeededOrg = Awaited<ReturnType<typeof seedBaseOrg>>;
/** The work-view routes mounted for one actor. */
export type OrderApp = ReturnType<typeof appWithActor>;

/** A seeded organization with a contributor app mounted on the work-view routes. */
export interface ContributorFixture extends SeededOrg {
  readonly app: OrderApp;
}

/** Seed an organization whose human actor may contribute, with the routes mounted for it. */
export async function contributorFixture(): Promise<ContributorFixture> {
  const seeded = await seedBaseOrg(schema.db, schema);
  await grantOrganizationCapability(seeded.orgId, seeded.humanActorId, 'contribute');
  return {
    ...seeded,
    app: appWithActor(workViews, seeded.orgId, ['contribute'], seeded.humanActorId),
  };
}

/** Send one organization-context reorder. */
export async function patchOrder(app: OrderApp, body: Record<string, unknown>): Promise<Response> {
  return app.request('/order', {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ context: { kind: 'organization' }, ...body }),
  });
}

/** Seed public to-do Tasks on the organization's Team, returning their ids in order. */
export async function seedTasks(fixture: SeededOrg, titles: readonly string[]): Promise<string[]> {
  const rows = await schema.db
    .insert(schema.task)
    .values(
      titles.map((title) => ({
        organizationId: fixture.orgId,
        teamId: fixture.teamId,
        title,
        state: 'todo' as const,
        statusId: fixture.statusId('task', 'todo'),
        visibility: 'public' as const,
      })),
    )
    .returning({ id: schema.task.id });
  return rows.map((row) => row.id);
}

/** Store one Task's rank in the organization context. */
export async function seedRank(orgId: string, itemId: string, rank: string): Promise<void> {
  await schema.db.insert(schema.workItemOrder).values({
    organizationId: orgId,
    contextType: 'organization',
    contextId: orgId,
    target: 'task',
    itemId,
    rank: FractionalRank.parse(rank),
  });
}

/** Every stored rank in the organization, keyed by item id. */
export async function readRanks(orgId: string): Promise<Map<string, string>> {
  const rows = await schema.db
    .select({ itemId: schema.workItemOrder.itemId, rank: schema.workItemOrder.rank })
    .from(schema.workItemOrder)
    .where(eq(schema.workItemOrder.organizationId, orgId));
  return new Map(rows.map((row) => [row.itemId, row.rank]));
}

/** The stored rank for one item, failing when it has none. */
export function rankOf(ranks: Map<string, string>, itemId: string): string {
  const rank = ranks.get(itemId);
  if (rank === undefined) throw new Error(`no stored rank for ${itemId}`);
  return rank;
}
