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
import { apiDoc } from '../lib/openapi-route';
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
  .get(
    '/',
    apiDoc({
      tag: 'Integrations',
      summary: 'List integrations',
      response: pageOf(IntegrationOut),
      description: `List every integration connected to the active organization as a single page of {@link IntegrationOut}. An integration is an org-scoped external connection in one of two patterns — a **Migration** (replace: a one-time import that pulls work into Docket) or a **Connector** (complement: an ongoing read-only mirror, optionally two-way) — contributing one or more roles (\`work\`, \`context\`, \`signal\`, \`time\`, \`code\`). Each row exposes connection health (\`status\`), sync mode, write-back flag, and last-sync/last-error fields, but never the credential itself (only a \`credentialsRef\`). A read; org membership suffices. Related: connect via \`POST /\`, browse connectable providers via \`GET /directory\`, and inspect sync history via \`GET /:id/runs\`.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const rows = await db.select().from(integration).where(eq(integration.organizationId, orgId));
      return ok(c, pageOf(IntegrationOut), { items: rows.map(toOut) });
    },
  )
  .post(
    '/',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'Connect an integration',
      capability: 'manage',
      response: IntegrationOut,
      description: `Connect (or reconnect) an external provider to the organization and return the {@link IntegrationOut}. Connection is **idempotent per (org, provider, account)**: reconnecting reuses the existing integration row — refreshing its fields — so the integration id (and thus every mirrored task's \`sourceIntegrationId\`) stays stable across reconnects. With an \`externalAccountId\` an org can link several accounts of the same provider (one integration each); without one the original single-account row is matched.

Critically, **health is never taken from the body**: a new or reconnected integration always starts \`pending\` and clears any prior error. It is only promoted to \`connected\` once \`POST /:id/verify\` (or a successful sync/import) validates a real credential — the spine of the "never report success when nothing happened" rule. \`writeBack\` defaults ON for connectors that support two-way sync (e.g. Google Tasks) unless the caller overrides it, so those connect two-way out of the box.

Requires \`manage\` — wiring an external data source into the org is an administrative trust decision. Side effects: persists/refreshes the connection metadata (secret stored only by reference); no external call is made here (verification is a separate step). Note GitHub connects by installing the GitHub App — fetch its install URL via \`GET /:id/connect-url\` after creating the row. Related: \`POST /:id/verify\`, \`POST /:id/import\`, \`POST /:id/sync\`, \`GET /directory\`.`,
    }),
    zJson(IntegrationCreate),
    async (c) => {
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
    },
  )
  .get(
    '/directory',
    apiDoc({
      tag: 'Integrations',
      summary: 'List the integration provider directory',
      response: IntegrationDirectoryOut,
      description: `Return the catalog of providers Docket can connect to as {@link IntegrationDirectoryOut} — the data behind the connect wizard. Each entry names the provider id, its human label, its pattern (\`migration\` vs \`connector\`), the roles it contributes (\`work\`/\`context\`/\`signal\`/\`time\`/\`code\`), and a category for grouping. This is static, org-agnostic capability metadata (the set of *connectable* providers), not the org's *connected* integrations — for those use \`GET /\`. A read; org membership suffices. Related: \`POST /\` to connect a provider chosen from this directory.`,
    }),
    async (c) => {
      const providers: z.input<typeof IntegrationDirectoryOut>['providers'] =
        CONNECTOR_PROVIDERS.map((provider) => ({ provider, ...PROVIDER_DIRECTORY[provider] }));
      return ok(c, IntegrationDirectoryOut, { providers });
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Integrations',
      summary: 'Get an integration',
      response: IntegrationOut,
      description: `Fetch a single integration by id, scoped to the active organization, returning {@link IntegrationOut}. A missing/cross-tenant id returns 404 (\`Integration not found\`; existence-hiding across tenants). A read; org membership suffices. The response is the full health picture — \`status\`, \`syncMode\`, \`writeBack\`, \`lastSyncStatus\`/\`lastSyncedAt\`, \`lastError\`/\`lastErrorAt\`, \`syncCadenceMinutes\` — without ever exposing the credential. Related: \`GET /:id/runs\` (sync history), \`GET /:id/lists\` (selectable provider containers), \`POST /:id/verify\` (re-check health).`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const row = await loadIntegration(orgId, id);
      return ok(c, IntegrationOut, toOut(row));
    },
  )
  .get(
    '/:id/lists',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'List an integration provider resources',
      capability: 'manage',
      response: ConnectorResourceListOut,
      description: `Enumerate the external containers (e.g. Google Tasks lists) a connector exposes for selection, as {@link ConnectorResourceListOut} — the picker data for choosing which lists to sync into \`config.listIds\`. This makes a **live call to the provider** using the bound account's credential, so a broken or unauthorized connection surfaces here as a real 409 (\`Integration provider has no selectable lists\` when the provider isn't a connector, or the token-resolution failure message) rather than an empty list that masquerades as "no lists". A missing/cross-tenant integration 404s.

Requires \`manage\` — it touches live provider credentials and configures sync. Related: \`PATCH /:id\` (persist the chosen \`config.listIds\`/\`defaultListId\`), \`POST /:id/sync\`.`,
    }),
    zParam(idParam),
    async (c) => {
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
    },
  )
  .get(
    '/:id/runs',
    apiDoc({
      tag: 'Integrations',
      summary: 'List integration sync runs',
      response: pageOf(SyncRunOut),
      description: `List the most recent (up to 20) sync runs for an integration, newest-first, as a page of {@link SyncRunOut}. Each run is the **durable** record of one \`importWork\` pass — its \`status\` (\`running\`/\`succeeded\`/\`failed\`), \`trigger\` (\`manual\`/\`scheduled\`), \`processed\`/\`total\` counts, error reason, and start/finish timestamps — so a failed sync leaves a real, auditable trace instead of vanishing on restart (this replaced the former ephemeral in-memory job model). The org-scoped integration must exist (404 \`Integration not found\`). A read; org membership suffices. Related: \`POST /:id/sync\` (start a run), \`GET /:id\` (the integration's roll-up health).`,
    }),
    zParam(idParam),
    async (c) => {
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
    },
  )
  .patch(
    '/:id',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'Update an integration',
      capability: 'manage',
      response: IntegrationOut,
      description: `Update an integration's mutable settings — \`roles\`, \`connection\` metadata, connector \`config\` (target team/project, \`listIds\`, \`defaultListId\`, \`pushNativeTasks\`), \`syncMode\`, and \`writeBack\` — returning the refreshed {@link IntegrationOut}. A partial update: only present fields are written. \`status\` is intentionally **not** accepted — connection health is *earned* through the connect/verify and sync paths, never declared by a client, so this route can never fabricate \`connected\`. A missing/cross-tenant id 404s. Requires \`manage\`. Related: \`POST /:id/verify\` (re-validate after changing the connection), \`GET /:id/lists\` (to discover valid \`config.listIds\`).`,
    }),
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
  .delete(
    '/:id',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'Disconnect an integration',
      capability: 'manage',
      response: IntegrationOut,
      description: `Disconnect (delete) an integration from the organization, returning the deleted {@link IntegrationOut} as it was just before removal. A missing/cross-tenant id 404s (\`Integration not found\`). Requires \`manage\` — severing an external data source is an administrative decision. Removing the integration drops the org's link to that provider; tasks already mirrored into Docket persist as rows but their \`sourceIntegrationId\` no longer resolves to a live connection (a subsequent reconnect of the same provider/account reuses a fresh integration id). Related: \`POST /\` (reconnect), \`PATCH /:id\` (reconfigure instead of disconnecting).`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const deleted = await db
        .delete(integration)
        .where(and(eq(integration.id, id), eq(integration.organizationId, orgId)))
        .returning();
      const row = deleted[0];
      if (!row) throw new NotFoundError('Integration not found');
      return ok(c, IntegrationOut, toOut(row));
    },
  )
  .post(
    '/:id/verify',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'Verify an integration connection',
      capability: 'manage',
      response: IntegrationOut,
      description: `Verify an integration's credential against the live provider and return the **truthful** {@link IntegrationOut} reflecting the result. This is the ONLY place that promotes an integration to \`connected\` at connect time: a real \`connect()\` call must actually resolve the external account here. The connection is labeled by the linked **identity** (the account's email, resolved from its id token), not by a resource.

Crucially, a failure is recorded, not thrown away: if the credential can't be resolved or the provider check doesn't succeed, the integration is set to \`status='error'\` with a real \`lastError\`/\`lastErrorAt\`, and that error state is returned as **200** (the honest current state) rather than an HTTP error — so the UI can show exactly why the connection is broken. A provider that doesn't support connection checks yields 409 (\`Integration provider does not support connection checks\`); a missing/cross-tenant id 404s.

Requires \`manage\` — it exercises live credentials and mutates health. Side effect: writes \`status\`/\`lastError\`/connection label. Related: \`POST /\` (which leaves the integration \`pending\` for this route to verify), \`POST /:id/sync\` & \`POST /:id/import\` (which also prove health on success).`,
    }),
    zParam(idParam),
    async (c) => {
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
    },
  )
  .post(
    '/:id/import',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Integrations',
      summary: 'Import work from an integration',
      capability: 'contribute',
      response: pageOf(TaskOut),
      description: `Pull work items from the provider into Docket as native {@link TaskOut} rows and return the created tasks. This is the Migration/onboarding path: it calls the connector's \`importWork\`, resolves the target team (\`resolveImportTeam\`), and materializes a task per imported item with provenance linking back to the source (\`sourceIntegrationId\`, \`externalId\`, \`externalUrl\`).

The optional body flag \`assignToImporter\` (default \`false\`) controls landing: onboarding passes \`true\` so the owner's freshly-mirrored work appears under My Work's "Assigned to me"; the general sync path omits it so imported work lands in Triage instead. On success the integration is proven healthy — set to \`connected\` with \`lastSyncStatus='succeeded'\` and a fresh \`lastSyncedAt\`. On failure (no live credential, or the connector throwing) the integration is demoted to \`error\` with the real reason and the request fails 409 — e.g. \`Sign in with <provider> to import…\` when the OAuth grant is missing, or \`Integration provider does not support import\` for a non-connector. A missing/cross-tenant id 404s.

Requires \`contribute\` (it creates tasks, the same bar as authoring work directly) — note this is a *lower* bar than the \`manage\`-gated \`POST /:id/sync\`, because import is a user pulling their own work in, whereas sync configures ongoing org-level mirroring. Related: \`POST /:id/sync\`, \`GET /:id/runs\`.`,
    }),
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
  .post(
    '/:id/sync',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'Trigger an integration sync',
      capability: 'manage',
      response: SyncRunOut,
      description: `Start a manual sync run for a connector and return the created {@link SyncRunOut}. Synchronization reconciles the org's mirrored tasks with the provider's current state (and, for two-way connectors with \`writeBack\`, pushes eligible Docket changes back out). A run is durable and auditable via \`GET /:id/runs\`.

Concurrency is guarded: only one sync may be in flight per integration, so if a run is already active this returns 409 (\`A sync is already in progress for this integration.\`) rather than starting a duplicate. A provider that can't sync yields 409 (\`Integration provider does not support sync\`); a missing/cross-tenant id 404s. The run is recorded with \`trigger='manual'\` (the background scheduler uses \`scheduled\`).

Requires \`manage\` — triggering org-wide mirroring is an administrative action (contrast the \`contribute\`-level \`POST /:id/import\`, which is a user pulling their own work in). Related: \`GET /:id/runs\`, \`POST /:id/verify\`.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const row = await loadIntegration(orgId, id);

      if (!asConnectorProvider(row.provider)) {
        throw new ConflictError('Integration provider does not support sync');
      }

      const run = await runSync(row, { actorId, trigger: 'manual' });
      if (!run) throw new ConflictError('A sync is already in progress for this integration.');
      return ok(c, SyncRunOut, toSyncRunOut(run));
    },
  )
  // GitHub connect = installing the GitHub App. Returns the install URL (with a signed `state`
  // binding this integration + org) the client sends the user to; the install redirects back to
  // the non-RPC `/v1/integrations/github/callback`, which records the installation id.
  .get(
    '/:id/connect-url',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'Get a GitHub App install URL',
      capability: 'manage',
      description: `Return the GitHub App **install URL** the client redirects the user to in order to connect a GitHub integration — connecting GitHub means installing the GitHub App, not an OAuth token exchange. The response is \`{ url }\` (a bare JSON object, not the standard envelope). The URL embeds a signed \`state\` that binds this integration id + org, so when the user finishes installation GitHub redirects to the non-RPC \`/v1/integrations/github/callback\`, which records the installation id against this integration.

Only valid for a GitHub integration row (else 409 \`A connect URL is only available for GitHub integrations\`), and only when the GitHub App is configured (else 409 \`The GitHub App is not configured (GITHUB_APP_SLUG is unset)\`); a missing/cross-tenant id 404s. Requires \`manage\`. Related: \`POST /\` (create the GitHub integration row first), \`POST /:id/sync\`.`,
    }),
    zParam(idParam),
    async (c) => {
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
    },
  );

export default integrations;
