/** `@docket/api` — integrations router (mounted at `/v1/orgs/:orgId/integrations`). */
import { db, integration } from '@docket/db';
import {
  IntegrationCreate,
  IntegrationDirectoryOut,
  IntegrationOut,
  IntegrationUpdate,
  pageOf,
  SyncJobOut,
  TaskOut,
} from '@docket/types';
import type { ImportedItem } from '@docket/boundaries';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

import {
  CONNECTOR_PROVIDERS,
  PROVIDER_DIRECTORY,
  asConnectorProvider,
  connectorFor,
  resolveConnectorToken,
  socialProviderId,
  toOut,
} from './integration-provider';
import { SYNC_JOBS, type SyncJob, nextSyncJobId, toSyncJobOut } from './integration-sync-jobs';
import { importItems, resolveImportTeam } from './integration-import';

/** `assignToImporter` lands new linked tasks under My Work's "Assigned to me". */
const ImportBody = z.object({
  assignToImporter: z.boolean().optional().default(false),
});

const idParam = z.object({ id: z.string() });
const jobIdParam = z.object({ jobId: z.string() });

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

    // Connecting a provider is idempotent per (org, provider): reconnecting reuses the
    // existing integration (refreshing fields) to keep the integration id — and so each
    // mirrored task's `sourceIntegrationId` — stable across reconnects.
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

      const token = await resolveConnectorToken(actorId, provider);
      if (!token) {
        throw new ConflictError(
          `Sign in with ${socialProviderId(provider)} to import from this integration.`,
        );
      }

      const teamId = await resolveImportTeam(orgId, row);

      let items: ImportedItem[];
      try {
        items = await connectorFor(provider, token).importWork({
          connectionId: row.id,
          provider,
          ...(row.connection.externalWorkspaceId
            ? { externalWorkspaceId: row.connection.externalWorkspaceId }
            : {}),
        });
      } catch (err) {
        throw new ConflictError(
          err instanceof Error ? err.message : 'Connector failed to import work',
        );
      }

      // Onboarding sends `assignToImporter: true` so the owner's freshly-mirrored work lands
      // under My Work's "Assigned to me". The general sync path omits it (Triage instead).
      const created = await importItems(orgId, actorId, row.id, teamId, items, {
        assigneeId: assignToImporter ? actorId : null,
      });
      return ok(c, pageOf(TaskOut), { items: created });
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

    const token = await resolveConnectorToken(actorId, provider);
    if (!token) {
      throw new ConflictError(
        `Sign in with ${socialProviderId(provider)} to sync this integration.`,
      );
    }

    const teamId = await resolveImportTeam(orgId, row);

    let syncItems: ImportedItem[];
    let created: Awaited<ReturnType<typeof importItems>>;
    try {
      syncItems = await connectorFor(provider, token).importWork({
        connectionId: row.id,
        provider,
        ...(row.connection.externalWorkspaceId
          ? { externalWorkspaceId: row.connection.externalWorkspaceId }
          : {}),
      });
      created = await importItems(orgId, actorId, row.id, teamId, syncItems, { assigneeId: null });
    } catch (err) {
      const failedJob: SyncJob = {
        jobId: nextSyncJobId(),
        organizationId: orgId,
        integrationId: row.id,
        status: 'failed',
        processed: 0,
        total: 0,
        error: err instanceof Error ? err.message : 'Connector error',
        createdAt: new Date().toISOString(),
      };
      SYNC_JOBS.set(failedJob.jobId, failedJob);
      return ok(c, SyncJobOut, toSyncJobOut(failedJob));
    }

    const job: SyncJob = {
      jobId: nextSyncJobId(),
      organizationId: orgId,
      integrationId: row.id,
      status: 'succeeded',
      processed: created.length,
      total: syncItems.length,
      error: null,
      createdAt: new Date().toISOString(),
    };
    SYNC_JOBS.set(job.jobId, job);
    return ok(c, SyncJobOut, toSyncJobOut(job));
  });

export default integrations;
