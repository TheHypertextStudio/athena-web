/**
 * Shared organization seeding used by `POST /v1/orgs` and demo provisioning.
 *
 * @remarks
 * Seeds an organization, its system roles, its owner actor, its workspace statuses, its
 * default team with a team actor and membership, and its org-root role grants. Callers run it
 * inside their own transaction so the seed is all-or-nothing with any other writes they make.
 */
import type { db } from '@docket/db';
import {
  actor,
  grant,
  organization,
  role,
  seedWorkspaceStatuses,
  team,
  teamMember,
} from '@docket/db';

import { createTeamActor } from '../routes/team-actor';
import { SYSTEM_ROLES } from '../routes/org-helpers';

/** The transaction handle `db.transaction` passes to its callback. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Inputs for {@link createOrganizationInTransaction}. */
export interface CreateOrganizationInput {
  /** Display name of the organization. */
  readonly name: string;
  /** Unique slug; the caller resolves collisions before calling. */
  readonly slug: string;
  /** Optional purpose statement. */
  readonly purpose: string | undefined;
  /** Whether this is the owner's personal space. */
  readonly isPersonal: boolean;
  /** Vocabulary preset stored in the organization settings. */
  readonly vocabulary: NonNullable<typeof organization.$inferInsert.vocabulary>;
  /** Name shown on the owner actor. */
  readonly ownerDisplayName: string;
  /** The Better Auth user who becomes the Owner. */
  readonly ownerUserId: string;
}

/** Rows created by {@link createOrganizationInTransaction}. */
export interface CreatedOrganization {
  /** The new organization row. */
  readonly org: typeof organization.$inferSelect;
  /** The owner's human actor in the new organization. */
  readonly ownerActor: typeof actor.$inferSelect;
  /** The default `General` team. */
  readonly defaultTeam: typeof team.$inferSelect;
}

/**
 * Seeds a new organization inside the caller's transaction.
 *
 * @param tx - The open transaction; every write goes through it.
 * @param input - The organization identity and its owner.
 * @returns The organization, owner actor and default team rows.
 * @throws {Error} When an insert returns no row, which the database does not do in practice.
 */
export async function createOrganizationInTransaction(
  tx: Tx,
  input: CreateOrganizationInput,
): Promise<CreatedOrganization> {
  const [org] = await tx
    .insert(organization)
    .values({
      name: input.name,
      slug: input.slug,
      purpose: input.purpose,
      isPersonal: input.isPersonal,
      vocabulary: input.vocabulary,
    })
    .returning();
  /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
  if (!org) throw new Error('organization insert returned no row');

  const insertedRoles = await tx
    .insert(role)
    .values(SYSTEM_ROLES.map((r) => ({ organizationId: org.id, isSystem: true, ...r })))
    .returning();
  const roleByKey = new Map(insertedRoles.map((r) => [r.key, r]));
  const ownerRole = roleByKey.get('owner');
  /* v8 ignore next -- @preserve defensive: the owner system role is always seeded above */
  if (!ownerRole) throw new Error('owner role not seeded');

  const [ownerActor] = await tx
    .insert(actor)
    .values({
      organizationId: org.id,
      kind: 'human',
      displayName: input.ownerDisplayName,
      userId: input.ownerUserId,
      roleId: ownerRole.id,
    })
    .returning();
  /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
  if (!ownerActor) throw new Error('owner actor insert returned no row');

  // A workspace's statuses exist before any of its work can, because every task, project,
  // program, and initiative points at one. Seeded inside the same transaction so a
  // half-built workspace is impossible.
  await seedWorkspaceStatuses(tx, org.id, ownerActor.id);

  const [defaultTeam] = await tx
    .insert(team)
    .values({ organizationId: org.id, name: 'General', key: 'GEN' })
    .returning();
  /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
  if (!defaultTeam) throw new Error('default team insert returned no row');

  await createTeamActor(tx, {
    organizationId: org.id,
    teamId: defaultTeam.id,
    name: defaultTeam.name,
  });
  await tx.insert(teamMember).values({
    teamId: defaultTeam.id,
    actorId: ownerActor.id,
    organizationId: org.id,
    role: 'manager',
  });

  // Materialize the owner/admin/member role base as grants at the org root.
  const grantValues: (typeof grant.$inferInsert)[] = [];
  for (const key of ['owner', 'admin', 'member'] as const) {
    const r = roleByKey.get(key);
    /* v8 ignore next -- @preserve defensive: owner/admin/member are always in the seeded role map */
    if (!r) continue;
    grantValues.push({
      organizationId: org.id,
      subjectKind: 'role',
      subjectId: r.id,
      resourceKind: 'organization',
      resourceId: org.id,
      /* v8 ignore next -- @preserve owner/admin/member always carry a baseCapability; the [] side is unreachable here */
      capabilities: r.baseCapability ? [r.baseCapability] : [],
      effect: 'allow',
    });
  }
  /* v8 ignore next -- @preserve owner/admin/member always populate grantValues, so the empty-list skip is unreachable */
  if (grantValues.length > 0) await tx.insert(grant).values(grantValues);

  return { org, ownerActor, defaultTeam };
}
