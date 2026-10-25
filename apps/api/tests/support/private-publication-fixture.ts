import type * as DbModule from '@docket/db';
import { getMigratedDb } from './db';
/** Direct service tests use real database foundations without loading the route/container/MCP graph. */
export function getPrivatePublicationDb(): Promise<typeof DbModule> {
  return getMigratedDb();
}
/** Require a genuine inserted/read row while keeping missing fixture data explicit. */
export function requiredPrivateRow<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (!row) throw new Error('Missing private publication fixture row.');
  return row;
}
/** Seed a real current actor, team, foundation and persisted workspace Manage grant for private authoring proofs. */
export async function seedPrivatePublicationActor(
  database: typeof DbModule.db,
  schema: typeof DbModule,
): Promise<{ orgId: string; teamId: string; humanActorId: string }> {
  const id = schema.genId(),
    slug = `private-${id.toLowerCase()}`;
  const org = requiredPrivateRow(
    await database
      .insert(schema.organization)
      .values({ id, name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id }),
  );
  await database
    .insert(schema.organizationProductEntitlement)
    .values({
      organizationId: org.id,
      productKey: 'docket_pro',
      status: 'active',
      source: 'complimentary',
    })
    .onConflictDoUpdate({
      target: [
        schema.organizationProductEntitlement.organizationId,
        schema.organizationProductEntitlement.productKey,
      ],
      set: { status: 'active', source: 'complimentary' },
    });
  await schema.seedWorkspaceStatuses(database, org.id);
  const team = requiredPrivateRow(
    await database
      .insert(schema.team)
      .values({ organizationId: org.id, name: 'Private work', key: `NS${id.slice(-5)}` })
      .returning({ id: schema.team.id }),
  );
  const actor = requiredPrivateRow(
    await database
      .insert(schema.actor)
      .values({ organizationId: org.id, kind: 'human', displayName: 'Private author' })
      .returning({ id: schema.actor.id }),
  );
  await database.insert(schema.grant).values({
    organizationId: org.id,
    subjectKind: 'actor',
    subjectId: actor.id,
    resourceKind: 'organization',
    resourceId: org.id,
    capabilities: ['manage'],
    effect: 'allow',
    cascades: true,
  });
  return { orgId: org.id, teamId: team.id, humanActorId: actor.id };
}
