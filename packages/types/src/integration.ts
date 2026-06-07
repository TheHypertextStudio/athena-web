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

/** Integration connection health. */
export const IntegrationStatus = z.enum(['connected', 'error', 'disconnected']);
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

/** Body for creating an Integration (organizationId comes from the path, never the body). */
export const IntegrationCreate = z
  .object({
    provider: z.string().min(1),
    pattern: IntegrationPattern,
    roles: z.array(IntegrationRole).optional(),
    connection: IntegrationConnection.optional(),
    status: IntegrationStatus.optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    syncMode: SyncMode.optional(),
  })
  .meta({ id: 'IntegrationCreate', description: 'Create an integration within an organization.' });
/** Validated integration-create body. */
export type IntegrationCreate = z.infer<typeof IntegrationCreate>;

/** Body for updating an Integration's roles, connection, status, config, or sync mode. */
export const IntegrationUpdate = z
  .object({
    roles: z.array(IntegrationRole).optional(),
    connection: IntegrationConnection.optional(),
    status: IntegrationStatus.optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    syncMode: SyncMode.optional(),
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

/** Lifecycle status of a connector sync / migration-import job. */
export const SyncJobStatus = z.enum(['queued', 'running', 'succeeded', 'failed']);
/** Sync-job-status value. */
export type SyncJobStatus = z.infer<typeof SyncJobStatus>;

/** The status of a sync (connector mirror refresh) or import (migration) job. */
export const SyncJobOut = z
  .object({
    jobId: z.string(),
    integrationId: IntegrationId,
    status: SyncJobStatus,
    processed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    error: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'SyncJobOut', description: 'The progress/status of an integration sync job.' });
/** Sync-job representation value. */
export type SyncJobOut = z.infer<typeof SyncJobOut>;

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
    syncMode: SyncMode,
    createdAt: z.string(),
  })
  .meta({ id: 'IntegrationOut', description: 'An external integration.' });
/** Integration representation value. */
export type IntegrationOut = z.infer<typeof IntegrationOut>;
