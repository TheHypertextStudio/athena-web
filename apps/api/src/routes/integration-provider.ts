import { actor, db } from '@docket/db';
import type { integration, task } from '@docket/db';
import { auth } from '@docket/auth';
import type { IntegrationOut, TaskOut } from '@docket/types';
import { type IntegrationDirectoryProvider } from '@docket/types';
import type { ConnectorProvider } from '@docket/boundaries';
import { selectAdapter } from '@docket/boundaries';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';

import { toBoundaryEnv } from '../container';
import { env } from '../env';

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
];

/**
 * The connect-wizard directory entry for each {@link ConnectorProvider}.
 *
 * @remarks
 * Keyed off the {@link Connector} port's provider union: a Migration pattern *replaces* a
 * tool, a Connector pattern *complements* one.
 */
export const PROVIDER_DIRECTORY: Readonly<
  Record<ConnectorProvider, Omit<IntegrationDirectoryProvider, 'provider'>>
> = {
  github: {
    name: 'GitHub',
    pattern: 'connector',
    roles: ['code', 'work'],
    category: 'engineering',
  },
  linear: { name: 'Linear', pattern: 'migration', roles: ['work'], category: 'project-management' },
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
};

/** Narrow a stored integration `provider` string to a {@link ConnectorProvider}. */
export function asConnectorProvider(provider: string): ConnectorProvider | null {
  return CONNECTOR_PROVIDERS.find((p) => p === provider) ?? null;
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
 * Resolve a fresh OAuth access token for a connector provider on behalf of an Actor.
 *
 * @remarks
 * Resolves the Actor's global Better Auth `user` (an Actor id is NOT a user id — the prior
 * code compared the two id spaces directly, so it never matched in production), then asks
 * Better Auth for the access token. `auth.api.getAccessToken` transparently REFRESHES an
 * expired token via the stored refresh token — essential for background syncs that run while
 * nobody is signed in. Any failure (no linked account, revoked grant, refresh failure) becomes
 * a single `needs_reauth` outcome with a "Sign in with X" message, never a silent skip.
 *
 * In `APP_MODE=local`/`test` a sentinel `'mock'` token is returned immediately (no DB round
 * trip, no real credentials), and {@link selectAdapter} forces the mock connector anyway.
 *
 * @param actorId - The Actor whose linked provider grant should be used (e.g. the integration's
 *   `createdBy` for a background run, or the request actor for a manual one).
 * @param provider - The connector provider whose token is needed.
 */
export async function resolveConnectorToken(
  actorId: string,
  provider: ConnectorProvider,
): Promise<ConnectorTokenResult> {
  const mode = env.APP_MODE;
  if (mode === 'local' || mode === 'test') return { ok: true, token: 'mock' };

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
    const result = await auth.api.getAccessToken({ body: { providerId, userId } });
    if (!result.accessToken) return needsReauth;
    return { ok: true, token: result.accessToken };
  } catch {
    // getAccessToken throws when no account is linked or the refresh-token exchange fails —
    // both mean the user must re-authorize. Surfaced (never swallowed into a fake success).
    return needsReauth;
  }
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
    syncMode: i.syncMode,
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
