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
 * - Email matching: candidates are this org's ACTIVE Actors backed by a Better Auth
 *   `user` (`actor.userId → user.id`), matched `lower(externalUser.email) =
 *   lower(user.email)`. Suspended actors are excluded — suspension is access revocation
 *   (the same convention as hub membership resolution), so automatic matching never
 *   targets a suspended member, and a previously email-matched row unmatches on the next
 *   sync after its actor is suspended. A MANUAL link to a suspended actor is untouched
 *   (manual precedence below governs).
 * - Precedence (binding), enforced INSIDE the single batched upsert via `CASE`
 *   expressions comparing the conflicting row's pre-existing `matched_by` against
 *   `excluded.*` — atomic per row in Postgres, so a manual PATCH landing concurrently
 *   with a sync can never be clobbered (correctness does not depend on any prior read):
 *   - `matchedBy: 'manual'` rows are NEVER modified by email matching — neither
 *     re-matched nor unmatched — even if emails now disagree. A human's explicit link
 *     always wins.
 *   - `matchedBy: 'email'` rows are re-evaluated every call: if the email no longer
 *     matches any active member it becomes unmatched (`actorId: null, matchedBy: null`);
 *     if it now matches a different member, it updates.
 *   - Unmatched rows (`matchedBy: null`, including rows not seen before) are (re)evaluated
 *     every call.
 * - Provider users no longer present in `users` are left in place — never deleted, since
 *   task history may still reference them as an assignee. Inactive users (`active:
 *   false`) still upsert; they remain valid historical assignees. Duplicate `externalId`s
 *   within one batch are deduped last-wins (Postgres rejects updating the same row twice
 *   in one `ON CONFLICT` statement).
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

  // Candidate members: this org's ACTIVE Actors backed by a Better Auth user, keyed by
  // lowercased email. Suspended actors are excluded — suspension revokes access, so email
  // matching must never (re)target them. `user.email` is globally unique (`user_email_uq`),
  // so this map is collision-free.
  const candidates = await db
    .select({ actorId: actor.id, email: user.email })
    .from(actor)
    .innerJoin(user, eq(actor.userId, user.id))
    .where(and(eq(actor.organizationId, orgId), eq(actor.status, 'active')));
  const candidateByEmail = new Map<string, string>();
  for (const candidate of candidates) {
    candidateByEmail.set(candidate.email.toLowerCase(), candidate.actorId);
  }

  // The fresh email-match proposal per provider user, deduped last-wins by externalId
  // (Postgres rejects updating the same row twice within one ON CONFLICT statement).
  // Whether a proposal LANDS is decided by the CASE expressions in the upsert below.
  const valueByExternalId = new Map<string, typeof externalActor.$inferInsert>();
  for (const u of users) {
    const email = u.email ?? null;
    const matchedActorId = email ? (candidateByEmail.get(email.toLowerCase()) ?? null) : null;
    valueByExternalId.set(u.externalId, {
      organizationId: orgId,
      integrationId,
      externalId: u.externalId,
      email,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl ?? null,
      actorId: matchedActorId,
      matchedBy: matchedActorId ? 'email' : null,
    });
  }

  // A single batched upsert carrying the precedence rule IN the statement: the target-table
  // reference (`external_actor.*`) is the conflicting row's pre-existing value and
  // `excluded.*` is the fresh proposal, evaluated atomically per row — so a `manual` row
  // keeps its own actorId/matchedBy no matter what this sync proposes, and a concurrent
  // manual PATCH can never be clobbered by a read-then-write gap (there is no read).
  // Provider-sourced fields (email/displayName/avatarUrl) refresh unconditionally.
  // `.returning()` yields the POST-upsert row, so manual rows report their preserved match.
  const upserted = await db
    .insert(externalActor)
    .values([...valueByExternalId.values()])
    .onConflictDoUpdate({
      target: [externalActor.integrationId, externalActor.externalId],
      set: {
        email: sql`excluded.email`,
        displayName: sql`excluded.display_name`,
        avatarUrl: sql`excluded.avatar_url`,
        actorId: sql`case when ${externalActor.matchedBy} = 'manual' then ${externalActor.actorId} else excluded.actor_id end`,
        matchedBy: sql`case when ${externalActor.matchedBy} = 'manual' then ${externalActor.matchedBy} else excluded.matched_by end`,
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
