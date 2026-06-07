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
 */
import { db, integration, task, team } from '@docket/db';
import {
  IntegrationCreate,
  IntegrationOut,
  IntegrationUpdate,
  pageOf,
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
];

/** Narrow a stored integration `provider` string to a {@link ConnectorProvider}. */
function asConnectorProvider(provider: string): ConnectorProvider | null {
  return CONNECTOR_PROVIDERS.find((p) => p === provider) ?? null;
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
    const inserted = await db
      .insert(integration)
      .values({
        organizationId: orgId,
        provider: body.provider,
        pattern: body.pattern,
        ...(body.roles !== undefined ? { roles: body.roles } : {}),
        ...(body.connection !== undefined ? { connection: body.connection } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.config !== undefined ? { config: body.config } : {}),
        ...(body.syncMode !== undefined ? { syncMode: body.syncMode } : {}),
        createdBy: actorId,
      })
      .returning();
    const row = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
    if (!row) throw new Error('integration insert returned no row');
    return ok(c, IntegrationOut, toOut(row));
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
    zJson(z.object({})),
    async (c) => {
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
      if (!provider) throw new ConflictError('Integration provider does not support import');

      const teamId = await resolveImportTeam(orgId, row);

      const items = await getContainer().connector.importWork({
        connectionId: row.id,
        provider,
        ...(row.connection.externalWorkspaceId
          ? { externalWorkspaceId: row.connection.externalWorkspaceId }
          : {}),
      });

      const created = await importItems(orgId, actorId, row.id, teamId, items);
      return ok(c, pageOf(TaskOut), { items: created.map(toTaskOut) });
    },
  );

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
 * @returns the newly created task rows (existing ones are omitted).
 */
async function importItems(
  orgId: string,
  actorId: string,
  integrationId: string,
  teamId: string,
  items: readonly ImportedItem[],
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
