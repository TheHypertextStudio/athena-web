/**
 * `@docket/api` — integrations router (mounted at `/v1/orgs/:orgId/integrations`).
 *
 * @remarks
 * Org-scoped CRUD over external {@link integration}s (a Migration replaces a tool, a
 * Connector complements one). Each carries its provider, contributing roles, sync
 * mode, status, and connection metadata (which never stores the secret itself).
 * `manage` is required to mutate; `POST /:id/import` (capability `contribute`) pulls
 * work through the {@link getContainer | container}'s {@link Connector} (the
 * MockConnector under `APP_MODE=local`) and materializes each {@link ImportedItem} as
 * a linked {@link task} carrying its provenance, idempotently.
 *
 * `GET /directory` returns the categorized provider directory the connect wizard reads.
 * `POST /:id/sync` (capability `manage`) refreshes a connector's read-only mirror via
 * the same {@link Connector} port, recording a {@link SyncJob} whose status is read
 * back through `GET /jobs/:jobId`. The Connector is never hardcoded to one provider —
 * everything keys off the port's {@link ConnectorProvider} union.
 */
import { db, integration, task, team } from '@docket/db';
import {
  IntegrationCreate,
  IntegrationDirectoryOut,
  type IntegrationDirectoryProvider,
  IntegrationOut,
  IntegrationUpdate,
  pageOf,
  SyncJobOut,
  TaskOut,
} from '@docket/types';
import type { ConnectorProvider, ImportedItem } from '@docket/boundaries';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { getContainer } from '../container';
import { ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

type IntegrationRow = typeof integration.$inferSelect;
type TaskRow = typeof task.$inferSelect;

/** The providers the {@link Connector} port can import from. */
const CONNECTOR_PROVIDERS: readonly ConnectorProvider[] = [
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
 * Keyed off the {@link Connector} port's provider union (never a single hardcoded
 * provider): a Migration pattern *replaces* a tool, a Connector pattern *complements*
 * one. Each row declares the integration roles the provider contributes and the
 * category surfaced in the connect wizard.
 */
const PROVIDER_DIRECTORY: Readonly<
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
function asConnectorProvider(provider: string): ConnectorProvider | null {
  return CONNECTOR_PROVIDERS.find((p) => p === provider) ?? null;
}

/**
 * A sync/import job, materialized in-process from a {@link Connector} run.
 *
 * @remarks
 * The data model carries no `sync_job` table; a job is the auditable record of one
 * {@link Connector.importWork} run against the boundary port. It is created
 * synchronously (the run is deterministic against the mock connector) and retained in
 * a process-scoped registry for follow-up status reads. Scoped by `organizationId` so
 * `GET /jobs/:jobId` enforces tenant isolation.
 */
interface SyncJob {
  /** The job id (also the registry key). */
  readonly jobId: string;
  /** The org the job belongs to (tenant-isolation key). */
  readonly organizationId: string;
  /** The integration the job synced. */
  readonly integrationId: string;
  /** The job's terminal/lifecycle status. */
  readonly status: z.infer<typeof SyncJobOut>['status'];
  /** Count of items materialized (new linked tasks created). */
  readonly processed: number;
  /** Count of items the connector returned for this run. */
  readonly total: number;
  /** Failure detail, when the job failed. */
  readonly error: string | null;
  /** ISO-8601 time the job was recorded. */
  readonly createdAt: string;
}

/**
 * The process-scoped registry of {@link SyncJob}s.
 *
 * @remarks
 * In-memory because the data model has no `sync_job` table; this is the smallest store
 * that satisfies the `POST /:id/sync` → `GET /jobs/:jobId` contract while keeping the
 * connector behind its port. A monotonic counter yields deterministic, collision-free
 * job ids within a process.
 */
const SYNC_JOBS = new Map<string, SyncJob>();
let syncJobCounter = 0;

/** Mint the next process-unique sync-job id. */
function nextSyncJobId(): string {
  syncJobCounter += 1;
  return `syncjob_${syncJobCounter.toString().padStart(8, '0')}`;
}

/** Serialize a {@link SyncJob} to its {@link SyncJobOut} representation. */
function toSyncJobOut(job: SyncJob): z.input<typeof SyncJobOut> {
  return {
    jobId: job.jobId,
    integrationId: job.integrationId,
    status: job.status,
    processed: job.processed,
    total: job.total,
    error: job.error,
    createdAt: job.createdAt,
  };
}

/** Serialize a {@link task} row to its {@link TaskOut} representation. */
function toTaskOut(t: TaskRow): z.input<typeof TaskOut> {
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

function toOut(i: IntegrationRow): z.input<typeof IntegrationOut> {
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

const idParam = z.object({ id: z.string() });
const jobIdParam = z.object({ jobId: z.string() });

/**
 * The `POST /:id/import` request body.
 *
 * @remarks
 * `assignToImporter` (default `false`) assigns each newly-mirrored linked task to the actor
 * running the import. Onboarding sets this so the owner's connected work appears under My Work's
 * "Assigned to me" — a visibly populated landing screen — while the general/sync import path
 * leaves it off, keeping org-wide mirrored work unassigned (surfaced in Triage).
 */
const ImportBody = z.object({
  assignToImporter: z.boolean().optional().default(false),
});

/** Integrations router: org-scoped CRUD over external migrations + connectors. */
const integrations = new Hono<AppEnv>()
  .get('/', async (c) => {
    const { orgId } = c.get('actorCtx');
    const rows = await db.select().from(integration).where(eq(integration.organizationId, orgId));
    return ok(c, pageOf(IntegrationOut), { items: rows.map(toOut) });
  })
  .post('/', capabilityGuard('manage'), zJson(IntegrationCreate), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const body = c.req.valid('json');

    // Connecting a provider is idempotent per (org, provider): reconnecting an
    // already-connected source reuses the existing integration (refreshing the supplied
    // fields) rather than inserting a duplicate. This keeps the integration id — and so each
    // mirrored task's `sourceIntegrationId` — stable across reconnects, so re-importing
    // dedupes against the prior mirror instead of producing duplicate linked tasks.
    const fields = {
      ...(body.roles !== undefined ? { roles: body.roles } : {}),
      ...(body.connection !== undefined ? { connection: body.connection } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.config !== undefined ? { config: body.config } : {}),
      ...(body.syncMode !== undefined ? { syncMode: body.syncMode } : {}),
    };

    const existing = await db
      .select({ id: integration.id })
      .from(integration)
      .where(and(eq(integration.organizationId, orgId), eq(integration.provider, body.provider)))
      .limit(1);

    if (existing[0]) {
      const updated = await db
        .update(integration)
        .set({ pattern: body.pattern, ...fields })
        .where(eq(integration.id, existing[0].id))
        .returning();
      const row = updated[0];
      /* v8 ignore next -- @preserve defensive: the row was just verified to exist */
      if (!row) throw new Error('integration update returned no row');
      return ok(c, IntegrationOut, toOut(row));
    }

    const inserted = await db
      .insert(integration)
      .values({
        organizationId: orgId,
        provider: body.provider,
        pattern: body.pattern,
        ...fields,
        createdBy: actorId,
      })
      .returning();
    const row = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
    if (!row) throw new Error('integration insert returned no row');
    return ok(c, IntegrationOut, toOut(row));
  })
  .get('/directory', async (c) => {
    const providers: z.input<typeof IntegrationDirectoryOut>['providers'] = CONNECTOR_PROVIDERS.map(
      (provider) => ({ provider, ...PROVIDER_DIRECTORY[provider] }),
    );
    return ok(c, IntegrationDirectoryOut, { providers });
  })
  .get('/jobs/:jobId', zParam(jobIdParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { jobId } = c.req.valid('param');
    const job = SYNC_JOBS.get(jobId);
    if (job?.organizationId !== orgId) throw new NotFoundError('Sync job not found');
    return ok(c, SyncJobOut, toSyncJobOut(job));
  })
  .get('/:id', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const rows = await db
      .select()
      .from(integration)
      .where(and(eq(integration.id, id), eq(integration.organizationId, orgId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Integration not found');
    return ok(c, IntegrationOut, toOut(row));
  })
  .patch(
    '/:id',
    capabilityGuard('manage'),
    zParam(idParam),
    zJson(IntegrationUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');

      const existing = await db
        .select()
        .from(integration)
        .where(and(eq(integration.id, id), eq(integration.organizationId, orgId)))
        .limit(1);
      if (!existing[0]) throw new NotFoundError('Integration not found');

      const updated = await db
        .update(integration)
        .set({
          ...(body.roles !== undefined ? { roles: body.roles } : {}),
          ...(body.connection !== undefined ? { connection: body.connection } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.config !== undefined ? { config: body.config } : {}),
          ...(body.syncMode !== undefined ? { syncMode: body.syncMode } : {}),
        })
        .where(and(eq(integration.id, id), eq(integration.organizationId, orgId)))
        .returning();
      const row = updated[0];
      /* v8 ignore next -- @preserve defensive: the integration was verified to exist above */
      if (!row) throw new NotFoundError('Integration not found');
      return ok(c, IntegrationOut, toOut(row));
    },
  )
  .delete('/:id', capabilityGuard('manage'), zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const deleted = await db
      .delete(integration)
      .where(and(eq(integration.id, id), eq(integration.organizationId, orgId)))
      .returning();
    const row = deleted[0];
    if (!row) throw new NotFoundError('Integration not found');
    return ok(c, IntegrationOut, toOut(row));
  })
  .post(
    '/:id/import',
    capabilityGuard('contribute'),
    zParam(idParam),
    zJson(ImportBody),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { assignToImporter } = c.req.valid('json');

      const rows = await db
        .select()
        .from(integration)
        .where(and(eq(integration.id, id), eq(integration.organizationId, orgId)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new NotFoundError('Integration not found');

      const provider = asConnectorProvider(row.provider);
      if (!provider) throw new ConflictError('Integration provider does not support import');

      const teamId = await resolveImportTeam(orgId, row);

      const items = await getContainer().connector.importWork({
        connectionId: row.id,
        provider,
        ...(row.connection.externalWorkspaceId
          ? { externalWorkspaceId: row.connection.externalWorkspaceId }
          : {}),
      });

      // Onboarding sends `assignToImporter: true` so the owner's freshly-mirrored work lands
      // under My Work's "Assigned to me" (a populated landing screen). The general sync path
      // omits it, keeping org-wide mirrored work unassigned (it surfaces in Triage).
      const created = await importItems(orgId, actorId, row.id, teamId, items, {
        assigneeId: assignToImporter ? actorId : null,
      });
      return ok(c, pageOf(TaskOut), { items: created.map(toTaskOut) });
    },
  )
  .post('/:id/sync', capabilityGuard('manage'), zParam(idParam), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const { id } = c.req.valid('param');

    const rows = await db
      .select()
      .from(integration)
      .where(and(eq(integration.id, id), eq(integration.organizationId, orgId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Integration not found');

    const provider = asConnectorProvider(row.provider);
    if (!provider) throw new ConflictError('Integration provider does not support sync');

    const teamId = await resolveImportTeam(orgId, row);

    const items = await getContainer().connector.importWork({
      connectionId: row.id,
      provider,
      ...(row.connection.externalWorkspaceId
        ? { externalWorkspaceId: row.connection.externalWorkspaceId }
        : {}),
    });

    const created = await importItems(orgId, actorId, row.id, teamId, items, { assigneeId: null });

    const job: SyncJob = {
      jobId: nextSyncJobId(),
      organizationId: orgId,
      integrationId: row.id,
      status: 'succeeded',
      processed: created.length,
      total: items.length,
      error: null,
      createdAt: new Date().toISOString(),
    };
    SYNC_JOBS.set(job.jobId, job);
    return ok(c, SyncJobOut, toSyncJobOut(job));
  });

/**
 * Resolve the team a linked task should land in for an import.
 *
 * @remarks
 * Prefers a `teamId` configured on the integration's `config`, validated to belong to
 * the org; otherwise falls back to the org's earliest-created team.
 *
 * @param orgId - The active organization id.
 * @param row - The integration being imported from.
 * @returns the resolved team id.
 * @throws {ConflictError} When the org has no team to attach imported work to.
 */
async function resolveImportTeam(orgId: string, row: IntegrationRow): Promise<string> {
  const configured = row.config['teamId'];
  if (typeof configured === 'string') {
    const teamRows = await db
      .select({ id: team.id })
      .from(team)
      .where(and(eq(team.id, configured), eq(team.organizationId, orgId)))
      .limit(1);
    if (teamRows[0]) return teamRows[0].id;
  }
  const firstTeam = await db
    .select({ id: team.id })
    .from(team)
    .where(eq(team.organizationId, orgId))
    .orderBy(asc(team.createdAt))
    .limit(1);
  if (!firstTeam[0]) throw new ConflictError('Organization has no team to import work into');
  return firstTeam[0].id;
}

/** Options controlling how imported items are materialized. */
interface ImportItemsOptions {
  /**
   * The actor to assign each newly-mirrored linked task to, or `null` to leave it unassigned.
   *
   * @remarks
   * Onboarding passes the importing owner so the mirrored work lands under My Work's "Assigned
   * to me"; the general/sync path passes `null`, keeping org-wide mirrored work unassigned.
   */
  readonly assigneeId: string | null;
}

/**
 * Materialize imported items as linked tasks, skipping any already imported.
 *
 * @remarks
 * Each {@link ImportedItem} becomes a `linked` {@link task} (provenance
 * `source='linked'`, `sourceIntegrationId`, `externalId`/`externalUrl`,
 * `sourceSyncMode='mirror'`). Idempotency: an item whose `(sourceIntegrationId,
 * externalId)` linked task already exists is skipped, so re-importing is safe.
 *
 * @param orgId - The active organization id.
 * @param actorId - The actor performing the import (recorded as `createdBy`).
 * @param integrationId - The source integration id.
 * @param teamId - The team the linked tasks attach to.
 * @param items - The imported items to materialize.
 * @param options - Materialization options (e.g. whether to assign to the importer).
 * @returns the newly created task rows (existing ones are omitted).
 */
async function importItems(
  orgId: string,
  actorId: string,
  integrationId: string,
  teamId: string,
  items: readonly ImportedItem[],
  options: ImportItemsOptions,
): Promise<TaskRow[]> {
  const teamRows = await db
    .select({ workflowStates: team.workflowStates })
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, orgId)))
    .limit(1);
  const state = teamRows[0]?.workflowStates[0]?.key ?? 'backlog';

  const created: TaskRow[] = [];
  for (const item of items) {
    const externalId = item.provenance.externalId;
    const existing = await db
      .select({ id: task.id })
      .from(task)
      .where(
        and(
          eq(task.organizationId, orgId),
          eq(task.source, 'linked'),
          eq(task.sourceIntegrationId, integrationId),
          eq(task.externalId, externalId),
        ),
      )
      .limit(1);
    if (existing[0]) continue;

    const inserted = await db
      .insert(task)
      .values({
        organizationId: orgId,
        title: item.title,
        description: item.body ?? null,
        teamId,
        state,
        ...(options.assigneeId !== null ? { assigneeId: options.assigneeId } : {}),
        source: 'linked',
        sourceIntegrationId: integrationId,
        externalId,
        externalUrl: item.provenance.externalUrl ?? null,
        sourceSyncMode: 'mirror',
        createdBy: actorId,
      })
      .returning();
    const taskRow = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
    if (!taskRow) throw new Error('linked task insert returned no row');
    created.push(taskRow);
  }
  return created;
}

export default integrations;
