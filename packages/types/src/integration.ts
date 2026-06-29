/**
 * `@docket/types` — Integration slice DTOs.
 *
 * @remarks
 * An integration is an org-scoped external connection — either a Migration (replace)
 * or a Connector (complement) — that contributes one or more roles (work/context/
 * signal/time/code) and syncs by one-time import or read-only mirror. The connection
 * metadata never stores the secret itself (only a `credentialsRef`).
 */
import { z } from 'zod';

import { IntegrationId, OrganizationId } from './primitives';

/** Integration pattern: replace (migration) vs complement (connector). */
export const IntegrationPattern = z.enum(['migration', 'connector']);
/** Integration-pattern value. */
export type IntegrationPattern = z.infer<typeof IntegrationPattern>;

/** What an integration contributes: work, context, signal, time, or code. */
export const IntegrationRole = z.enum(['work', 'context', 'signal', 'time', 'code']);
/** Integration-role value. */
export type IntegrationRole = z.infer<typeof IntegrationRole>;

/**
 * Integration connection health.
 *
 * @remarks
 * `pending` is the initial state: the integration exists but its credential has NOT been
 * validated by a real `connect()`, so it must never be shown as connected. Only a successful
 * connect/sync promotes it to `connected`; any failed connect, sync, or token refresh demotes
 * it to `error`. This is the spine of the "never report success when nothing happened" rule.
 */
export const IntegrationStatus = z.enum(['pending', 'connected', 'error', 'disconnected']);
/** Integration-status value. */
export type IntegrationStatus = z.infer<typeof IntegrationStatus>;

/** Integration sync depth: one-time import vs read-only mirror. */
export const SyncMode = z.enum(['import', 'mirror']);
/** Sync-mode value. */
export type SyncMode = z.infer<typeof SyncMode>;

/** An external integration's connection metadata (never the secret itself). */
export const IntegrationConnection = z
  .object({
    account: z.string().optional(),
    credentialsRef: z.string().optional(),
    externalWorkspaceId: z.string().optional(),
  })
  .meta({ id: 'IntegrationConnection', description: "An integration's connection metadata." });
/** Integration-connection value. */
export type IntegrationConnection = z.infer<typeof IntegrationConnection>;

/**
 * Per-connector sync configuration, stored in the integration's freeform `config` jsonb but
 * validated to this shape at the route for two-way connectors (Google Tasks).
 *
 * @remarks
 * - `teamId`/`projectId` — where mirrored linked tasks land (see `resolveImportTeam`).
 * - `listIds` — which external task lists to sync (empty/absent = all lists).
 * - `defaultListId` — the external list a pushed native task is created in.
 * - `pushNativeTasks` — opt-in: also push `native` Docket tasks in the target team out to the
 *   provider as new external tasks (default off, to avoid surprising bulk creation).
 */
export const ConnectorConfig = z
  .object({
    teamId: z.string().optional(),
    projectId: z.string().optional(),
    listIds: z.array(z.string()).optional(),
    defaultListId: z.string().optional(),
    pushNativeTasks: z.boolean().optional(),
  })
  .meta({
    id: 'ConnectorConfig',
    description: 'Per-connector sync configuration (task lists, target team, write-back options).',
  });
/** Validated connector-config value. */
export type ConnectorConfig = z.infer<typeof ConnectorConfig>;

/** A selectable external container (e.g. a Google Tasks list) offered in the config UI. */
export const ConnectorResourceRef = z
  .object({
    id: z.string(),
    title: z.string(),
  })
  .meta({
    id: 'ConnectorResourceRef',
    description: 'A selectable external container (task list).',
  });
/** Connector-resource-ref value. */
export type ConnectorResourceRef = z.infer<typeof ConnectorResourceRef>;

/** The set of external containers a connector can sync from (e.g. Google Tasks lists). */
export const ConnectorResourceListOut = z
  .object({
    resources: z.array(ConnectorResourceRef),
  })
  .meta({
    id: 'ConnectorResourceListOut',
    description: 'External containers (task lists) the connector exposes for selection.',
  });
/** Connector-resource-list value. */
export type ConnectorResourceListOut = z.infer<typeof ConnectorResourceListOut>;

/**
 * Body for creating an Integration (organizationId comes from the path, never the body).
 *
 * @remarks
 * `status` is intentionally NOT accepted: connection health is *earned* by a real
 * `connect()`/sync, never declared by the caller. New integrations always start `pending`.
 */
export const IntegrationCreate = z
  .object({
    provider: z.string().min(1),
    pattern: IntegrationPattern,
    roles: z.array(IntegrationRole).optional(),
    connection: IntegrationConnection.optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    syncMode: SyncMode.optional(),
    writeBack: z.boolean().optional(),
    /**
     * The provider account this integration binds to (Google `sub`), letting one org link
     * multiple accounts of the same provider. Used to disambiguate the OAuth grant at sync time.
     */
    externalAccountId: z.string().optional(),
  })
  .meta({ id: 'IntegrationCreate', description: 'Create an integration within an organization.' });
/** Validated integration-create body. */
export type IntegrationCreate = z.infer<typeof IntegrationCreate>;

/**
 * Body for updating an Integration's roles, connection, config, or sync mode.
 *
 * @remarks
 * `status` is intentionally NOT accepted — see {@link IntegrationCreate}. Health transitions
 * only through the connect/verify and sync paths, so a client can never fabricate `connected`.
 */
export const IntegrationUpdate = z
  .object({
    roles: z.array(IntegrationRole).optional(),
    connection: IntegrationConnection.optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    syncMode: SyncMode.optional(),
    writeBack: z.boolean().optional(),
  })
  .meta({ id: 'IntegrationUpdate', description: 'Update an integration.' });
/** Validated integration-update body. */
export type IntegrationUpdate = z.infer<typeof IntegrationUpdate>;

/** A provider listed in the connect-wizard directory. */
export const IntegrationDirectoryProvider = z
  .object({
    provider: z.string(),
    name: z.string(),
    pattern: IntegrationPattern,
    roles: z.array(IntegrationRole),
    category: z.string(),
  })
  .meta({
    id: 'IntegrationDirectoryProvider',
    description: 'An available integration provider with its pattern, roles, and category.',
  });
/** Directory-provider value. */
export type IntegrationDirectoryProvider = z.infer<typeof IntegrationDirectoryProvider>;

/** The categorized directory of available integration providers (connect-wizard data). */
export const IntegrationDirectoryOut = z
  .object({
    providers: z.array(IntegrationDirectoryProvider),
  })
  .meta({
    id: 'IntegrationDirectoryOut',
    description: 'The set of providers Docket can connect to, with their patterns and roles.',
  });
/** Directory representation value. */
export type IntegrationDirectoryOut = z.infer<typeof IntegrationDirectoryOut>;

/** Lifecycle status of a single connector sync run (one `importWork` pass). */
export const SyncRunStatus = z.enum(['running', 'succeeded', 'failed']);
/** Sync-run-status value. */
export type SyncRunStatus = z.infer<typeof SyncRunStatus>;

/** What triggered a sync run: a user action or the background scheduler. */
export const SyncTrigger = z.enum(['manual', 'scheduled']);
/** Sync-trigger value. */
export type SyncTrigger = z.infer<typeof SyncTrigger>;

/**
 * The durable record of one connector sync run.
 *
 * @remarks
 * Replaces the former ephemeral `SyncJobOut` (an in-memory job wiped on every restart). Each
 * run is persisted, so a failure leaves a real, auditable trace instead of vanishing.
 */
export const SyncRunOut = z
  .object({
    id: z.string(),
    integrationId: IntegrationId,
    status: SyncRunStatus,
    trigger: SyncTrigger,
    processed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    error: z.string().nullable(),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
  })
  .meta({ id: 'SyncRunOut', description: 'The result of one integration sync run.' });
/** Sync-run representation value. */
export type SyncRunOut = z.infer<typeof SyncRunOut>;

/** Full integration representation returned by reads. */
export const IntegrationOut = z
  .object({
    id: IntegrationId,
    organizationId: OrganizationId,
    provider: z.string(),
    pattern: IntegrationPattern,
    roles: z.array(IntegrationRole),
    connection: IntegrationConnection,
    status: IntegrationStatus,
    config: z.record(z.string(), z.unknown()),
    /** The bound provider account (Google `sub`); null for single-account/legacy integrations. */
    externalAccountId: z.string().nullable(),
    syncMode: SyncMode,
    /** Whether this connector also writes Docket changes back to the provider (two-way sync). */
    writeBack: z.boolean(),
    /** Status of the most recent sync run (null = never synced). */
    lastSyncStatus: SyncRunStatus.nullable(),
    /** ISO-8601 timestamp of the last SUCCESSFUL sync (null = never succeeded). */
    lastSyncedAt: z.string().nullable(),
    /** Why the connection/last-sync is unhealthy (null = healthy). */
    lastError: z.string().nullable(),
    /** ISO-8601 timestamp the {@link IntegrationOut.lastError} was recorded. */
    lastErrorAt: z.string().nullable(),
    /** Background re-sync cadence in minutes (null = manual-only). */
    syncCadenceMinutes: z.number().int().positive().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'IntegrationOut', description: 'An external integration.' });
/** Integration representation value. */
export type IntegrationOut = z.infer<typeof IntegrationOut>;
