/**
 * `@docket/api` — resolve an external actor (a provider-side "who") to a Docket
 * {@link actor}, the single-lookup sibling of {@link syncExternalActors}.
 *
 * @remarks
 * {@link syncExternalActors} runs at the START of a work-graph sync, batch-upserting
 * `external_actor` rows for a whole snapshot. This module answers the narrower question a
 * single inbound signal (an event-drain draft actor, a Linear Agent webhook, …) actually asks:
 * "who is this, right now, as a Docket actor?" — without writing anything.
 */
import { account, actor, db, externalActor, integration, user } from '@docket/db';
import {
  PROVIDER_CATALOG,
  sourceIdentityProvider,
} from '@docket/connections/provider-catalog-contract';
import type { DirectoryProviderId } from '@docket/connections/provider-catalog-contract';
import type { SourceSystemKind } from '@docket/connections/event-contract';
import { and, eq, isNotNull, sql } from 'drizzle-orm';

/**
 * How a resolved `actorId` was determined; mirrors {@link externalActorMatch} plus the
 * OAuth-backed `linked_account` rung, which has no `external_actor` row of its own.
 */
export type ExternalActorMatchKind = 'manual' | 'linked_account' | 'email';

/** The result of resolving one external actor: the Docket actor id, and how it was found. */
export interface ResolvedExternalActor {
  /** The matched Docket actor, or `null` when nothing resolved. */
  readonly actorId: string | null;
  /** How `actorId` was determined; `null` alongside a null `actorId` means no match. */
  readonly matchedBy: ExternalActorMatchKind | null;
}

/** Input identifying one external actor to resolve. */
export interface ResolveExternalActorInput {
  /** The canonical source system the actor was observed in. */
  readonly source: SourceSystemKind;
  /** The actor's native id in that source. */
  readonly externalId: string;
  /** The actor's email at the source, when the caller has one (fuels the ad-hoc fallback). */
  readonly email?: string | undefined;
}

/**
 * Find the connector-provider id (the value stored in `integration.provider`, e.g. `'linear'`)
 * whose canonical event source is `source`.
 *
 * @remarks
 * `SourceSystemKind` (the event/actor attribution badge, e.g. `'google_calendar'`) and
 * `DirectoryProviderId` (the connector id an `integration` row is keyed by, e.g. `'calendar'`)
 * are related but distinct vocabularies — they only coincide by accident for `linear`/`github`.
 * This performs the same reverse lookup {@link sourceIdentityProvider} does, but returning the
 * connector id instead of the Better Auth identity provider.
 */
function connectorProviderForSource(source: SourceSystemKind): DirectoryProviderId | null {
  for (const entry of Object.values(PROVIDER_CATALOG)) {
    if (entry.sourceSystem === source) return entry.id;
  }
  return null;
}

/**
 * Resolve one external actor (a provider-side user, seen once — e.g. an inbound event's actor
 * or a Linear Agent webhook sender) to a Docket {@link actor} in `orgId`, without writing
 * anything.
 *
 * @remarks
 * Checked in this precedence, each rung attempted only when the prior one found nothing:
 *
 * 1. **Manual `external_actor` override.** A human explicitly bound (or explicitly unbound) this
 *    `(connector integration, externalId)` pair via the external-actors PATCH endpoint. Per the
 *    invariant documented on {@link externalActor} ("immune to re-matching"), a manual row is a
 *    human's deliberate decision and must outrank every automatic signal below — including a
 *    fresh OAuth link — so it is checked FIRST, not merely tie-broken last. If a manual row
 *    exists but was explicitly unbound (`actorId: null`), resolution stops here and returns "no
 *    match" rather than falling through to an automatic guess: silence was the human's choice.
 * 2. **Linked Better Auth `account`.** The strongest AUTOMATIC signal — the person's own OAuth
 *    consent ties their `account.accountId` (their native id at the provider) to a Docket
 *    `user`, which resolves to their org `actor`. Checked before any email heuristic because a
 *    consented identity link is authoritative in a way a coincidental email match is not.
 * 3. **Email-matched `external_actor` row.** The sync engine's own email match
 *    ({@link syncExternalActors}), scoped to the org's connector integration for this source.
 * 4. **Ad-hoc email fallback.** For callers that only have a raw email and no prior
 *    `external_actor` row (e.g. a source that has never run a full sync), match it
 *    case-insensitively against an active org member's account email — mirroring the case-fold
 *    convention {@link syncExternalActors} uses for its own email matching.
 *
 * No match at any rung returns `{ actorId: null, matchedBy: null }` — an explicit, queryable
 * "unresolved" state, never a fallback assignment.
 *
 * @param orgId - The organization the resolved actor must belong to.
 * @param input - The external actor's source, native id, and (optionally) email.
 * @returns the resolved Docket actor id and which rung resolved it (both null when unresolved).
 */
export async function resolveExternalActor(
  orgId: string,
  input: ResolveExternalActorInput,
): Promise<ResolvedExternalActor> {
  const connectorProviderId = connectorProviderForSource(input.source);
  return (
    (await manualOverrideRung(orgId, input, connectorProviderId)) ??
    (await linkedAccountRung(orgId, input)) ??
    (await syncedEmailRung(orgId, input, connectorProviderId)) ??
    (await adHocEmailRung(orgId, input)) ?? { actorId: null, matchedBy: null }
  );
}

/**
 * Rung 1 — the manual `external_actor` override, checked first: a human's decision always wins.
 *
 * @param orgId - The organization the resolved actor must belong to.
 * @param input - The external actor's source and native id.
 * @param connectorProviderId - The connector whose ids this source is addressed in, if any.
 * @returns The resolution, or `null` to keep looking.
 */
async function manualOverrideRung(
  orgId: string,
  input: ResolveExternalActorInput,
  connectorProviderId: string | null,
): Promise<ResolvedExternalActor | null> {
  if (!connectorProviderId) return null;
  const [manualRow] = await db
    .select({ actorId: externalActor.actorId })
    .from(externalActor)
    .innerJoin(integration, eq(externalActor.integrationId, integration.id))
    .where(
      and(
        eq(integration.organizationId, orgId),
        eq(integration.provider, connectorProviderId),
        eq(externalActor.externalId, input.externalId),
        eq(externalActor.matchedBy, 'manual'),
      ),
    )
    .limit(1);
  if (!manualRow) return null;
  // A manual row always terminates resolution here — even a null actorId (an admin
  // explicitly unbinding this identity) is a deliberate decision, not a cue to keep looking.
  return manualRow.actorId
    ? { actorId: manualRow.actorId, matchedBy: 'manual' }
    : { actorId: null, matchedBy: null };
}

/**
 * Rung 2 — the linked Better Auth account, from the person's own OAuth consent.
 *
 * @param orgId - The organization the resolved actor must belong to.
 * @param input - The external actor's source and native id.
 * @returns The resolution, or `null` to keep looking.
 */
async function linkedAccountRung(
  orgId: string,
  input: ResolveExternalActorInput,
): Promise<ResolvedExternalActor | null> {
  const identityProviderId = sourceIdentityProvider(input.source);
  if (!identityProviderId) return null;
  const [linkedAccount] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(and(eq(account.providerId, identityProviderId), eq(account.accountId, input.externalId)))
    .limit(1);
  if (!linkedAccount) return null;
  const [linkedActor] = await db
    .select({ actorId: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.organizationId, orgId),
        eq(actor.userId, linkedAccount.userId),
        eq(actor.status, 'active'),
      ),
    )
    .limit(1);
  return linkedActor ? { actorId: linkedActor.actorId, matchedBy: 'linked_account' } : null;
}

/**
 * Rung 3 — the email-matched `external_actor` row the sync engine wrote.
 *
 * @param orgId - The organization the resolved actor must belong to.
 * @param input - The external actor's source and native id.
 * @param connectorProviderId - The connector whose ids this source is addressed in, if any.
 * @returns The resolution, or `null` to keep looking.
 */
async function syncedEmailRung(
  orgId: string,
  input: ResolveExternalActorInput,
  connectorProviderId: string | null,
): Promise<ResolvedExternalActor | null> {
  if (!connectorProviderId) return null;
  const [emailRow] = await db
    .select({ actorId: externalActor.actorId })
    .from(externalActor)
    .innerJoin(integration, eq(externalActor.integrationId, integration.id))
    .where(
      and(
        eq(integration.organizationId, orgId),
        eq(integration.provider, connectorProviderId),
        eq(externalActor.externalId, input.externalId),
        eq(externalActor.matchedBy, 'email'),
        isNotNull(externalActor.actorId),
      ),
    )
    .limit(1);
  return emailRow?.actorId ? { actorId: emailRow.actorId, matchedBy: 'email' } : null;
}

/**
 * Rung 4 — the ad-hoc email fallback, case-insensitive, mirroring `syncExternalActors`.
 *
 * @param orgId - The organization the resolved actor must belong to.
 * @param input - The external actor's email, when the provider exposed one.
 * @returns The resolution, or `null` when nothing matched.
 */
async function adHocEmailRung(
  orgId: string,
  input: ResolveExternalActorInput,
): Promise<ResolvedExternalActor | null> {
  if (!input.email) return null;
  const emailLower = input.email.toLowerCase();
  const [matchedActor] = await db
    .select({ actorId: actor.id })
    .from(actor)
    .innerJoin(user, eq(actor.userId, user.id))
    .where(
      and(
        eq(actor.organizationId, orgId),
        eq(actor.status, 'active'),
        eq(sql`lower(${user.email})`, emailLower),
      ),
    )
    .limit(1);
  return matchedActor ? { actorId: matchedActor.actorId, matchedBy: 'email' } : null;
}
