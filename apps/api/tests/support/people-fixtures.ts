import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import { grantDocketPro } from './routes-harness';

/**
 * Seed a non-personal org with an owner role + owner actor and a plain member role.
 *
 * @param schema - The initialized test database module.
 * @param opts.personal - When true, marks the org `is_personal` (blocks invites).
 * @returns the org id plus the seeded owner/member role ids and owner actor id.
 */
export async function seedPeopleWorkspace(
  schema: typeof DbModule,
  opts: { personal?: boolean } = {},
): Promise<{ orgId: string; ownerRoleId: string; memberRoleId: string; ownerActorId: string }> {
  const db = schema.db;
  const slug = `mi-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active', isPersonal: opts.personal ?? false })
    .returning({ id: schema.organization.id });
  const orgId = assertDefined(org).id;
  await grantDocketPro(db, schema, orgId);
  const [ownerRole] = await db
    .insert(schema.role)
    .values({
      organizationId: orgId,
      key: 'owner',
      name: 'Owner',
      isSystem: true,
      capabilities: ['manage'],
    })
    .returning({ id: schema.role.id });
  const [memberRole] = await db
    .insert(schema.role)
    .values({
      organizationId: orgId,
      key: 'member',
      name: 'Member',
      isSystem: true,
      capabilities: ['view'],
    })
    .returning({ id: schema.role.id });
  const ownerUser = await seedPeopleUser(schema, 'Owner');
  const [owner] = await db
    .insert(schema.actor)
    .values({
      organizationId: orgId,
      kind: 'human',
      displayName: 'Owner',
      userId: ownerUser.id,
      roleId: assertDefined(ownerRole).id,
    })
    .returning({ id: schema.actor.id });
  return {
    orgId,
    ownerRoleId: assertDefined(ownerRole).id,
    memberRoleId: assertDefined(memberRole).id,
    ownerActorId: assertDefined(owner).id,
  };
}

/** Insert a fresh global user; returns its id + email. */
export async function seedPeopleUser(
  schema: typeof DbModule,
  name = 'New',
): Promise<{ id: string; email: string }> {
  const db = schema.db;
  const email = `mi-${Math.random().toString(36).slice(2)}@e.com`;
  const [user] = await db
    .insert(schema.user)
    .values({ name, email })
    .returning({ id: schema.user.id, email: schema.user.email });
  return { id: assertDefined(user).id, email: assertDefined(user).email };
}
