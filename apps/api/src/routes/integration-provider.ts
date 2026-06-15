import { account, db } from '@docket/db';
import type { integration, task } from '@docket/db';
import type { IntegrationOut, TaskOut } from '@docket/types';
import { type IntegrationDirectoryProvider } from '@docket/types';
import type { ConnectorProvider } from '@docket/boundaries';
import { selectAdapter } from '@docket/boundaries';
import { and, eq } from 'drizzle-orm';
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
 * Look up the stored OAuth access token for a connector provider from the actor's
 * Better Auth social account.
 *
 * @remarks
 * In `APP_MODE=local`/`test` a sentinel `'mock'` is returned immediately — no DB round-trip,
 * no real credentials needed. In production `null` means they haven't signed in with the
 * provider and the caller must surface a clear error (no mock fallback).
 */
export async function resolveConnectorToken(
  actorId: string,
  provider: ConnectorProvider,
): Promise<string | null> {
  const mode = env.APP_MODE;
  if (mode === 'local' || mode === 'test') return 'mock';

  const rows = await db
    .select({ accessToken: account.accessToken })
    .from(account)
    .where(and(eq(account.userId, actorId), eq(account.providerId, socialProviderId(provider))))
    .limit(1);
  return rows[0]?.accessToken ?? null;
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
