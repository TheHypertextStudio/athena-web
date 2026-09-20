/** Provider identities and stable workspace-person mappings shared by integration syncs. */
import { db, externalActor } from '@docket/db';
import type { ExternalActorOut } from '@docket/connections/integration-contract';
import type { ExternalUser } from '@docket/integrations';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { z } from 'zod';

/** The selected `external_actor` row shape. */
export type ExternalActorRow = typeof externalActor.$inferSelect;

/** Serialize an {@link ExternalActorRow} to its {@link ExternalActorOut} representation. */
export function toExternalActorOut(row: ExternalActorRow): z.input<typeof ExternalActorOut> {
  return {
    id: row.id,
    externalId: row.externalId,
    email: row.email,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    actorId: row.actorId,
    matchedBy: row.matchedBy,
    ignoredAt: row.ignoredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Refresh provider identities without guessing new canonical people from email or names.
 * Existing links and deliberate exclusions survive provider refreshes.
 * @returns The canonical person, or null, for each supplied provider identity.
 */
export async function syncExternalActors(
  orgId: string,
  integrationId: string,
  users: readonly ExternalUser[],
): Promise<Map<string, string | null>> {
  const resultMap = new Map<string, string | null>();
  if (users.length === 0) return resultMap;

  // Provider email is evidence for a suggestion, not proof that two identities belong
  // to the same person. Existing historical links remain stable until explicitly corrected.
  const valueByExternalId = new Map<string, typeof externalActor.$inferInsert>();
  for (const u of users) {
    const email = u.email ?? null;
    valueByExternalId.set(u.externalId, {
      organizationId: orgId,
      integrationId,
      externalId: u.externalId,
      email,
      displayName: u.displayName.trim() || `User ${u.externalId}`,
      avatarUrl: u.avatarUrl ?? null,
      actorId: null,
      matchedBy: null,
    });
  }

  // Preserve prior decisions atomically, including legacy email mappings. New matching
  // rules must not silently rewrite historical assignments.
  const hasExistingDecision = sql`${externalActor.matchedBy} is not null or ${externalActor.ignoredAt} is not null`;
  const upserted = await db
    .insert(externalActor)
    .values([...valueByExternalId.values()])
    .onConflictDoUpdate({
      target: [externalActor.integrationId, externalActor.externalId],
      set: {
        email: sql`excluded.email`,
        displayName: sql`excluded.display_name`,
        avatarUrl: sql`excluded.avatar_url`,
        actorId: sql`case when ${hasExistingDecision} then ${externalActor.actorId} else excluded.actor_id end`,
        matchedBy: sql`case when ${hasExistingDecision} then ${externalActor.matchedBy} else excluded.matched_by end`,
        updatedAt: new Date(),
      },
    })
    .returning({ externalId: externalActor.externalId, actorId: externalActor.actorId });

  for (const row of upserted) resultMap.set(row.externalId, row.actorId);
  return resultMap;
}

/**
 * Build the `actorId → externalId` reverse map for an integration's MATCHED `external_actor`
 * rows only, for use by the reconciler's push path (T6).
 *
 * @remarks
 * A Docket assignee absent from this map means the reconciler's push OMITS the assignee
 * field entirely — documented behavior, not a null-out of the provider's existing assignee.
 *
 * @param integrationId - The integration to build the reverse map for.
 * @returns a map of `actorId → externalId`, containing only rows with a non-null `actorId`.
 */
export async function externalActorReverseMap(integrationId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ actorId: externalActor.actorId, externalId: externalActor.externalId })
    .from(externalActor)
    .where(and(eq(externalActor.integrationId, integrationId), isNotNull(externalActor.actorId)));

  const map = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const row of rows) {
    if (!row.actorId || ambiguous.has(row.actorId)) continue;
    if (map.has(row.actorId)) {
      map.delete(row.actorId);
      ambiguous.add(row.actorId);
    } else {
      map.set(row.actorId, row.externalId);
    }
  }
  return map;
}
