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

import { ActorId, IntegrationId, OrganizationId } from './primitives';

/** Integration pattern: replace (migration) vs complement (connector). */
export const IntegrationPattern = z
  .enum(['migration', 'connector'])
  .describe(
    'How the integration relates to Docket: `migration` — a one-time **replace**, importing work *into* Docket so Docket becomes the source of truth; `connector` — an ongoing **complement**, mirroring an external tool (read-only, or two-way when `writeBack`) while the source of truth stays partly external.',
  );
/** Integration-pattern value. */
export type IntegrationPattern = z.infer<typeof IntegrationPattern>;

/** What an integration contributes: work, context, signal, time, or code. */
export const IntegrationRole = z
  .enum(['work', 'context', 'signal', 'time', 'code'])
  .describe(
    'What an integration contributes to the workspace: `work` (tasks/issues), `context` (docs/knowledge), `signal` (notifications/mentions feeding observations), `time` (calendar events), or `code` (repositories/PRs). An integration may contribute several.',
  );
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
export const IntegrationStatus = z
  .enum(['pending', 'connected', 'error', 'disconnected'])
  .describe(
    'Connection health: `pending` (created but the credential has NOT been validated by a real `connect()` — must never be shown as connected); `connected` (a successful connect/verify/sync proved a live credential); `error` (a connect, sync, or token refresh failed — see `lastError`); `disconnected` (intentionally severed).',
  );
/** Integration-status value. */
export type IntegrationStatus = z.infer<typeof IntegrationStatus>;

/** Integration sync depth: one-time import vs read-only mirror. */
export const SyncMode = z
  .enum(['import', 'mirror'])
  .describe(
    'How deeply work is synced: `import` — a one-time pull (snapshot) with no ongoing reconciliation; `mirror` — a continuously-reconciled copy that tracks the provider over time.',
  );
/** Sync-mode value. */
export type SyncMode = z.infer<typeof SyncMode>;

/** An external integration's connection metadata (never the secret itself). */
export const IntegrationConnection = z
  .object({
    account: z
      .string()
      .optional()
      .describe(
        'A human label for the linked account — typically the identity email resolved at verify time; shown in the UI so a user recognizes which account is connected.',
      ),
    credentialsRef: z
      .string()
      .optional()
      .describe(
        'An opaque reference to the stored credential (OAuth grant / token); Docket never persists the raw secret, only this pointer.',
      ),
    externalWorkspaceId: z
      .string()
      .optional()
      .describe(
        'The provider-side workspace/organization the integration is scoped to, when the provider is multi-workspace.',
      ),
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
 * - `teamMappings` — for work-graph connectors (Linear), the explicit per-external-team →
 *   Docket-team routing table. Its presence is the source of truth for which external teams
 *   are synced: an external team absent from the table is NOT synced (no fallback). When it
 *   is absent entirely, the reconciler falls back to the narrow legacy interpretation —
 *   `listIds` selects the external teams to sync and `teamId` (or `resolveImportTeam`) is the
 *   single Docket team all of them land in. The two are never blended: a non-empty
 *   `teamMappings` takes full precedence over `listIds`/`teamId` for team routing.
 */
export const ConnectorConfig = z
  .object({
    teamId: z
      .string()
      .optional()
      .describe(
        'The Docket team mirrored linked tasks land in (see `resolveImportTeam`). Absent falls back to the resolved import team.',
      ),
    projectId: z
      .string()
      .optional()
      .describe(
        'The Docket project mirrored linked tasks are attached to, when scoping the import to a project.',
      ),
    listIds: z
      .array(z.string())
      .optional()
      .describe(
        'Which external task lists to sync (ids from `GET /:id/lists`). Empty/absent means all lists.',
      ),
    defaultListId: z
      .string()
      .optional()
      .describe(
        'The external list a pushed native task is created in (the write-back target for new tasks).',
      ),
    pushNativeTasks: z
      .boolean()
      .optional()
      .describe(
        'Opt-in: also push `native` Docket tasks in the target team OUT to the provider as new external tasks. Default off, to avoid surprising bulk creation.',
      ),
    emailToTask: z
      .object({
        enabled: z
          .boolean()
          .describe('Whether the email-to-task ingest sweeps this mailbox. Strictly opt-in.'),
        threshold: z
          .number()
          .int()
          .min(0)
          .max(100)
          .describe(
            'The funnel pass score (0–100) a thread must reach to be synthesized into a suggestion. Explicit by design — enabling always sets it; there is no hidden default.',
          ),
      })
      .optional()
      .describe(
        'Email-to-task ingest config (mail-capable connectors only). Absent = the feature is off for this integration; when present, BOTH fields are required — see `docs/engineering/specs/email-to-task.md`.',
      ),
    teamMappings: z
      .array(
        z.object({
          externalTeamId: z
            .string()
            .describe('The provider team id (e.g. a Linear team id) whose work is mirrored.'),
          teamId: z.string().describe('The Docket team that team’s mirrored work lands in.'),
        }),
      )
      .optional()
      .describe(
        'Work-graph connectors only: the explicit per-external-team → Docket-team routing table. An external team absent from this table is NOT synced (no fallback). When omitted entirely, the reconciler falls back to `listIds` (which external teams) + `teamId`/`resolveImportTeam` (the single landing team). A non-empty table takes full precedence over `listIds`/`teamId` for routing.',
      ),
  })
  .meta({
    id: 'ConnectorConfig',
    description: 'Per-connector sync configuration (task lists, target team, write-back options).',
  });
/** Validated connector-config value. */
export type ConnectorConfig = z.infer<typeof ConnectorConfig>;

/**
 * Per-purpose incremental-sync cursors, stored in the integration's `sync_state` jsonb.
 *
 * @remarks
 * Cursors are opaque, provider-owned resume tokens (Gmail `historyId`; Microsoft Graph
 * `deltaLink`) — never parsed by the app, only echoed back to the connector's
 * `listThreads`. Written exclusively while the sync lease is held, so concurrent sweeps
 * cannot interleave cursor updates. An absent purpose key means no cursor yet: the next
 * pull is a full one. See `docs/engineering/specs/mail-providers.md` §4.
 */
export const IntegrationSyncState = z
  .object({
    mail: z
      .object({
        cursor: z.string().describe('The provider-owned resume token from the last page.'),
        updatedAt: z.string().describe('RFC3339 time the cursor was last advanced.'),
      })
      .optional()
      .describe('The email-to-task ingest cursor (absent = next pull is a full one).'),
  })
  .meta({
    id: 'IntegrationSyncState',
    description: 'Per-purpose incremental-sync cursors for an integration.',
  });
/** Validated sync-state value. */
export type IntegrationSyncState = z.infer<typeof IntegrationSyncState>;

/** A selectable external container (e.g. a Google Tasks list) offered in the config UI. */
export const ConnectorResourceRef = z
  .object({
    id: z
      .string()
      .describe(
        "The external container's native id in the provider (e.g. a Google Tasks list id) — the value stored in `config.listIds`/`defaultListId`.",
      ),
    title: z.string().describe("The container's display name as shown in the config picker."),
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
    resources: z
      .array(ConnectorResourceRef)
      .describe(
        'The external containers (e.g. Google Tasks lists) the connector exposes for selection. Fetched live from the provider, so an empty array means the account genuinely has none (a broken credential surfaces as a 409 instead).',
      ),
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
    provider: z
      .string()
      .min(1)
      .describe(
        'The provider id to connect (e.g. `gtasks`, `linear`, `slack`, `github`) — one of the ids from `GET /directory`.',
      ),
    pattern: IntegrationPattern.describe(
      'Whether this is a `migration` (one-time replace) or `connector` (ongoing complement).',
    ),
    roles: z
      .array(IntegrationRole)
      .optional()
      .describe(
        "What this integration contributes (work/context/signal/time/code); defaults to the provider's declared roles when omitted.",
      ),
    connection: IntegrationConnection.optional().describe(
      'Connection metadata (account label, credentialsRef, external workspace). The credential secret is referenced, never inlined.',
    ),
    config: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Freeform per-connector configuration jsonb; validated to `ConnectorConfig` for two-way connectors (target team/project, `listIds`, write-back options).',
      ),
    syncMode: SyncMode.optional().describe(
      'Sync depth (`import` one-time vs `mirror` continuous); defaults per provider.',
    ),
    writeBack: z
      .boolean()
      .optional()
      .describe(
        'Whether Docket changes are pushed back to the provider (two-way). Defaults ON for connectors that support it (e.g. Google Tasks) unless set false.',
      ),
    externalAccountId: z
      .string()
      .optional()
      .describe(
        'The provider account this integration binds to (e.g. the Google `sub`), letting one org link multiple accounts of the same provider — each its own integration — and disambiguating the OAuth grant at sync time.',
      ),
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
    roles: z
      .array(IntegrationRole)
      .optional()
      .describe('Replace the contributed roles; omit to leave unchanged.'),
    connection: IntegrationConnection.optional().describe(
      'Replace the connection metadata; omit to leave unchanged. Health is not affected here — re-verify via `POST /:id/verify`.',
    ),
    config: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Replace the connector config (target team/project, `listIds`, write-back options); omit to leave unchanged.',
      ),
    syncMode: SyncMode.optional().describe('Change the sync depth; omit to leave unchanged.'),
    writeBack: z
      .boolean()
      .optional()
      .describe('Toggle two-way write-back; omit to leave unchanged.'),
  })
  .meta({ id: 'IntegrationUpdate', description: 'Update an integration.' });
/** Validated integration-update body. */
export type IntegrationUpdate = z.infer<typeof IntegrationUpdate>;

/** A provider listed in the connect-wizard directory. */
export const IntegrationDirectoryProvider = z
  .object({
    provider: z
      .string()
      .describe('The provider id to pass as `provider` when connecting (e.g. `gtasks`).'),
    name: z
      .string()
      .describe("The provider's human-readable display name shown in the connect wizard."),
    pattern: IntegrationPattern.describe(
      'Whether connecting this provider yields a `migration` or a `connector`.',
    ),
    roles: z
      .array(IntegrationRole)
      .describe('The roles this provider can contribute (work/context/signal/time/code).'),
    category: z
      .string()
      .describe("A grouping label for the connect wizard (e.g. the provider's product category)."),
    syncable: z
      .boolean()
      .describe(
        'Whether the provider supports import/sync through the Connector port. Observe-only signal sources (e.g. Slack) are `false` — they push events inbound and expose no sync.',
      ),
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
    providers: z
      .array(IntegrationDirectoryProvider)
      .describe(
        'Every provider Docket can connect to, with its pattern, roles, and category — the connect-wizard catalog.',
      ),
  })
  .meta({
    id: 'IntegrationDirectoryOut',
    description: 'The set of providers Docket can connect to, with their patterns and roles.',
  });
/** Directory representation value. */
export type IntegrationDirectoryOut = z.infer<typeof IntegrationDirectoryOut>;

/** Lifecycle status of a single connector sync run (one `importWork` pass). */
export const SyncRunStatus = z
  .enum(['running', 'succeeded', 'failed'])
  .describe(
    "The outcome of one sync run: `running` (in progress — only one may run per integration at a time), `succeeded` (completed cleanly), or `failed` (errored — see the run's `error`).",
  );
/** Sync-run-status value. */
export type SyncRunStatus = z.infer<typeof SyncRunStatus>;

/** What triggered a sync run: a user action or the background scheduler. */
export const SyncTrigger = z
  .enum(['manual', 'scheduled'])
  .describe(
    'What started the run: `manual` (a user hit `POST /:id/sync`) or `scheduled` (the background re-sync cadence).',
  );
/** Sync-trigger value. */
export type SyncTrigger = z.infer<typeof SyncTrigger>;

/** What a sync run pulled: the task mirror or the email-to-task ingest. */
export const SyncRunPurpose = z
  .enum(['task_sync', 'email_ingest'])
  .describe(
    'What the run pulled: `task_sync` (the connector task mirror / two-way sync) or `email_ingest` (the email-to-task suggestion sweep). Both purposes run on the same leased spine and share this history.',
  );
/** Sync-run-purpose value. */
export type SyncRunPurpose = z.infer<typeof SyncRunPurpose>;

/**
 * The durable record of one connector sync run.
 *
 * @remarks
 * Replaces the former ephemeral `SyncJobOut` (an in-memory job wiped on every restart). Each
 * run is persisted, so a failure leaves a real, auditable trace instead of vanishing.
 */
export const SyncRunOut = z
  .object({
    id: z.string().describe('The sync-run id.'),
    integrationId: IntegrationId.describe('The integration this run belongs to.'),
    status: SyncRunStatus.describe('Outcome of the run (running/succeeded/failed).'),
    trigger: SyncTrigger.describe('What started the run (manual/scheduled).'),
    purpose: SyncRunPurpose.describe('What the run pulled (task mirror / email ingest).'),
    processed: z
      .number()
      .int()
      .nonnegative()
      .describe('Count of items processed so far (advances during a `running` run).'),
    total: z
      .number()
      .int()
      .nonnegative()
      .describe('Total items the run intends to process (0 when unknown/empty).'),
    error: z
      .string()
      .nullable()
      .describe('The failure reason when `status` is `failed`; null otherwise.'),
    startedAt: z
      .string()
      .describe('ISO-8601 instant the run began — the list sort key (descending).'),
    finishedAt: z
      .string()
      .nullable()
      .describe('ISO-8601 instant the run ended; null while still `running`.'),
  })
  .meta({ id: 'SyncRunOut', description: 'The result of one integration sync run.' });
/** Sync-run representation value. */
export type SyncRunOut = z.infer<typeof SyncRunOut>;

/** Full integration representation returned by reads. */
export const IntegrationOut = z
  .object({
    id: IntegrationId.describe(
      "The integration id; also each mirrored task's `sourceIntegrationId`, kept stable across reconnects.",
    ),
    organizationId: OrganizationId.describe('The organization that owns this integration.'),
    provider: z.string().describe('The connected provider id (e.g. `gtasks`, `linear`, `github`).'),
    pattern: IntegrationPattern.describe('Whether this is a `migration` or a `connector`.'),
    roles: z
      .array(IntegrationRole)
      .describe('The roles this integration contributes (work/context/signal/time/code).'),
    connection: IntegrationConnection.describe(
      'Connection metadata (account label, credentialsRef, external workspace) — never the raw secret.',
    ),
    status: IntegrationStatus.describe(
      'Connection health (pending/connected/error/disconnected) — `connected` is only ever earned by a real connect/verify/sync.',
    ),
    config: z
      .record(z.string(), z.unknown())
      .describe(
        'The connector config jsonb (see `ConnectorConfig`: target team/project, `listIds`, write-back options).',
      ),
    externalAccountId: z
      .string()
      .nullable()
      .describe(
        'The bound provider account (e.g. Google `sub`); null for single-account/legacy integrations.',
      ),
    syncMode: SyncMode.describe('Sync depth (`import` one-time vs `mirror` continuous).'),
    writeBack: z
      .boolean()
      .describe(
        'Whether this connector also writes Docket changes back to the provider (two-way sync).',
      ),
    lastSyncStatus: SyncRunStatus.nullable().describe(
      'Status of the most recent sync run; null = never synced.',
    ),
    lastSyncedAt: z
      .string()
      .nullable()
      .describe('ISO-8601 timestamp of the last SUCCESSFUL sync; null = never succeeded.'),
    lastError: z
      .string()
      .nullable()
      .describe(
        'Why the connection/last-sync is unhealthy; null = healthy. Paired with `status` of `error`.',
      ),
    lastErrorAt: z
      .string()
      .nullable()
      .describe('ISO-8601 timestamp `lastError` was recorded; null when there is no error.'),
    syncCadenceMinutes: z
      .number()
      .int()
      .positive()
      .nullable()
      .describe('Background re-sync cadence in minutes; null = manual-only (no scheduled sync).'),
    createdAt: z.string().describe('ISO-8601 timestamp the integration was first connected.'),
  })
  .meta({ id: 'IntegrationOut', description: 'An external integration.' });
/** Integration representation value. */
export type IntegrationOut = z.infer<typeof IntegrationOut>;

/**
 * How an `external_actor` identity-mapping row was resolved to a Docket Actor.
 *
 * @remarks
 * `email` rows are re-evaluated on every sync (the mapping tracks the provider's/member's
 * current email); `manual` rows were explicitly set by an admin via `PATCH` and are NEVER
 * touched by the sync engine's email matching again — a human's link always wins.
 */
export const ExternalActorMatchedBy = z
  .enum(['email', 'manual'])
  .describe(
    'How this mapping was resolved: `email` (the sync engine matched by email against an org member; may be re-evaluated — and change or unmatch — on a future sync) or `manual` (an admin explicitly linked it via `PATCH …/external-actors/:externalActorId`; never overwritten by re-matching).',
  );
/** External-actor match-source value. */
export type ExternalActorMatchedBy = z.infer<typeof ExternalActorMatchedBy>;

/**
 * A provider-side user (e.g. a Linear member) mapped to a Docket Actor, one row per
 * `(integration, externalId)`.
 *
 * @remarks
 * `actorId: null` is an explicit, queryable UNMATCHED state — never a fallback assignment.
 * `email`/`displayName`/`avatarUrl` are refreshed from the provider on every sync regardless
 * of match state, since the provider is the source of truth for those fields.
 */
export const ExternalActorOut = z
  .object({
    id: z.string().describe('The external-actor mapping row id.'),
    externalId: z
      .string()
      .describe("The provider's native user id (e.g. a Linear user UUID) — stable across syncs."),
    email: z
      .string()
      .nullable()
      .describe(
        "The provider user's email as of the last sync, refreshed every time; null when the provider does not expose one for this user.",
      ),
    displayName: z
      .string()
      .describe("The provider user's display name as of the last sync, refreshed every time."),
    avatarUrl: z
      .string()
      .nullable()
      .describe('URL to the avatar image, refreshed every sync; null when unavailable.'),
    actorId: ActorId.nullable().describe(
      'The matched Docket Actor, or null — an explicit, queryable UNMATCHED state (never a fallback assignment). A push for a Docket assignee absent from the reverse of this mapping simply omits the assignee field.',
    ),
    matchedBy: ExternalActorMatchedBy.nullable().describe(
      'How `actorId` was resolved (`email`/`manual`), or null when unmatched.',
    ),
    createdAt: z.string().describe('ISO-8601 timestamp the mapping row was first created.'),
    updatedAt: z
      .string()
      .describe('ISO-8601 timestamp the mapping was last refreshed and/or re-matched.'),
  })
  .meta({
    id: 'ExternalActorOut',
    description: 'A provider-user → Docket-Actor identity mapping.',
  });
/** External-actor mapping representation value. */
export type ExternalActorOut = z.infer<typeof ExternalActorOut>;

/**
 * Body for manually linking or unlinking an `external_actor` mapping.
 *
 * @remarks
 * `actorId` is a required key (never omitted) so the intent is always explicit: a string
 * links (and marks `matchedBy: 'manual'`, immune to future email re-matching), `null` unlinks
 * (and clears `matchedBy` too, so a later sync may re-match it by email).
 */
export const ExternalActorPatch = z
  .object({
    actorId: ActorId.nullable().describe(
      "Set to a Docket Actor id to link manually — the actor MUST belong to the caller's org (404 `Actor not found` otherwise); the row is marked `matchedBy: 'manual'` and survives future email re-syncs untouched. Set to `null` to unlink — this also clears `matchedBy`, so the next email sync may re-match the row.",
    ),
  })
  .meta({
    id: 'ExternalActorPatch',
    description: 'Manually link or unlink an external-actor identity mapping.',
  });
/** Validated external-actor patch body. */
export type ExternalActorPatch = z.infer<typeof ExternalActorPatch>;
