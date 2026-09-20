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
import { account, actor, db, externalActor, integration } from '@docket/db';
import {
  PROVIDER_CATALOG,
  sourceIdentityProvider,
} from '@docket/connections/provider-catalog-contract';
import type { DirectoryProviderId } from '@docket/connections/provider-catalog-contract';
import type { SourceSystemKind } from '@docket/connections/event-contract';
import { and, eq, isNotNull, or } from 'drizzle-orm';

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
  /** Scope native IDs to one connection when the provider uses workspace-local IDs. */
  readonly integrationId?: string;
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
 * Unverified provider email is only matching evidence for suggestions. It never
 * creates a new automatic link. Historical email links remain compatible.
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

  // Rung 1 — manual external_actor override (checked first: a human's decision always wins).
  if (connectorProviderId) {
    const manualRows = await db
      .select({ actorId: externalActor.actorId, ignoredAt: externalActor.ignoredAt })
      .from(externalActor)
      .innerJoin(integration, eq(externalActor.integrationId, integration.id))
      .where(
        and(
          eq(integration.organizationId, orgId),
          eq(integration.provider, connectorProviderId),
          integrationScope(input.integrationId),
          eq(externalActor.externalId, input.externalId),
          or(eq(externalActor.matchedBy, 'manual'), isNotNull(externalActor.ignoredAt)),
        ),
      )
      .limit(2);
    if (manualRows.length > 1) return { actorId: null, matchedBy: null };
    const manualRow = manualRows[0];
    if (manualRow) {
      // A manual row always terminates resolution here — even a null actorId (an admin
      // explicitly unbinding this identity) is a deliberate decision, not a cue to keep looking.
      return manualRow.actorId && !manualRow.ignoredAt
        ? { actorId: manualRow.actorId, matchedBy: 'manual' }
        : { actorId: null, matchedBy: null };
    }
  }

  const linked = await resolveLinkedAccount(orgId, input);
  if (linked) return linked;

  // Rung 3 — email-matched external_actor row from the sync engine.
  if (connectorProviderId) {
    const emailRows = await db
      .select({ actorId: externalActor.actorId })
      .from(externalActor)
      .innerJoin(integration, eq(externalActor.integrationId, integration.id))
      .where(
        and(
          eq(integration.organizationId, orgId),
          eq(integration.provider, connectorProviderId),
          integrationScope(input.integrationId),
          eq(externalActor.externalId, input.externalId),
          eq(externalActor.matchedBy, 'email'),
          isNotNull(externalActor.actorId),
        ),
      )
      .limit(2);
    if (emailRows.length > 1) return { actorId: null, matchedBy: null };
    const emailRow = emailRows[0];
    if (emailRow?.actorId) return { actorId: emailRow.actorId, matchedBy: 'email' };
  }

  // Unverified email alone is a suggestion, never an automatic identity link.
  return { actorId: null, matchedBy: null };
}

async function resolveLinkedAccount(
  orgId: string,
  input: ResolveExternalActorInput,
): Promise<ResolvedExternalActor | null> {
  // Rung 2 — linked Better Auth account (the person's own OAuth consent).
  const identityProviderId = sourceIdentityProvider(input.source);
  if (identityProviderId) {
    const [linkedAccount] = await db
      .select({ userId: account.userId })
      .from(account)
      .where(
        and(eq(account.providerId, identityProviderId), eq(account.accountId, input.externalId)),
      )
      .limit(1);
    if (linkedAccount) {
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
      if (linkedActor) return { actorId: linkedActor.actorId, matchedBy: 'linked_account' };
    }
  }

  return null;
}

function integrationScope(id: string | undefined) {
  return id ? eq(integration.id, id) : undefined;
}
