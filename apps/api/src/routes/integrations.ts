import { importTaskWork, listTaskSources } from './integration-import-scope';
/** `@docket/api` — integrations router (mounted at `/v1/orgs/:orgId/integrations`). */
import { actor, db, externalActor, integration, syncRun, team } from '@docket/db';
import {
  ConnectorConfig,
  ConnectorResourceListOut,
  ExternalActorOut,
  ExternalActorPatch,
  IntegrationCreate,
  IntegrationDirectoryOut,
  IntegrationOut,
  IntegrationUpdate,
  SyncRunOut,
} from '@docket/connections/integration-contract';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { TaskOut } from '@docket/work/task-model';
import { providerErrorKind } from '@docket/connections/provider-error';
import { isConnectorError, uninstallInstallation, type ImportedItem } from '@docket/integrations';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../error';
import { created, ok, resourceUrl } from '../lib/ok';
import { pageResultById } from '../lib/list-cursor';
import { apiDoc } from '../lib/openapi-route';
import { serializableTx } from '../lib/serializable-tx';
import { zJson, zParam, zQuery } from '../lib/validate';
import { buildInstallUrl, githubAppConfigFromEnv, signInstallState } from '../lib/github-app';
import { seedDefaultAutomationRules } from '../lib/automation/rules-store';
import { deferAfterResponse } from '../lib/after-response';
import { capabilityGuard } from '../permissions/capability-guard';
import { productCapabilityGuard } from '../product-capability';

import {
  DIRECTORY_PROVIDERS,
  LINEAR_WRITE_SCOPE_MESSAGE,
  PROVIDER_DIRECTORY,
  WRITE_BACK_PROVIDERS,
  asConnectorProvider,
  connectorFor,
  hasLinearWriteScope,
  type IntegrationRow,
  resolveConnectorToken,
  resolveActorConnectorIdentity,
  resolveIdentityLabel,
  socialProviderId,
  toOut,
} from './integration-provider';
import { runSync, toSyncRunOut } from './integration-sync';
import { runNotionMirrorSync } from './notion-mirror-reconcile';
import { importItems, resolveImportTeam } from './integration-import';
import { toExternalActorOut } from './integration-identity';
import { assertRefInOrg } from './task-helpers';
import { listExternalActorRows, listIntegrationRows } from './integration-list-store';
import { ImportBody, integrationIdParam } from './integration-route-contracts';
/** Path params for a single external-actor mapping nested under an integration. */
const externalActorParam = z.object({ id: z.string(), externalActorId: z.string() });
/** Path params for a single sync run nested under an integration. */
const runParam = z.object({ id: z.string(), runId: z.string() });

/**
 * The status-monitor URL a queued sync pass reports through.
 *
 * @remarks
 * The `Location` of a `202`. Every kickoff on this router hands back the run it started, so
 * they all resolve to the same shape of address; centralizing it keeps the header and
 * `GET /:id/runs/:runId` from drifting apart.
 */
export function syncRunUrl(orgId: string, integrationId: string, runId: string): string {
  return resourceUrl(`/v1/orgs/${orgId}/integrations/${integrationId}/runs/${runId}`);
}

/** Update an integration's mutable health/sync fields, returning the fresh row. */
async function setIntegration(
  id: string,
  patch: Partial<typeof integration.$inferInsert>,
): Promise<IntegrationRow> {
  const updated = await db.update(integration).set(patch).where(eq(integration.id, id)).returning();
  const row = updated[0];
  /* v8 ignore next -- @preserve defensive: every caller already loaded this row (existence
   * verified) in the same request; only a genuine concurrent delete between that load and this
   * update could empty `updated`, not reproducible against a single serialized connection. */
  if (!row) throw new NotFoundError('Integration not found');
  return row;
}

/** Schedule the slow outbound Notion pass after the inbound sync when setup is complete. */
function scheduleConfiguredNotionMirror(row: IntegrationRow, actorId: string): boolean {
  if (row.provider !== 'notion') return false;
  const config = ConnectorConfig.safeParse(row.config).data ?? {};
  if (config.notionMirror?.containerPageId === undefined) return false;
  deferAfterResponse('notion-mirror-sync', async () => {
    const run = await runNotionMirrorSync(row, { actorId, trigger: 'manual' });
    // `null` means the lease was taken between the task sync releasing it and this pass — the
    // scheduled sweep, usually. Logged rather than swallowed: nothing else records a pass that
    // never started, and silence here is indistinguishable from one that ran.
    if (run === null) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          source: 'api',
          event: 'notion_mirror_lease_held',
          integrationId: row.id,
        }),
      );
    }
  });
  return true;
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

/**
 * Persist a verified Linear connection while serializing the org/workspace uniqueness check.
 *
 * @remarks
 * The workspace id lives inside JSON connection metadata, so it cannot share the existing
 * `(org, provider, account)` unique index. SERIALIZABLE makes the predicate check and update one
 * concurrency-safe operation: two accounts resolving to the same Linear workspace cannot both
 * become connected in the same Docket organization.
 */
async function setVerifiedLinearIntegration(
  id: string,
  orgId: string,
  externalWorkspaceId: string,
  patch: Partial<typeof integration.$inferInsert>,
): Promise<IntegrationRow> {
  return serializableTx(async (tx) => {
    const duplicates = await tx
      .select({ id: integration.id })
      .from(integration)
      .where(
        and(
          eq(integration.organizationId, orgId),
          eq(integration.provider, 'linear'),
          sql`${integration.connection}->>'externalWorkspaceId' = ${externalWorkspaceId}`,
        ),
      );
    if (duplicates.some((candidate) => candidate.id !== id)) {
      throw new ConflictError(
        'That Linear workspace is already connected to this Docket workspace.',
        'linear_workspace_already_connected',
      );
    }
    const [updated] = await tx
      .update(integration)
      .set(patch)
      .where(and(eq(integration.id, id), eq(integration.organizationId, orgId)))
      .returning();
    /* v8 ignore next -- @preserve defensive: the caller already loaded this row (existence
     * verified) before this SERIALIZABLE transaction; only a genuine concurrent delete could
     * empty `updated`, not reproducible against a single serialized connection. */
    if (!updated) throw new NotFoundError('Integration not found');
    return updated;
  });
}

/**
 * Validate a `config.teamMappings` array before it is persisted (create or update).
 *
 * @remarks
 * `config` is stored as freeform jsonb, but the routing table the config UI writes here has
 * two invariants a bad write would silently break at sync time rather than at the point of the
 * mistake: every `teamId` must be a real team in the caller's org (a stray id would mean synced
 * work vanishes into a team that doesn't exist), and every `externalTeamId` must appear at most
 * once (a duplicate would non-deterministically double- or mis-route that external team's work,
 * since {@link ConnectorConfig}'s `teamMappings` is looked up by `externalTeamId`). A no-op when
 * `config` is absent or carries no `teamMappings` key; a shape failure (not the array
 * `ConnectorConfig.teamMappings` describes) also 422s rather than being silently dropped.
 *
 * @param orgId - The caller's organization, teams are scoped to it.
 * @param config - The raw `config` object from the request body, or `undefined` when the
 *   caller didn't touch `config` at all.
 */
async function validateTeamMappings(
  orgId: string,
  config: Record<string, unknown> | undefined,
): Promise<void> {
  if (config === undefined || !('teamMappings' in config)) return;

  const parsed = ConnectorConfig.shape.teamMappings.safeParse(config['teamMappings']);
  if (!parsed.success) throw new ValidationError(parsed.error);
  /* v8 ignore next -- @preserve defensive: `parsed.success` guarantees `parsed.data` is defined
   * for every value JSON can actually carry here — `config['teamMappings']` only reaches this
   * function via a JSON request body (`zJson`-validated), and JSON has no `undefined`, so the
   * `undefined`-with-success case this guards (a literal JS `undefined` value on an `.optional()`
   * field) is not reachable through the real HTTP transport. */
  const mappings = parsed.data ?? [];
  if (mappings.length === 0) return;

  const seenExternalIds = new Set<string>();
  for (const mapping of mappings) {
    if (seenExternalIds.has(mapping.externalTeamId)) {
      throw new ValidationError(
        new z.ZodError([
          {
            code: 'custom',
            path: ['config', 'teamMappings'],
            message: `Duplicate externalTeamId '${mapping.externalTeamId}' in teamMappings`,
            input: mapping.externalTeamId,
          },
        ]),
      );
    }
    seenExternalIds.add(mapping.externalTeamId);
  }

  const teamIds = [...new Set(mappings.map((m) => m.teamId))];
  const rows = await db
    .select({ id: team.id })
    .from(team)
    .where(and(inArray(team.id, teamIds), eq(team.organizationId, orgId)));
  const found = new Set(rows.map((r) => r.id));
  const missing = teamIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new ValidationError(
      new z.ZodError([
        {
          code: 'custom',
          path: ['config', 'teamMappings'],
          message: `Unknown team id(s) in teamMappings: ${missing.join(', ')}`,
          input: missing,
        },
      ]),
    );
  }
}

/** Integrations router: org-scoped CRUD over external migrations + connectors. */
const integrations = new Hono<AppEnv>()
  .use('*', productCapabilityGuard('integrations'))
  .get(
    '/',
    apiDoc({
      tag: 'Integrations',
      summary: 'List integrations',
      response: pageOf(IntegrationOut),
      description: `List the organization's integrations in stable ID order. Each item reports connection health, sync mode, write-back state, and sync times. Credentials are never returned. Pages default to 50 items and accept at most 100. \`nextCursor\` is absent after the final page. Organization membership is required.`,
    }),
    zQuery(CursorQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { cursor, limit } = c.req.valid('query');
      const rows = await listIntegrationRows(orgId, { cursor, limit });
      return ok(c, pageOf(IntegrationOut), pageResultById(rows.map(toOut), limit));
    },
  )
  .post(
    '/',
    capabilityGuard('manage'),
    apiDoc({
      status: 201,
      tag: 'Integrations',
      summary: 'Connect an integration',
      capability: 'manage',
      response: IntegrationOut,
      description: `Connect or reconnect an external provider and return the {@link IntegrationOut}. Reconnecting the same provider account keeps the existing integration ID, so linked records keep a stable \`sourceIntegrationId\`. An organization can connect several accounts for providers that supply an \`externalAccountId\`.

Critically, **health is never taken from the body**: a new or reconnected integration always starts \`pending\` and clears any prior error. It is only promoted to \`connected\` once \`POST /:id/verify\` (or a successful sync/import) validates a real credential — the spine of the "never report success when nothing happened" rule. \`writeBack\` defaults ON for connectors that support two-way sync (e.g. Google Tasks) unless the caller overrides it, so those connect two-way out of the box.

Requires \`manage\`. This request saves the connection settings but does not contact the provider; verification is a separate step. For GitHub, get the installation URL from \`GET /:id/connect-url\` after creating the integration. Related: \`POST /:id/verify\`, \`POST /:id/import\`, \`POST /:id/sync\`, and \`GET /directory\`.`,
    }),
    zJson(IntegrationCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const body = c.req.valid('json');
      await validateTeamMappings(orgId, body.config);
      const selectedProvider = asConnectorProvider(body.provider);
      let externalAccountId = body.externalAccountId;
      if (selectedProvider && (externalAccountId !== undefined || body.provider === 'linear')) {
        try {
          externalAccountId =
            (await resolveActorConnectorIdentity(actorId, selectedProvider, externalAccountId)) ??
            undefined;
        } catch (err) {
          throw new ConflictError(
            err instanceof Error ? err.message : 'The selected provider account is not linked.',
            body.provider === 'linear' && body.externalAccountId === undefined
              ? 'account_selection_required'
              : 'conflict',
          );
        }
      }

      // Connecting a provider is idempotent per (org, provider): reconnecting reuses the
      // existing integration (refreshing fields) to keep the integration id — and so each
      // mirrored task's `sourceIntegrationId` — stable across reconnects.
      //
      // Health is NEVER taken from the body: a new or reconnected integration starts `pending`
      // and clears any prior error, and is only promoted to `connected` once `POST /:id/verify`
      // (or a successful sync) actually validates the credential.
      // Default two-way write-back only for providers in WRITE_BACK_PROVIDERS unless the caller
      // says otherwise. Linear stays opt-in even though new grants request `write`, because native
      // issue publication requires an explicit team mapping and `pushNativeTasks` choice.
      const writeBack = body.writeBack ?? WRITE_BACK_PROVIDERS.has(body.provider);
      const fields = {
        ...(body.roles !== undefined ? { roles: body.roles } : {}),
        ...(body.config !== undefined ? { config: body.config } : {}),
        ...(body.syncMode !== undefined ? { syncMode: body.syncMode } : {}),
        ...(externalAccountId !== undefined ? { externalAccountId } : {}),
        writeBack,
      };

      // Reconnect is idempotent per (org, provider, account): with an `externalAccountId` an org can
      // link several accounts of the same provider (one integration each); without one we preserve
      // the original single-account behavior (match the row that also has no bound account).
      const accountMatch = externalAccountId
        ? eq(integration.externalAccountId, externalAccountId)
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
          ...(externalAccountId !== undefined ? { createdBy: actorId } : {}),
          status: 'pending',
          lastError: null,
          lastErrorKind: null,
          lastErrorAt: null,
        });
        return created(c, IntegrationOut, toOut(row));
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
      return created(c, IntegrationOut, toOut(row));
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
        DIRECTORY_PROVIDERS.map((provider) => ({
          provider,
          syncable: asConnectorProvider(provider) !== null,
          ...PROVIDER_DIRECTORY[provider],
        }));
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
    zParam(integrationIdParam),
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
    zParam(integrationIdParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const row = await loadIntegration(orgId, id);

      const provider = asConnectorProvider(row.provider);
      if (!provider) throw new ConflictError('Integration provider has no selectable lists');

      // Enumerating the provider's task lists needs a live credential, so a broken connection
      // surfaces here as a real reason (not an empty list that looks like "no lists").
      const token = await resolveConnectorToken(row.createdBy, provider, row.externalAccountId);
      if (!token.ok) throw new ConflictError(token.message);

      const resources = await listTaskSources(connectorFor(provider, token.token), {
        connectionId: row.id,
        provider,
      });
      return ok(c, ConnectorResourceListOut, { resources });
    },
  )
  .get(
    '/:id/runs',
    apiDoc({
      tag: 'Integrations',
      summary: 'List integration sync runs',
      response: pageOf(SyncRunOut),
      description: `List the 20 most recent sync runs for an integration, newest first. Each run reports its status, trigger, processed and total counts, error reason, and start and finish times. Failed runs remain available for diagnosis. An absent or inaccessible integration returns 404. Organization membership is sufficient. Use \`POST /:id/sync\` to start a run and \`GET /:id\` to read integration health.`,
    }),
    zParam(integrationIdParam),
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
  .get(
    '/:id/runs/:runId',
    apiDoc({
      tag: 'Integrations',
      summary: 'Read one integration sync run',
      response: SyncRunOut,
      description: `Read a single {@link SyncRunOut} by id — the status monitor for one sync pass. \`POST /:id/sync\`, \`POST /:id/import\`, and \`POST /:id/notion/sync\` all answer **202 Accepted** with a \`Location\` header naming this URL, because the pass they start is deliberately *not* awaited: it paces writes against the provider's rate limit for minutes, far past any gateway or browser timeout. Poll here until \`status\` leaves \`running\`.

Unlike \`GET /:id/runs\`, which is capped at the 20 most recent runs, this addresses a run directly and keeps working after it has aged out of that window. A run id belonging to another integration or org 404s. A read; org membership suffices.`,
    }),
    zParam(runParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, runId } = c.req.valid('param');
      await loadIntegration(orgId, id);
      const rows = await db
        .select()
        .from(syncRun)
        .where(
          and(
            eq(syncRun.id, runId),
            eq(syncRun.integrationId, id),
            eq(syncRun.organizationId, orgId),
          ),
        )
        .limit(1);
      const run = rows[0];
      if (!run) throw new NotFoundError('Sync run not found');
      return ok(c, SyncRunOut, toSyncRunOut(run));
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
      description: `Update an integration's mutable settings — \`roles\`, connector \`config\` (target team/project, \`listIds\`, \`defaultListId\`, \`pushNativeTasks\`, work-graph connectors' \`teamMappings\`, and — on mail-capable connectors — \`emailToTask: { enabled, threshold }\`, the strictly-opt-in email-to-task ingest switch validated against {@link ConnectorConfig}), \`syncMode\`, \`writeBack\`, and the one-time \`externalAccountId\` binding for a legacy connection — returning the refreshed {@link IntegrationOut}. Provider-owned \`connection\` metadata (including Linear's webhook-routing workspace id), credentials, and \`status\` are intentionally **not** accepted: identity/workspace metadata is learned from the provider during verification, and health is earned through verify/sync, so a client cannot forge routing or a healthy state. A partial update writes only accepted present fields. Enabling \`emailToTask\` also seeds the org's default automation rules once (idempotent), so the dismiss-promotions / archive-on-complete defaults exist the moment the feature turns on. Flipping \`writeBack: true\` on a Linear integration additionally requires the bound Linear identity to carry the \`write\` OAuth scope — lacking it rejects with 409 (reconnect message); a read-only (\`writeBack: false\`) update never checks scope. When \`config.teamMappings\` is present it is validated: every \`teamId\` must be a real team in the caller's org and every \`externalTeamId\` must be unique within the array — either failure 422s (\`validation_error\`) rather than persisting a mapping that would silently misroute at sync time. A missing/cross-tenant id 404s. Requires \`manage\`. Related: \`POST /:id/verify\` (re-validate after changing the connection), \`GET /:id/lists\` (to discover valid \`config.listIds\`).`,
    }),
    zParam(integrationIdParam),
    zJson(IntegrationUpdate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      await validateTeamMappings(orgId, body.config);

      const existing = await loadIntegration(orgId, id);
      if (body.externalAccountId !== undefined) {
        if (existing.externalAccountId && existing.externalAccountId !== body.externalAccountId) {
          throw new ConflictError(
            'This connection is already bound to an account. Disconnect it to choose another.',
          );
        }
        const provider = asConnectorProvider(existing.provider);
        if (provider) {
          try {
            await resolveActorConnectorIdentity(actorId, provider, body.externalAccountId);
          } catch (err) {
            throw new ConflictError(
              err instanceof Error ? err.message : 'The selected provider account is not linked.',
            );
          }
        }
      }
      // Flipping write-back ON for Linear is gated on the bound owner's linked identity. When an
      // actor explicitly binds a legacy row in this request, that exact account becomes the owner
      // and is checked atomically. A read-only update never consults scope — no nagging.
      const credentialActorId = body.externalAccountId !== undefined ? actorId : existing.createdBy;
      const credentialAccountId = body.externalAccountId ?? existing.externalAccountId;
      if (
        body.writeBack === true &&
        existing.provider === 'linear' &&
        !(await hasLinearWriteScope(credentialActorId, credentialAccountId))
      ) {
        throw new ConflictError(LINEAR_WRITE_SCOPE_MESSAGE, 'linear_write_scope_required');
      }

      const patch = {
        ...(body.roles !== undefined ? { roles: body.roles } : {}),
        ...(body.config !== undefined ? { config: body.config } : {}),
        ...(body.syncMode !== undefined ? { syncMode: body.syncMode } : {}),
        ...(body.writeBack !== undefined ? { writeBack: body.writeBack } : {}),
        ...(body.externalAccountId !== undefined
          ? {
              externalAccountId: body.externalAccountId,
              createdBy: actorId,
              status: 'pending' as const,
              lastError: null,
              lastErrorKind: null,
              lastErrorAt: null,
            }
          : {}),
      } satisfies Partial<typeof integration.$inferInsert>;
      const row = Object.keys(patch).length === 0 ? existing : await setIntegration(id, patch);

      // Enablement moment: seed the org's default automation rules as soon as email-to-task
      // turns on (idempotent; the sweep-time call remains as a backstop) — decoupled from
      // sweep timing so the rules are visible in settings immediately after the toggle.
      const emailToTask = ConnectorConfig.safeParse(row.config).data?.emailToTask;
      if (emailToTask?.enabled === true) {
        const { actorId } = c.get('actorCtx');
        await seedDefaultAutomationRules(orgId, actorId);
      }
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
      description: `Disconnect an integration and return its final {@link IntegrationOut}. Existing imported or mirrored tasks remain, but their \`sourceIntegrationId\` no longer identifies an active connection. A later connection may receive a different integration ID. For GitHub, Docket also attempts to uninstall the GitHub App. A GitHub-side failure does not prevent the Docket connection from being removed. An absent or inaccessible integration returns 404. Requires \`manage\`. Use \`PATCH /:id\` to reconfigure a connection instead.`,
    }),
    zParam(integrationIdParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const row = await loadIntegration(orgId, id);

      if (row.provider === 'github' && row.connection.externalWorkspaceId) {
        const config = githubAppConfigFromEnv();
        if (config) {
          try {
            await uninstallInstallation(
              config,
              row.connection.externalWorkspaceId,
              Math.floor(Date.now() / 1000),
            );
          } catch (err) {
            // Best-effort: a 404 means GitHub already lost the installation (nothing to
            // revoke); any other failure is logged but must never block the Docket-side
            // disconnect from succeeding.
            if (!(isConnectorError(err) && err.status === 404)) {
              console.error('github uninstall-on-disconnect failed', { integrationId: id, err });
            }
          }
        }
      }

      const deleted = await db
        .delete(integration)
        .where(and(eq(integration.id, id), eq(integration.organizationId, orgId)))
        .returning();
      const deletedRow = deleted[0];
      if (!deletedRow) throw new NotFoundError('Integration not found');
      return ok(c, IntegrationOut, toOut(deletedRow));
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

Crucially, a failure is recorded, not thrown away: if the credential can't be resolved or the provider check doesn't succeed, the integration is set to \`status='error'\` with a real \`lastError\`/\`lastErrorAt\`, and that error state is returned as **200** (the honest current state) rather than an HTTP error — so the UI can show exactly why the connection is broken. A provider that doesn't support connection checks yields 409 (\`Integration provider does not support connection checks\`); a missing/cross-tenant id 404s. For Linear, a successful connect persists the provider's \`externalWorkspaceId\`/\`externalWorkspaceSlug\` onto \`connection\` (the webhook-routing key), and a \`writeBack\` Linear integration whose actor identity lacks the OAuth \`write\` scope is recorded as \`error\` with a reconnect message BEFORE the live connect call, never silently downgraded to read-only.

Requires \`manage\` — it exercises live credentials and mutates health. Side effect: writes \`status\`/\`lastError\`/connection label. Related: \`POST /\` (which leaves the integration \`pending\` for this route to verify), \`POST /:id/sync\` & \`POST /:id/import\` (which also prove health on success).`,
    }),
    zParam(integrationIdParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const row = await loadIntegration(orgId, id);

      const provider = asConnectorProvider(row.provider);
      if (!provider)
        throw new ConflictError('Integration provider does not support connection checks');

      // A Linear integration with write-back ON needs the actor's linked identity to actually
      // carry the `write` scope — this is checked BEFORE the live connect call (a distinct,
      // honest failure mode from a broken credential) and recorded as `error` via the same
      // truthful 200 pattern below, never silently ignored or left dangling as a fabricated
      // `connected`.
      if (
        provider === 'linear' &&
        row.writeBack &&
        !(await hasLinearWriteScope(row.createdBy, row.externalAccountId))
      ) {
        const updated = await setIntegration(id, {
          status: 'error',
          lastError: LINEAR_WRITE_SCOPE_MESSAGE,
          lastErrorKind: 'auth',
          lastErrorAt: new Date(),
        });
        return ok(c, IntegrationOut, toOut(updated));
      }

      // The ONLY place that promotes an integration to `connected` at connect time: a credential
      // must actually resolve the external account here. Failures are recorded as `error` with a
      // real reason and returned as 200 (the truthful integration state), never thrown away.
      const tokenResult = await resolveConnectorToken(
        row.createdBy,
        provider,
        row.externalAccountId,
      );
      if (!tokenResult.ok) {
        const updated = await setIntegration(id, {
          status: 'error',
          lastError: tokenResult.message,
          lastErrorKind: 'auth',
          lastErrorAt: new Date(),
        });
        return ok(c, IntegrationOut, toOut(updated));
      }

      try {
        const connector = connectorFor(provider, tokenResult.token);
        const result = await connector.connect({
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
        const identityLabel = await resolveIdentityLabel(
          row.createdBy,
          provider,
          row.externalAccountId,
        );
        const account = identityLabel ?? result.account;
        let nextConfig = row.config;
        if (provider === 'linear') {
          const parsedConfig = ConnectorConfig.safeParse(row.config).data ?? {};
          if (!parsedConfig.teamMappings || parsedConfig.teamMappings.length === 0) {
            const [defaultTeamId, resources] = await Promise.all([
              resolveImportTeam(orgId, row),
              connector.listContainers?.({ connectionId: row.id, provider }) ?? [],
            ]);
            nextConfig = {
              ...row.config,
              teamMappings: resources.map((resource) => ({
                externalTeamId: resource.id,
                teamId: defaultTeamId,
              })),
            };
          }
        }
        const verifiedPatch = {
          status: 'connected',
          lastError: null,
          lastErrorKind: null,
          lastErrorAt: null,
          connection: {
            ...row.connection,
            ...(account !== undefined ? { account } : {}),
            // Persist the provider workspace id/slug (e.g. Linear's org id + urlKey) so
            // `ingest.ts`'s `connection->>'externalWorkspaceId'` webhook routing has something
            // real to match against — previously only ever set on `connect()`'s input, never
            // written back from its result.
            ...(result.externalWorkspaceId !== undefined
              ? { externalWorkspaceId: result.externalWorkspaceId }
              : {}),
            ...(result.externalWorkspaceSlug !== undefined
              ? { externalWorkspaceSlug: result.externalWorkspaceSlug }
              : {}),
            ...(result.externalWorkspaceName !== undefined
              ? { externalWorkspaceName: result.externalWorkspaceName }
              : {}),
          },
          config: nextConfig,
        } satisfies Partial<typeof integration.$inferInsert>;
        let updated =
          provider === 'linear' && result.externalWorkspaceId
            ? await setVerifiedLinearIntegration(
                id,
                orgId,
                result.externalWorkspaceId,
                verifiedPatch,
              )
            : await setIntegration(id, verifiedPatch);
        // First activation is useful immediately: every discovered Linear team is mapped to the
        // org's default team above, then the same sync engine used by manual/scheduled/webhook
        // runs materializes the issues as native Docket tasks before this request returns.
        if (provider === 'linear' && row.lastSyncedAt === null) {
          await runSync(updated, { actorId, trigger: 'manual' });
          updated = await loadIntegration(orgId, id);
        }
        return ok(c, IntegrationOut, toOut(updated));
      } catch (err) {
        if (err instanceof ConflictError) throw err;
        const message = err instanceof Error ? err.message : 'Connection check failed';
        const updated = await setIntegration(id, {
          status: 'error',
          lastError: message,
          lastErrorKind: providerErrorKind(err),
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
      description: `Import provider work as Docket tasks. Each task retains \`sourceIntegrationId\`, \`externalId\`, and \`externalUrl\` so clients can identify its source.

\`assignToImporter\` defaults to false. Set it to true to assign imported tasks to the caller; otherwise they enter triage. A successful import marks the integration connected and updates its last successful sync time. A missing credential, provider failure, or unsupported import returns 409 and marks the integration in error. An absent or inaccessible integration returns 404.

Requires \`contribute\`. Ongoing organization-wide synchronization through \`POST /:id/sync\` requires \`manage\`. Use \`GET /:id/runs\` to inspect sync history.`,
    }),
    zParam(integrationIdParam),
    zJson(ImportBody),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { assignToImporter } = c.req.valid('json');

      const row = await loadIntegration(orgId, id);

      const provider = asConnectorProvider(row.provider);
      if (!provider) throw new ConflictError('Integration provider does not support import');

      const tokenResult = await resolveConnectorToken(
        row.createdBy,
        provider,
        row.externalAccountId,
      );
      if (!tokenResult.ok) {
        await setIntegration(id, {
          status: 'error',
          lastError: tokenResult.message,
          lastErrorKind: 'auth',
          lastErrorAt: new Date(),
        });
        throw new ConflictError(
          `Sign in with ${socialProviderId(provider)} to import from this integration.`,
        );
      }

      const teamId = await resolveImportTeam(orgId, row);

      let items: ImportedItem[];
      try {
        items = await importTaskWork(connectorFor(provider, tokenResult.token), {
          connectionId: row.id,
          provider,
          listIds: ConnectorConfig.parse(row.config).listIds ?? [],
          ...(row.connection.externalWorkspaceId
            ? { externalWorkspaceId: row.connection.externalWorkspaceId }
            : {}),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Connector failed to import work';
        await setIntegration(id, {
          status: 'error',
          lastError: message,
          lastErrorKind: providerErrorKind(err),
          lastErrorAt: new Date(),
        });
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
        lastErrorKind: null,
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

For a Notion connection that has a **mirror** configured (a container page chosen via \`POST /:id/notion/provision\`), this also runs the mirror pass — the opposite direction, pushing Docket's work OUT into the designed databases. Both are needed for "Sync" to mean what it says on that connection: running only the task pull would report success having never touched the mirror. They run one after the other because they contend for the same lease, and the mirror pass also refreshes the Notion people roster.

The mirror pass is **started, not awaited**: it spends minutes pacing writes against Notion's rate limit, and blocking this shared endpoint on it would exceed gateway and browser timeouts for every provider. The response body is therefore the \`task_sync\` run only, and it claims nothing about the mirror. The mirror's own run is durable from the moment it starts and is the honest place to read its outcome: \`GET /:id/runs\`, keyed by \`purpose\` (\`task_sync\` / \`notion_mirror\`). Use \`POST /:id/notion/sync\` when you need to wait for a mirror pass and read its status directly.

Requires \`manage\` — triggering org-wide mirroring is an administrative action (contrast the \`contribute\`-level \`POST /:id/import\`, which is a user pulling their own work in). Related: \`GET /:id/runs\`, \`POST /:id/verify\`, \`POST /:id/notion/sync\` (the mirror alone).`,
    }),
    zParam(integrationIdParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const row = await loadIntegration(orgId, id);

      if (!asConnectorProvider(row.provider)) {
        throw new ConflictError('Integration provider does not support sync');
      }

      const run = await runSync(row, { actorId, trigger: 'manual' });
      if (!run) throw new ConflictError('A sync is already in progress for this integration.');

      scheduleConfiguredNotionMirror(row, actorId);
      return ok(c, SyncRunOut, toSyncRunOut(run));
    },
  )
  // GitHub installation returns a URL with a signed `state` binding this integration + org.
  .get(
    '/:id/connect-url',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'Get a provider connect URL',
      capability: 'manage',
      description: `Return \`{ url }\` for installing a GitHub App integration. Create the integration first, then redirect the browser to this URL. The operation returns 409 for providers that do not use a connect URL or when GitHub App configuration is unavailable. An absent or inaccessible integration returns 404. Requires \`manage\`.`,
    }),
    zParam(integrationIdParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const row = await loadIntegration(orgId, id);
      if (row.provider === 'github') {
        const url = buildInstallUrl(signInstallState({ integrationId: id, orgId }));
        if (!url)
          throw new ConflictError('The GitHub App is not configured (GITHUB_APP_SLUG is unset)');
        return c.json({ url });
      }
      throw new ConflictError('A connect URL is only available for GitHub integrations');
    },
  )
  .get(
    '/:id/external-actors',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'List external actor identity mappings',
      capability: 'manage',
      response: pageOf(ExternalActorOut),
      description: `List the provider users that this integration has discovered and their Docket identity mappings. \`actorId: null\` means the provider user is not linked. \`matchedBy: "email"\` means Docket may reevaluate the match during a later sync. \`matchedBy: "manual"\` preserves the explicit link. A non-null \`ignoredAt\` records an explicit exclusion and also prevents automatic matching. An absent or inaccessible integration returns 404.

Results use stable external-actor-id order, default to 50 items, accept at most 100, and omit \`nextCursor\` at exhaustion. Reuse a cursor only for the same integration. Requires \`manage\` — reviewing/curating identity mappings is an administrative task, the same bar as the other integration-configuration routes.`,
    }),
    zParam(integrationIdParam),
    zQuery(CursorQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { cursor, limit } = c.req.valid('query');
      await loadIntegration(orgId, id);
      const rows = await listExternalActorRows(orgId, id, { cursor, limit });
      return ok(c, pageOf(ExternalActorOut), pageResultById(rows.map(toExternalActorOut), limit));
    },
  )
  .patch(
    '/:id/external-actors/:externalActorId',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'Manually link or unlink an external actor mapping',
      capability: 'manage',
      response: ExternalActorOut,
      description: `Link or unlink one provider user. Set \`actorId\` to an actor in the organization to create a manual link. Later syncs preserve that link even when the provider email changes. Set \`actorId\` to null to remove the link and allow automatic email matching again. Either choice clears \`ignoredAt\` because it replaces any earlier exclusion.

The integration and mapping must be visible in the organization; otherwise the request returns 404. Requires \`manage\`. Use \`GET /:id/external-actors\` to review mappings and \`POST /:id/sync\` to run automatic matching.`,
    }),
    zParam(externalActorParam),
    zJson(ExternalActorPatch),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, externalActorId } = c.req.valid('param');
      const body = c.req.valid('json');
      await loadIntegration(orgId, id);
      await assertRefInOrg(actor, orgId, body.actorId, 'Actor not found');

      const updated = await db
        .update(externalActor)
        // `ignoredAt` clears either way: linking or unlinking is a fresh decision that supersedes
        // an earlier exclusion, and a stale one left behind would keep the row immune to the
        // automatic re-matching an unlink explicitly promises to restore.
        .set({ actorId: body.actorId, matchedBy: body.actorId ? 'manual' : null, ignoredAt: null })
        .where(
          and(
            eq(externalActor.id, externalActorId),
            eq(externalActor.integrationId, id),
            eq(externalActor.organizationId, orgId),
          ),
        )
        .returning();
      const row = updated[0];
      if (!row) throw new NotFoundError('External actor not found');
      return ok(c, ExternalActorOut, toExternalActorOut(row));
    },
  );

export default integrations;
