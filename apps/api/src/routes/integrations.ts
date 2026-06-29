/** `@docket/api` — integrations router (mounted at `/v1/orgs/:orgId/integrations`). */
import { db, integration, syncRun } from '@docket/db';
import {
  ConnectorResourceListOut,
  IntegrationCreate,
  IntegrationDirectoryOut,
  IntegrationOut,
  IntegrationUpdate,
  pageOf,
  SyncRunOut,
  TaskOut,
} from '@docket/types';
import type { ImportedItem } from '@docket/boundaries';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { zJson, zParam } from '../lib/validate';
import { buildInstallUrl, signInstallState } from '../lib/github-app';
import { capabilityGuard } from '../permissions/capability-guard';

import {
  CONNECTOR_PROVIDERS,
  PROVIDER_DIRECTORY,
  WRITE_BACK_PROVIDERS,
  asConnectorProvider,
  connectorFor,
  type IntegrationRow,
  resolveConnectorToken,
  resolveIdentityLabel,
  socialProviderId,
  toOut,
} from './integration-provider';
import { runSync, toSyncRunOut } from './integration-sync';
import { importItems, resolveImportTeam } from './integration-import';

/** `assignToImporter` lands new linked tasks under My Work's "Assigned to me". */
const ImportBody = z.object({
  assignToImporter: z.boolean().optional().default(false),
});

const idParam = z.object({ id: z.string() });

/** Update an integration's mutable health/sync fields, returning the fresh row. */
async function setIntegration(
  id: string,
  patch: Partial<typeof integration.$inferInsert>,
): Promise<IntegrationRow> {
  const updated = await db.update(integration).set(patch).where(eq(integration.id, id)).returning();
  const row = updated[0];
  if (!row) throw new NotFoundError('Integration not found');
  return row;
}

/** Load an org-scoped integration or 404 (existence-hiding across tenants). */
async function loadIntegration(orgId: string, id: string): Promise<IntegrationRow> {
  const rows = await db
    .select()
    .from(integration)
    .where(and(eq(integration.id, id), eq(integration.organizationId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Integration not found');
  return row;
}

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
    //
    // Health is NEVER taken from the body: a new or reconnected integration starts `pending`
    // and clears any prior error, and is only promoted to `connected` once `POST /:id/verify`
    // (or a successful sync) actually validates the credential.
    // Default two-way write-back ON for connectors that support it (gtasks) unless the caller
    // says otherwise, so connecting Google Tasks is two-way out of the box.
    const writeBack = body.writeBack ?? WRITE_BACK_PROVIDERS.has(body.provider);
    const fields = {
      ...(body.roles !== undefined ? { roles: body.roles } : {}),
      ...(body.connection !== undefined ? { connection: body.connection } : {}),
      ...(body.config !== undefined ? { config: body.config } : {}),
      ...(body.syncMode !== undefined ? { syncMode: body.syncMode } : {}),
      ...(body.externalAccountId !== undefined
        ? { externalAccountId: body.externalAccountId }
        : {}),
      writeBack,
    };

    // Reconnect is idempotent per (org, provider, account): with an `externalAccountId` an org can
    // link several accounts of the same provider (one integration each); without one we preserve
    // the original single-account behavior (match the row that also has no bound account).
    const accountMatch = body.externalAccountId
      ? eq(integration.externalAccountId, body.externalAccountId)
      : isNull(integration.externalAccountId);
    const existing = await db
      .select({ id: integration.id })
      .from(integration)
      .where(
        and(
          eq(integration.organizationId, orgId),
          eq(integration.provider, body.provider),
          accountMatch,
        ),
      )
      .limit(1);

    if (existing[0]) {
      const row = await setIntegration(existing[0].id, {
        pattern: body.pattern,
        ...fields,
        status: 'pending',
        lastError: null,
        lastErrorAt: null,
      });
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
  .get('/:id', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const row = await loadIntegration(orgId, id);
    return ok(c, IntegrationOut, toOut(row));
  })
  .get('/:id/lists', capabilityGuard('manage'), zParam(idParam), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const row = await loadIntegration(orgId, id);

    const provider = asConnectorProvider(row.provider);
    if (!provider) throw new ConflictError('Integration provider has no selectable lists');

    // Enumerating the provider's task lists needs a live credential, so a broken connection
    // surfaces here as a real reason (not an empty list that looks like "no lists").
    const tokenResult = await resolveConnectorToken(actorId, provider, row.externalAccountId);
    if (!tokenResult.ok) throw new ConflictError(tokenResult.message);

    const resources =
      (await connectorFor(provider, tokenResult.token).listContainers?.({
        connectionId: row.id,
        provider,
      })) ?? [];
    return ok(c, ConnectorResourceListOut, { resources });
  })
  .get('/:id/runs', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    await loadIntegration(orgId, id);
    const runs = await db
      .select()
      .from(syncRun)
      .where(and(eq(syncRun.integrationId, id), eq(syncRun.organizationId, orgId)))
      .orderBy(desc(syncRun.startedAt))
      .limit(20);
    return ok(c, pageOf(SyncRunOut), { items: runs.map(toSyncRunOut) });
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

      await loadIntegration(orgId, id);
      const row = await setIntegration(id, {
        ...(body.roles !== undefined ? { roles: body.roles } : {}),
        ...(body.connection !== undefined ? { connection: body.connection } : {}),
        ...(body.config !== undefined ? { config: body.config } : {}),
        ...(body.syncMode !== undefined ? { syncMode: body.syncMode } : {}),
        ...(body.writeBack !== undefined ? { writeBack: body.writeBack } : {}),
      });
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
  .post('/:id/verify', capabilityGuard('manage'), zParam(idParam), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const row = await loadIntegration(orgId, id);

    const provider = asConnectorProvider(row.provider);
    if (!provider)
      throw new ConflictError('Integration provider does not support connection checks');

    // The ONLY place that promotes an integration to `connected` at connect time: a credential
    // must actually resolve the external account here. Failures are recorded as `error` with a
    // real reason and returned as 200 (the truthful integration state), never thrown away.
    const tokenResult = await resolveConnectorToken(actorId, provider, row.externalAccountId);
    if (!tokenResult.ok) {
      const updated = await setIntegration(id, {
        status: 'error',
        lastError: tokenResult.message,
        lastErrorAt: new Date(),
      });
      return ok(c, IntegrationOut, toOut(updated));
    }

    try {
      const result = await connectorFor(provider, tokenResult.token).connect({
        provider,
        referenceId: orgId,
        ...(row.connection.externalWorkspaceId
          ? { externalWorkspaceId: row.connection.externalWorkspaceId }
          : {}),
      });
      if (result.status !== 'connected') throw new Error('Connection check did not succeed');
      // Label the connection by the linked IDENTITY (the account's email), not a resource. The
      // gtasks connector no longer returns a label (it used to return a task-list title), so the
      // identity email — resolved from the bound account's id token — is the source of truth.
      const identityLabel = await resolveIdentityLabel(actorId, row.externalAccountId);
      const account = identityLabel ?? result.account;
      const updated = await setIntegration(id, {
        status: 'connected',
        lastError: null,
        lastErrorAt: null,
        connection: {
          ...row.connection,
          ...(account !== undefined ? { account } : {}),
        },
      });
      return ok(c, IntegrationOut, toOut(updated));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection check failed';
      const updated = await setIntegration(id, {
        status: 'error',
        lastError: message,
        lastErrorAt: new Date(),
      });
      return ok(c, IntegrationOut, toOut(updated));
    }
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

      const row = await loadIntegration(orgId, id);

      const provider = asConnectorProvider(row.provider);
      if (!provider) throw new ConflictError('Integration provider does not support import');

      const tokenResult = await resolveConnectorToken(actorId, provider, row.externalAccountId);
      if (!tokenResult.ok) {
        await setIntegration(id, {
          status: 'error',
          lastError: tokenResult.message,
          lastErrorAt: new Date(),
        });
        throw new ConflictError(
          `Sign in with ${socialProviderId(provider)} to import from this integration.`,
        );
      }

      const teamId = await resolveImportTeam(orgId, row);

      let items: ImportedItem[];
      try {
        items = await connectorFor(provider, tokenResult.token).importWork({
          connectionId: row.id,
          provider,
          ...(row.connection.externalWorkspaceId
            ? { externalWorkspaceId: row.connection.externalWorkspaceId }
            : {}),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Connector failed to import work';
        await setIntegration(id, { status: 'error', lastError: message, lastErrorAt: new Date() });
        throw new ConflictError(message);
      }

      // Onboarding sends `assignToImporter: true` so the owner's freshly-mirrored work lands
      // under My Work's "Assigned to me". The general sync path omits it (Triage instead).
      const created = await importItems(orgId, actorId, row.id, teamId, items, {
        assigneeId: assignToImporter ? actorId : null,
      });
      // The import succeeded against the real provider, so the connection is proven healthy.
      await setIntegration(id, {
        status: 'connected',
        lastSyncStatus: 'succeeded',
        lastSyncedAt: new Date(),
        lastError: null,
        lastErrorAt: null,
      });
      return ok(c, pageOf(TaskOut), { items: created });
    },
  )
  .post('/:id/sync', capabilityGuard('manage'), zParam(idParam), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const row = await loadIntegration(orgId, id);

    if (!asConnectorProvider(row.provider)) {
      throw new ConflictError('Integration provider does not support sync');
    }

    const run = await runSync(row, { actorId, trigger: 'manual' });
    if (!run) throw new ConflictError('A sync is already in progress for this integration.');
    return ok(c, SyncRunOut, toSyncRunOut(run));
  })
  // GitHub connect = installing the GitHub App. Returns the install URL (with a signed `state`
  // binding this integration + org) the client sends the user to; the install redirects back to
  // the non-RPC `/v1/integrations/github/callback`, which records the installation id.
  .get('/:id/connect-url', capabilityGuard('manage'), zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const row = await loadIntegration(orgId, id);
    if (row.provider !== 'github') {
      throw new ConflictError('A connect URL is only available for GitHub integrations');
    }
    const url = buildInstallUrl(signInstallState({ integrationId: id, orgId }));
    if (!url)
      throw new ConflictError('The GitHub App is not configured (GITHUB_APP_SLUG is unset)');
    return c.json({ url });
  });

export default integrations;
