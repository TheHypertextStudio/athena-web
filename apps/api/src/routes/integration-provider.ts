import { account, actor, db } from '@docket/db';
import type { integration, task } from '@docket/db';
import { auth } from '@docket/auth';
import type { IdentityOut, IdentityProvider, IntegrationOut, TaskOut } from '@docket/types';
import { type IntegrationDirectoryProvider } from '@docket/types';
import type { ConnectorProvider, ObserverProvider } from '@docket/boundaries';
import { WRITE_BACK_CAPABLE_PROVIDERS, selectAdapter } from '@docket/boundaries';
import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';

import { toBoundaryEnv } from '../container';
import { env } from '../env';
import { decodeIdTokenClaims } from '../lib/id-token';

/** IntegrationRow is the selected database row shape consumed by these API route serializers. */
export type IntegrationRow = typeof integration.$inferSelect;
/** TaskRow is the selected database row shape consumed by these API route serializers. */
export type TaskRow = typeof task.$inferSelect;

/** The providers the {@link Connector} port can import from. */
export const CONNECTOR_PROVIDERS: readonly ConnectorProvider[] = [
  'github',
  'drive',
  'linear',
  'gmail',
  'calendar',
  'gtasks',
  'outlook',
];

/**
 * Connectors whose `integration.writeBack` DEFAULTS ON at connect when the caller doesn't specify.
 *
 * @remarks
 * Re-exports the boundary manifest (`WRITE_BACK_CAPABLE_PROVIDERS`) so capability
 * membership has one source of truth: only Google Tasks (`gtasks`) defaults on here — it needs
 * no extra OAuth scope, so a UI connect verifies two-way out of the box. Linear is deliberately
 * EXCLUDED this slice — it is write-*capable*, but exercising write-back requires the actor's
 * linked identity to carry the `write` OAuth scope (see {@link hasLinearWriteScope}), which
 * Better Auth's Linear config does not grant until Slice 3. Default-seeding `writeBack` on for
 * Linear would make every UI-created integration verify straight into `error` with an
 * unsatisfiable reconnect message, so Linear connects read-only by default and write-back is
 * opted into later via `PATCH /:id` (which enforces the scope). The scope enforcement at
 * verify/PATCH keys off the row's ACTUAL `writeBack` flag and an explicit `provider === 'linear'`
 * check, NOT this set — so Linear's absence here does not weaken enforcement, it only changes
 * the connect-time default.
 */
export const WRITE_BACK_PROVIDERS: ReadonlySet<string> = WRITE_BACK_CAPABLE_PROVIDERS;

/**
 * Every provider the connect wizard can offer: the {@link Connector} providers plus
 * observe-only sources (Slack), which connect for signal ingestion but expose no import/sync.
 */
export const DIRECTORY_PROVIDERS: readonly (ConnectorProvider | 'slack')[] = [
  ...CONNECTOR_PROVIDERS,
  'slack',
];

/**
 * The connect-wizard directory entry for each connectable provider.
 *
 * @remarks
 * Keyed off {@link DIRECTORY_PROVIDERS}: a Migration pattern *replaces* a tool, a Connector
 * pattern *complements* one. Slack is observe-only — it contributes the `signal` role and
 * routes inbound Events API traffic, and `asConnectorProvider('slack')` stays null so
 * import/sync endpoints correctly 409.
 */
export const PROVIDER_DIRECTORY: Readonly<
  Record<ConnectorProvider | 'slack', Omit<IntegrationDirectoryProvider, 'provider' | 'syncable'>>
> = {
  slack: { name: 'Slack', pattern: 'connector', roles: ['signal'], category: 'communication' },
  github: {
    name: 'GitHub',
    pattern: 'connector',
    roles: ['code', 'work'],
    category: 'engineering',
  },
  linear: { name: 'Linear', pattern: 'connector', roles: ['work'], category: 'project-management' },
  drive: { name: 'Google Drive', pattern: 'connector', roles: ['context'], category: 'documents' },
  gmail: { name: 'Gmail', pattern: 'connector', roles: ['signal'], category: 'communication' },
  calendar: {
    name: 'Google Calendar',
    pattern: 'connector',
    roles: ['time'],
    category: 'communication',
  },
  gtasks: {
    name: 'Google Tasks',
    pattern: 'connector',
    roles: ['work'],
    category: 'project-management',
  },
  outlook: {
    name: 'Outlook',
    pattern: 'connector',
    roles: ['signal'],
    category: 'communication',
  },
};

/** Narrow a stored integration `provider` string to a {@link ConnectorProvider}. */
export function asConnectorProvider(provider: string): ConnectorProvider | null {
  return CONNECTOR_PROVIDERS.find((p) => p === provider) ?? null;
}

/** Every {@link ObserverProvider} — the connectors plus observe-only sources (Slack, Discord). */
export const OBSERVER_PROVIDERS: readonly ObserverProvider[] = [
  ...CONNECTOR_PROVIDERS,
  'slack',
  'discord',
];

/** Narrow a stored integration/event `provider` string to an {@link ObserverProvider}. */
export function asObserverProvider(provider: string): ObserverProvider | null {
  return OBSERVER_PROVIDERS.find((p) => p === provider) ?? null;
}

/**
 * Map a {@link ConnectorProvider} to the Better Auth social `providerId` whose stored
 * `access_token` is used to call that provider's API.
 *
 * @remarks
 * All four Google products share the same OAuth grant (one `google` account row);
 * GitHub and Linear each have their own.
 */
export function socialProviderId(provider: ConnectorProvider): string {
  if (provider === 'github') return 'github';
  if (provider === 'linear') return 'linear';
  if (provider === 'outlook') return 'microsoft';
  return 'google';
}

/**
 * The outcome of resolving a connector's OAuth access token.
 *
 * @remarks
 * A discriminated result instead of `string | null`: a `null` token previously could not
 * distinguish "never signed in" from "token expired and refresh failed", so the UI/scheduler
 * could not pick the right remediation or message. `needs_reauth` carries a user-facing reason
 * the caller persists as `lastError` and (for background runs) notifies on.
 */
export type ConnectorTokenResult =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly reason: 'needs_reauth'; readonly message: string };

/**
 * Fetch a (possibly refreshed) OAuth access token for a `(providerId, userId)` pair.
 *
 * @remarks
 * Isolated as an injectable seam so {@link resolveLiveConnectorToken} can be exercised in
 * tests without a real Better Auth instance or network — the default delegates to
 * `auth.api.getAccessToken`, which transparently refreshes an expired token via the stored
 * refresh token.
 */
export type AccessTokenFetcher = (input: {
  readonly providerId: string;
  readonly userId: string;
  /**
   * The provider account to fetch the token for, disambiguating when a user has linked multiple
   * accounts of the same provider (e.g. several Google accounts). Omitted ⇒ the user's single
   * grant for that provider.
   */
  readonly accountId?: string;
}) => Promise<{ readonly accessToken?: string | null }>;

/** The production {@link AccessTokenFetcher}: Better Auth's server-side token endpoint. */
const defaultAccessTokenFetcher: AccessTokenFetcher = (input) =>
  auth.api.getAccessToken({ body: input });

/**
 * Resolve a fresh OAuth access token for a connector provider on behalf of an Actor —
 * the live path, with NO env-mode short-circuit (see {@link resolveConnectorToken}).
 *
 * @remarks
 * Resolves the Actor's global Better Auth `user` (an Actor id is NOT a user id — the prior
 * code compared the two id spaces directly, so it never matched in production), then asks the
 * {@link AccessTokenFetcher} for the access token. The default fetcher transparently REFRESHES
 * an expired token via the stored refresh token — essential for background syncs that run while
 * nobody is signed in. Any failure (no linked account, revoked grant, refresh failure) becomes
 * a single `needs_reauth` outcome with a "Sign in with X" message, never a silent skip.
 *
 * @param actorId - The Actor whose linked provider grant should be used.
 * @param provider - The connector provider whose token is needed.
 * @param fetchAccessToken - Token fetcher; defaults to {@link defaultAccessTokenFetcher}.
 * @param externalAccountId - The bound provider account (e.g. Google `sub`) to disambiguate which
 *   of a user's same-provider grants to use; null/undefined ⇒ the single grant.
 */
export async function resolveLiveConnectorToken(
  actorId: string,
  provider: ConnectorProvider,
  fetchAccessToken: AccessTokenFetcher = defaultAccessTokenFetcher,
  externalAccountId?: string | null,
): Promise<ConnectorTokenResult> {
  const providerId = socialProviderId(provider);
  const needsReauth = {
    ok: false as const,
    reason: 'needs_reauth' as const,
    message: `Sign in with ${providerId} to reconnect this integration.`,
  };

  const rows = await db
    .select({ userId: actor.userId })
    .from(actor)
    .where(eq(actor.id, actorId))
    .limit(1);
  const userId = rows[0]?.userId;
  if (!userId) return needsReauth;

  try {
    const result = await fetchAccessToken({
      providerId,
      userId,
      ...(externalAccountId ? { accountId: externalAccountId } : {}),
    });
    if (!result.accessToken) return needsReauth;
    return { ok: true, token: result.accessToken };
  } catch {
    // getAccessToken throws when no account is linked or the refresh-token exchange fails —
    // both mean the user must re-authorize. Surfaced (never swallowed into a fake success).
    return needsReauth;
  }
}

/**
 * Resolve a fresh OAuth access token for a connector provider on behalf of an Actor.
 *
 * @remarks
 * In `APP_MODE=local`/`test` a sentinel `'mock'` token is returned immediately (no DB round
 * trip, no real credentials), and {@link selectAdapter} forces the mock connector anyway.
 * Otherwise this delegates to {@link resolveLiveConnectorToken}, which does the real Actor →
 * Better Auth `user` → access-token resolution (and refresh).
 *
 * @param actorId - The Actor whose linked provider grant should be used (e.g. the integration's
 *   `createdBy` for a background run, or the request actor for a manual one).
 * @param provider - The connector provider whose token is needed.
 * @param externalAccountId - The integration's bound provider account, threaded through so the
 *   correct grant is used when a user linked several accounts of the same provider.
 */
export async function resolveConnectorToken(
  actorId: string,
  provider: ConnectorProvider,
  externalAccountId?: string | null,
): Promise<ConnectorTokenResult> {
  const mode = env.APP_MODE;
  if (mode === 'local' || mode === 'test') return { ok: true, token: 'mock' };

  return resolveLiveConnectorToken(actorId, provider, defaultAccessTokenFetcher, externalAccountId);
}

/** The social providers a linked identity can belong to (mirrors Better Auth `socialProviders`). */
const IDENTITY_PROVIDERS: readonly IdentityProvider[] = [
  'google',
  'github',
  'linear',
  'discord',
  'microsoft',
];

/**
 * List the user's linked external identities across every supported provider (Google / GitHub /
 * Linear), each labeled by the email/name decoded from its stored OIDC id token when available.
 *
 * @remarks
 * Identities are user-scoped — the OAuth grant belongs to the Docket user, not an org. Only real,
 * linked `account` rows are returned: there is **no** synthetic/fabricated fallback, so an
 * unconfigured or unlinked provider simply contributes nothing and the UI renders an honest empty
 * state (never a placeholder that claims a connection nothing set up). Google supplies email/name/
 * picture via its OIDC `account.idToken` (decoded here, since it is not a column); GitHub/Linear
 * carry no id token, so those claims are null and the UI falls back to the provider name.
 *
 * @param userId - The Docket user whose linked identities to list.
 */
export async function linkedIdentities(userId: string): Promise<IdentityOut[]> {
  const rows = await db
    .select({
      accountId: account.accountId,
      providerId: account.providerId,
      idToken: account.idToken,
      scope: account.scope,
      createdAt: account.createdAt,
    })
    .from(account)
    .where(and(eq(account.userId, userId), inArray(account.providerId, [...IDENTITY_PROVIDERS])));

  return rows.map((row) => {
    const claims = decodeIdTokenClaims(row.idToken);
    return {
      accountId: row.accountId,
      provider: row.providerId as IdentityProvider,
      email: claims.email,
      name: claims.name,
      picture: claims.picture,
      scopes: (row.scope ?? '')
        .split(' ')
        .map((s) => s.trim())
        .filter(Boolean),
      linkedAt: row.createdAt.toISOString(),
    };
  });
}

/**
 * The user-facing reason a Linear write-back integration is blocked on scope.
 *
 * @remarks
 * Re-exported (not redefined) from `@docket/types` — that package has no server-only runtime
 * deps, so `apps/web`'s `IntegrationConfigPanel` can import the same constant directly instead
 * of duplicating the string, while this module and `./integrations` keep importing it from here
 * unchanged. See the constant's own doc for the full remarks on where each side consumes it.
 */
export { LINEAR_WRITE_SCOPE_MESSAGE } from '@docket/types';

/**
 * Whether the actor's linked Linear identity carries the `write` OAuth scope.
 *
 * @remarks
 * Two-way sync (`integration.writeBack`) needs more than Better Auth's current Linear scope
 * config (`['read']` this slice — the upgrade to read/write/admin ships with Slice 3): this
 * reads whatever scope the actor's linked `linear` `account` row ACTUALLY carries, via
 * {@link linkedIdentities}, and is honest either way — a real `write` grant passes, a
 * `read`-only (or absent) one fails. Deliberately carries NO `APP_MODE` short-circuit (unlike
 * {@link resolveConnectorToken}): in `test`/`local` it reads whatever identity fixtures a test
 * seeded, exactly as in production, so route tests can exercise both the granted and ungranted
 * outcome by seeding a scope string rather than relying on a bypass.
 *
 * @param actorId - The actor whose linked Linear identity to check.
 */
export async function hasLinearWriteScope(actorId: string): Promise<boolean> {
  const rows = await db
    .select({ userId: actor.userId })
    .from(actor)
    .where(eq(actor.id, actorId))
    .limit(1);
  const userId = rows[0]?.userId;
  if (!userId) return false;
  const linear = (await linkedIdentities(userId)).find((i) => i.provider === 'linear');
  return linear?.scopes.includes('write') ?? false;
}

/**
 * Resolve the display label (email) of the identity an integration is bound to.
 *
 * @remarks
 * Stamps `integration.connection.account` with the account's EMAIL at verify time — replacing the
 * old gtasks label which was a task-list *title* (a resource), conflating account with resource.
 * Reuses the Actor → Better Auth `user` mapping.
 *
 * @param actorId - The actor owning the integration.
 * @param externalAccountId - The bound Google `sub`, or null for a legacy single-account row.
 */
export async function resolveIdentityLabel(
  actorId: string,
  externalAccountId: string | null,
): Promise<string | undefined> {
  if (!externalAccountId) return undefined;
  const rows = await db
    .select({ userId: actor.userId })
    .from(actor)
    .where(eq(actor.id, actorId))
    .limit(1);
  const userId = rows[0]?.userId;
  if (!userId) return undefined;
  const match = (await linkedIdentities(userId)).find((i) => i.accountId === externalAccountId);
  return match?.email ?? match?.name ?? undefined;
}

/**
 * Instantiate a per-request {@link Connector} bound to a specific provider and token.
 *
 * @remarks
 * Never uses the cached process singleton — the token is per-user. In `APP_MODE=local`/`test`
 * the env-mode check in {@link selectAdapter} forces the mock connector.
 */
export function connectorFor(provider: ConnectorProvider, accessToken: string) {
  return selectAdapter('connector', toBoundaryEnv(), {
    connectorProvider: provider,
    connectorToken: accessToken,
  });
}

/** Serialize an integration row to its {@link IntegrationOut} representation. */
export function toOut(i: IntegrationRow): z.input<typeof IntegrationOut> {
  return {
    id: i.id,
    organizationId: i.organizationId,
    provider: i.provider,
    pattern: i.pattern,
    roles: i.roles,
    connection: i.connection,
    status: i.status,
    config: i.config,
    externalAccountId: i.externalAccountId,
    syncMode: i.syncMode,
    writeBack: i.writeBack,
    lastSyncStatus: i.lastSyncStatus,
    lastSyncedAt: i.lastSyncedAt?.toISOString() ?? null,
    lastError: i.lastError,
    lastErrorAt: i.lastErrorAt?.toISOString() ?? null,
    syncCadenceMinutes: i.syncCadenceMinutes,
    createdAt: i.createdAt.toISOString(),
  };
}

/** Serialize a task row to its {@link TaskOut} representation. */
export function toTaskOut(t: TaskRow): z.input<typeof TaskOut> {
  return {
    id: t.id,
    organizationId: t.organizationId,
    title: t.title,
    description: t.description,
    teamId: t.teamId,
    state: t.state,
    priority: t.priority,
    assigneeId: t.assigneeId,
    delegateId: t.delegateId,
    projectId: t.projectId,
    programId: t.programId,
    dueDate: t.dueDate?.toISOString() ?? null,
    provenance: {
      source: t.source,
      sourceIntegrationId: t.sourceIntegrationId,
      externalId: t.externalId,
      externalUrl: t.externalUrl,
      syncMode: t.sourceSyncMode,
    },
    createdAt: t.createdAt.toISOString(),
  };
}
