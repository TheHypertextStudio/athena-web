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
