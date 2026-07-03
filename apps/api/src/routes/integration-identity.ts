/**
 * `@docket/api` — external-actor identity mapping (provider user ↔ Docket Actor).
 *
 * @remarks
 * Maps provider-side users (e.g. Linear members, pulled via the work-graph port's
 * {@link ExternalUser}) onto Docket {@link actor} rows, one `external_actor` row per
 * `(integration, externalId)`. Matching is by email against the org's members;
 * unmatched is an explicit, queryable state (`actorId IS NULL`) — NEVER a fallback
 * assignment. This module is the identity seam the reconciler (T6) sits on top of:
 * {@link syncExternalActors} runs at the start of each sync (pull direction),
 * {@link externalActorReverseMap} feeds the push direction.
 */
import { actor, db, externalActor, user } from '@docket/db';
import type { ExternalActorOut } from '@docket/types';
import type { ExternalUser } from '@docket/boundaries';
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Upsert `external_actor` rows for a batch of provider users pulled from one work-graph
 * sync, matching each to a Docket {@link actor} by email, and return the resulting
 * `externalId → actorId` map for that batch.
 *
 * @remarks
 * Behavior:
 * - Upserts rows keyed `(integrationId, externalId)`: `email`/`displayName`/`avatarUrl`
 *   are refreshed from the provider on EVERY call, regardless of match state — the
 *   provider is the source of truth for those fields. `organizationId` is set on insert.
 * - Email matching: candidates are this org's Actors backed by a Better Auth `user`
 *   (`actor.userId → user.id`), matched `lower(externalUser.email) = lower(user.email)`.
 * - Precedence (binding), resolved in-memory against the EXISTING rows fetched up front
 *   (one extra select, batched — not an N+1 per user), then written in a single upsert:
 *   - `matchedBy: 'manual'` rows are NEVER modified by email matching — neither
 *     re-matched nor unmatched — even if emails now disagree. A human's explicit link
 *     always wins.
 *   - `matchedBy: 'email'` rows are re-evaluated every call: if the email no longer
 *     matches any member it becomes unmatched (`actorId: null, matchedBy: null`); if it
 *     now matches a different member, it updates.
 *   - Unmatched rows (`matchedBy: null`, including rows not seen before) are (re)evaluated
 *     every call.
 * - Provider users no longer present in `users` are left in place — never deleted, since
 *   task history may still reference them as an assignee. Inactive users (`active:
 *   false`) still upsert; they remain valid historical assignees.
 *
 * @param orgId - The owning organization.
 * @param integrationId - The integration these users were pulled from.
 * @param users - The provider's current user list (a full snapshot from one pull).
 * @returns a map of `externalId → actorId | null` (`null` = unmatched) covering EXACTLY
 *   the `users` passed in for this call — not the integration's full historical
 *   `external_actor` set. Callers that need the full mapping (e.g. for push) should use
 *   {@link externalActorReverseMap} instead.
 */
export async function syncExternalActors(
  orgId: string,
  integrationId: string,
  users: readonly ExternalUser[],
): Promise<Map<string, string | null>> {
  const resultMap = new Map<string, string | null>();
  if (users.length === 0) return resultMap;

  // Candidate members: this org's Actors backed by a Better Auth user, keyed by lowercased
  // email. `user.email` is globally unique (`user_email_uq`), so this map is collision-free.
  const candidates = await db
    .select({ actorId: actor.id, email: user.email })
    .from(actor)
    .innerJoin(user, eq(actor.userId, user.id))
    .where(eq(actor.organizationId, orgId));
  const candidateByEmail = new Map<string, string>();
  for (const candidate of candidates) {
    candidateByEmail.set(candidate.email.toLowerCase(), candidate.actorId);
  }

  // Existing rows for this integration, keyed by externalId, so manual precedence can be
  // resolved in-memory (one batched select — not an N+1 per provider user).
  const existingRows = await db
    .select({
      externalId: externalActor.externalId,
      actorId: externalActor.actorId,
      matchedBy: externalActor.matchedBy,
    })
    .from(externalActor)
    .where(eq(externalActor.integrationId, integrationId));
  const existingByExternalId = new Map(existingRows.map((row) => [row.externalId, row]));

  const values = users.map((u) => {
    const email = u.email ?? null;
    const existing = existingByExternalId.get(u.externalId);

    let matchedActorId: string | null;
    let matchedBy: 'email' | 'manual' | null;
    if (existing?.matchedBy === 'manual') {
      // A human's explicit link is never touched by email matching, no matter what the
      // provider now reports.
      matchedActorId = existing.actorId;
      matchedBy = 'manual';
    } else {
      matchedActorId = email ? (candidateByEmail.get(email.toLowerCase()) ?? null) : null;
      matchedBy = matchedActorId ? 'email' : null;
    }

    return {
      organizationId: orgId,
      integrationId,
      externalId: u.externalId,
      email,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl ?? null,
      actorId: matchedActorId,
      matchedBy,
    };
  });

  // A single batched upsert. `email`/`displayName`/`avatarUrl`/`actorId`/`matchedBy` all take
  // the freshly-computed (`excluded`) value — the manual-precedence decision was already made
  // above, so this upsert only needs to WRITE it, not re-derive it.
  const upserted = await db
    .insert(externalActor)
    .values(values)
    .onConflictDoUpdate({
      target: [externalActor.integrationId, externalActor.externalId],
      set: {
        email: sql`excluded.email`,
        displayName: sql`excluded.display_name`,
        avatarUrl: sql`excluded.avatar_url`,
        actorId: sql`excluded.actor_id`,
        matchedBy: sql`excluded.matched_by`,
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
  for (const row of rows) {
    if (row.actorId) map.set(row.actorId, row.externalId);
  }
  return map;
}
