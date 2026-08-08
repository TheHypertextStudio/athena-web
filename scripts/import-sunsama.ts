/**
 * `pnpm sunsama:import` — migrate all active Sunsama work into Docket, through Sunsama's MCP
 * server and nothing else (WIL-01 / WIL-02 / WIL-03 / WIL-04 / MISS-08).
 *
 * @remarks
 * **How the data is read.** Every Sunsama record this tool sees arrives as the result of an MCP
 * `tools/call` against Sunsama's server. There is no HTTP client for Sunsama here, no HTML
 * parsing, and no CSV path — `@docket/integrations`'s `readSunsamaAccount` is the only reader, and
 * it records the tool name and arguments of every call it makes so the run report can list them.
 *
 * **A live run requires a one-time interactive authorization, and this tool will not pretend
 * otherwise.** `https://api.sunsama.com/mcp` speaks the MCP OAuth flow; a headless script cannot
 * complete a browser consent. So `--source=live` demands an already-minted bearer token
 * (`SUNSAMA_MCP_TOKEN`, obtained through Settings → Connections → MCP connectors) and fails loudly
 * without one. `--source=fixture` (the default) runs the entire pipeline — read, normalize, route,
 * map, reconcile, report — against the committed offline fixture account, which is how the
 * migration is proven correct before anyone authorizes anything.
 *
 * **What `--apply` does.** Without it, this tool only reads and reports — nothing is written,
 * ever, on any source. With it, `--source=fixture` maps every task through
 * `@docket/integrations`'s `sunsama-connector.ts` (`SunsamaTask` → `ImportedItem`, real
 * provenance) and reconciles each destination workspace's tasks through
 * `apps/api/src/routes/integration-reconcile.ts`'s `reconcileTasks` — the same write path Notion
 * and Google Tasks use — into a disposable, per-workspace sandbox org/team this tool creates (or
 * reuses) itself, named `Sunsama fixture proof — <workspace>`. That is what makes a second run
 * idempotent: `reconcileTasks` recognizes a task it already wrote (by
 * `sourceIntegrationId` + `externalId`) and no-ops instead of duplicating it, and this tool proves
 * that by literally running twice. `--apply --source=live` is refused — see
 * {@link refuseLiveApply} — because a live migration additionally needs a human to authorize
 * Sunsama's OAuth consent and set `SUNSAMA_MCP_TOKEN`, which is out of this tool's power to do for
 * itself.
 *
 * **`--apply` needs its own `DATABASE_URL`, and it must not be the shared dev-stack database.**
 * PGlite (the embedded local database `DATABASE_URL=pglite://...` selects) is a single-process
 * engine — it is not safe for two Node processes to open the same on-disk store at once, and doing
 * so corrupts it (this happened once during this feature's own development: running this tool
 * against the interactive dev stack's live `pglite://.data/docket` while `./scripts/dev-stack.sh`
 * was also running it wedged that database hard enough that even `drizzle-kit migrate` could no
 * longer open it, and recovering it meant `pnpm db:reset` — wiping every other agent's dev-stack
 * data along with it). So `--apply` refuses to run at all without an explicit `DATABASE_URL`, and
 * refuses the shared dev-stack one by name. Point it at a dedicated database instead:
 *
 * ```sh
 * # once: migrate a dedicated database this tool owns exclusively
 * DATABASE_URL="pglite://.data/sunsama-fixture-proof" pnpm --filter @docket/db db:migrate
 *
 * # apply against it (loads the rest of the app env from .env.local; DATABASE_URL above wins)
 * DATABASE_URL="pglite://.data/sunsama-fixture-proof" pnpm dotenv -e .env.local -- \
 *   pnpm sunsama:import --source=fixture --apply
 * ```
 *
 * **The report.** Every run writes a JSON report containing the source counts, the per-workspace
 * routing counts checked against the pre-declared routing, the MCP invocation log, and every
 * source field that had no Docket destination. An applied run additionally reports the real
 * per-workspace created/already-present counts and the real WIL-01 reconciliation (every Sunsama
 * id ↔ Docket id, both unmatched lists). Committing that file is what makes the state of the
 * migration auditable rather than a claim.
 *
 * Usage (from the repo root):
 *
 * ```sh
 * # prove the pipeline offline — no accounts, no network, no writes
 * pnpm sunsama:import --source=fixture --report=docs/migration/sunsama-run.json
 *
 * # the same, actually applied to a dedicated database (see above)
 * DATABASE_URL="pglite://.data/sunsama-fixture-proof" pnpm dotenv -e .env.local -- \
 *   pnpm sunsama:import --source=fixture --apply
 *
 * # read-only, against the real account (needs SUNSAMA_MCP_TOKEN)
 * pnpm sunsama:import --source=live
 * ```
 *
 * Exits non-zero when the routing declaration is violated, when a task ends up unrouted, or when
 * a live run — read or apply — is asked for without what it needs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  MockMcpConnector,
  RealMcpConnector,
  SUNSAMA_FIXTURE_DAYS,
  SUNSAMA_FIXTURE_HOST,
  SUNSAMA_FIXTURE_URL,
  SUNSAMA_MCP_URL,
  SUNSAMA_MIGRATION_FIXTURE_SERVER,
  SUNSAMA_ROUTING,
  type DocketWorkspaceName,
  type ImportedItem,
  type MappedSunsamaTask,
  type SunsamaReadResult,
  type SunsamaTask,
  groupSunsamaImportedItemsByWorkspace,
  mapSunsamaTask,
  readSunsamaAccount,
  sunsamaAccountToImportedItems,
  validateSunsamaRouting,
  verifySunsamaRouting,
} from '../packages/integrations/src';
// Type-only: erased at compile time, so importing it here does NOT give the default (no
// `--apply`) path a `@docket/db`/`DATABASE_URL` dependency. The real, runtime import is the
// dynamic `await import('../packages/db/src')` inside `applyToDocket`, which only executes when
// `--apply` is actually requested.
import type * as DbModuleImport from '../packages/db/src';

export { SUNSAMA_ROUTING };

/** Where the reader's data comes from. */
export type ImportSource = 'fixture' | 'live';

/** Parsed command line. */
interface CliOptions {
  /** Fixture (offline) or live (requires an authorized Sunsama MCP token). */
  readonly source: ImportSource;
  /** Whether the caller asked to write — allowed for `--source=fixture` only. */
  readonly apply: boolean;
  /** Where the run report is written. */
  readonly reportPath: string;
  /** Days to sweep for planned work. */
  readonly days: readonly string[];
}

/** Parse `--flag=value` arguments. */
export function parseImportOptions(argv: readonly string[]): CliOptions {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (match?.[1]) flags.set(match[1], match[2] ?? 'true');
  }
  const source = flags.get('source') === 'live' ? 'live' : 'fixture';
  const daysFlag = flags.get('days');
  return {
    source,
    apply: flags.get('apply') === 'true',
    reportPath: flags.get('report') ?? 'docs/migration/sunsama-run.json',
    days:
      daysFlag !== undefined
        ? daysFlag
            .split(',')
            .map((d) => d.trim())
            .filter(Boolean)
        : source === 'fixture'
          ? SUNSAMA_FIXTURE_DAYS
          : plannedDayWindow(new Date()),
  };
}

/**
 * The days a live run sweeps for planned work: 30 back and 60 forward from today.
 *
 * @remarks
 * Sunsama's planned work is addressed one day at a time, so "all active work" needs a window.
 * Backward coverage catches items planned for a day that has passed but never completed; forward
 * coverage catches everything already scheduled. Anything outside the window is still migrated if
 * it is in the backlog — only *planned* work is windowed, and the report states the window so the
 * reader can widen it.
 */
export function plannedDayWindow(today: Date, back = 30, forward = 60): readonly string[] {
  const days: string[] = [];
  for (let offset = -back; offset <= forward; offset += 1) {
    const day = new Date(today.getTime() + offset * 86_400_000);
    days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

/** The per-workspace outcome of a run. */
interface WorkspaceOutcome {
  /** Workspace name. */
  readonly workspace: string;
  /** Tasks routed here. */
  readonly routed: number;
  /** Subtask child rows riding along with the tasks routed here. */
  readonly childRows: number;
  /** Rows (tasks + child rows) created this run (0 unless `--apply` actually wrote). */
  readonly created: number;
  /** Rows already present from an earlier `--apply` run of the same source id. */
  readonly alreadyPresent: number;
}

/** The committed run report. */
interface RunReport {
  /** When the run happened. */
  readonly ranAt: string;
  /** Fixture or live. */
  readonly source: ImportSource;
  /** The MCP endpoint the data came from. */
  readonly endpoint: string;
  /** Whether writes were performed. */
  readonly applied: boolean;
  /** Total active Sunsama tasks read. */
  readonly sunsamaActiveCount: number;
  /** Archived Sunsama tasks read (counted, never migrated as active). */
  readonly sunsamaArchivedCount: number;
  /** Docket tasks that carry one of those Sunsama ids after the run. */
  readonly docketMatchedCount: number;
  /** Sunsama ids with no Docket counterpart — must be empty for a complete migration. */
  readonly unmatchedSunsamaIds: readonly string[];
  /** Docket tasks carrying a Sunsama id the source no longer has — must be empty. */
  readonly unmatchedDocketIds: readonly string[];
  /** Per-workspace routing/creation counts. */
  readonly workspaces: readonly WorkspaceOutcome[];
  /** The routing declaration this run was checked against. */
  readonly routing: {
    readonly label: string;
    readonly fallbackWorkspace: string;
    readonly expectedFallbackTaskCount: number;
    readonly observedFallbackTaskCount: number;
    readonly matchesDeclaration: boolean;
    readonly unroutedCount: number;
  };
  /** The MCP tool calls the data came from. */
  readonly mcpInvocations: readonly {
    readonly capability: string;
    readonly tool: string;
    readonly input: Record<string, unknown>;
    readonly taskCount: number;
  }[];
  /** Capabilities the server did not advertise (so the report says what was not read). */
  readonly missingCapabilities: readonly string[];
  /** Which day window was swept for planned work. */
  readonly plannedDayWindow: readonly string[];
  /** Per-task fields that had no Docket destination — preserved, never dropped silently. */
  readonly preservedFields: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /**
   * What the reconcile write path measurably persisted, counted from the database AFTER the run —
   * not echoed from the input. Present only on an applied run. These are the three fields
   * `docs/migration/sunsama-to-docket.md` §5.3 once named as dropped by the shared
   * `ImportedItem`/`reconcileTasks` contract; the counts prove the closure on every run rather
   * than asserting it once.
   */
  readonly persistedByReconciler?: {
    /** Linked rows with a non-null `task.startDate` (Sunsama's planned day). */
    readonly startDate: number;
    /** Linked rows with a non-null `task.estimateMinutes`. */
    readonly estimateMinutes: number;
    /** Linked rows that are child rows (`task.parentTaskId` set) — one per Sunsama subtask. */
    readonly childRows: number;
  };
}

/** Read the Sunsama account for the chosen source. */
async function readAccount(options: CliOptions): Promise<SunsamaReadResult> {
  if (options.source === 'fixture') {
    const connector = new MockMcpConnector({
      servers: { [SUNSAMA_FIXTURE_HOST]: SUNSAMA_MIGRATION_FIXTURE_SERVER },
    });
    const session = await connector.open({ url: SUNSAMA_FIXTURE_URL });
    return readSunsamaAccount(session, { days: options.days, includeArchived: true });
  }

  const token = process.env['SUNSAMA_MCP_TOKEN'];
  if (token === undefined || token.trim() === '') {
    throw new Error(
      'A live Sunsama run needs an authorized MCP credential. Sunsama’s MCP server uses OAuth, ' +
        'which requires a one-time interactive approval in a browser: connect it under ' +
        'Settings → Connections → MCP connectors, then set SUNSAMA_MCP_TOKEN and re-run. ' +
        'Until then, use --source=fixture.',
    );
  }
  const session = await new RealMcpConnector().open({
    url: SUNSAMA_MCP_URL,
    bearerToken: token,
  });
  try {
    return await readSunsamaAccount(session, { days: options.days, includeArchived: true });
  } finally {
    await session.close();
  }
}

/** Group mapped tasks by destination workspace (drives the report's `preservedFields`). */
function groupByWorkspace(
  mapped: readonly { task: SunsamaTask; mapped: MappedSunsamaTask }[],
): Map<string, { task: SunsamaTask; mapped: MappedSunsamaTask }[]> {
  const groups = new Map<string, { task: SunsamaTask; mapped: MappedSunsamaTask }[]>();
  for (const entry of mapped) {
    const bucket = groups.get(entry.mapped.workspace) ?? [];
    bucket.push(entry);
    groups.set(entry.mapped.workspace, bucket);
  }
  return groups;
}

/**
 * Refuse `--apply --source=live`.
 *
 * @remarks
 * The fixture-sourced path is proven end-to-end — real provenance, an idempotent second run, a
 * real per-workspace count report (see this module's top doc). A live run needs one more thing no
 * amount of code here can supply: a human authorizing Sunsama's MCP OAuth consent and setting
 * `SUNSAMA_MCP_TOKEN`. This session has neither, and this tool will not scrape, guess, or fabricate
 * a credential to get around that — it says so and stops.
 *
 * @throws {Error} Always — a live apply is not something this tool can do for itself.
 */
function refuseLiveApply(): never {
  throw new Error(
    [
      '--apply --source=live is not available.',
      '',
      'The fixture-sourced path (`--source=fixture --apply`) is proven end-to-end: real provenance,',
      'an idempotent second run, and a real per-workspace count report. A live run needs one more',
      'thing this tool cannot supply for itself — a human authorizing Sunsama’s MCP OAuth consent',
      'and setting SUNSAMA_MCP_TOKEN. See docs/migration/sunsama-to-docket.md §5.',
      '',
      'Prove the pipeline with --source=fixture --apply; apply live once that credential exists.',
    ].join('\n'),
  );
}

/** The shared interactive dev-stack database — `--apply` must never point at this. See top doc. */
const SHARED_DEV_STACK_DATABASE_URL = 'pglite://.data/docket';

/**
 * Refuse `--apply` unless `DATABASE_URL` is an explicit, non-shared database.
 *
 * @remarks
 * PGlite is a single-process embedded database; two Node processes opening the same on-disk store
 * concurrently corrupts it — not a theoretical risk, see this module's top doc for what happened
 * the one time this was tried against the live dev stack. This check cannot detect "is some other
 * process ALSO using this URL right now" in general, but it CAN refuse the one URL guaranteed to
 * have one (the committed `.env.local`'s dev-stack database) and refuse an unset `DATABASE_URL`
 * outright, which together catch the mistake this tool's own history made.
 *
 * @throws {Error} When `DATABASE_URL` is unset or is the shared dev-stack database.
 */
function assertSafeApplyDatabase(): void {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.trim() === '') {
    throw new Error(
      '--apply needs DATABASE_URL set to a database this tool can write to exclusively — see this ' +
        'module’s top doc for the exact invocation. It will not default to one, because the one ' +
        'sensible-looking default (the committed .env.local dev-stack database) is unsafe here.',
    );
  }
  if (url === SHARED_DEV_STACK_DATABASE_URL) {
    throw new Error(
      `--apply refuses to run against ${SHARED_DEV_STACK_DATABASE_URL} — that is the shared ` +
        'interactive dev-stack database, and a second process opening it while the dev stack is ' +
        'running corrupts it (this happened once during this feature’s own development; see this ' +
        'module’s top doc). Point DATABASE_URL at a dedicated database instead.',
    );
  }
}

/** The lazily-imported `@docket/db` module shape (see {@link applyToDocket}). */
type DbModule = typeof DbModuleImport;
/** One `integration` table row. */
type IntegrationRow = DbModule['integration']['$inferSelect'];

/** One destination workspace's disposable sandbox, resolved (or created) idempotently. */
interface FixtureProofScope {
  readonly orgId: string;
  readonly teamId: string;
  readonly actorId: string;
  readonly integrationRow: IntegrationRow;
}

/** Display-name prefix for the disposable per-workspace orgs `--apply --source=fixture` owns. */
const FIXTURE_PROOF_ORG_PREFIX = 'Sunsama fixture proof — ';

/** Derive a stable, idempotent org slug for one destination workspace's sandbox. */
function fixtureProofSlug(workspace: string): string {
  const base = workspace
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `sunsama-fixture-proof--${base}`;
}

/** Return the sole row an insert's `.returning()` produced, or throw naming what failed. */
function firstRow<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (!row) throw new Error(`insert returned no row: ${what}`);
  return row;
}

/**
 * Resolve (idempotently) the disposable org/team/actor/`sunsama` `migration`-pattern integration
 * one destination workspace's tasks reconcile into.
 *
 * @remarks
 * A second call for the same workspace name reuses everything by exact-name/slug lookup (never
 * creates a second sandbox) — the same idempotence contract `scripts/provision-workspaces.ts`
 * gives the real eight workspaces, scaled down to what a fixture proof needs: no OAuth, no seeded
 * roles, just enough of `organization`/`team`/`actor`/`integration` for `reconcileTasks` to have
 * somewhere real to write. `integration.pattern` is `'migration'` and the row is never added to
 * `provider-catalog.ts` — see `sunsama-connector.ts`'s top doc for why that boundary matters.
 *
 * @param dbModule - The lazily-imported `@docket/db` module (see {@link applyToDocket}).
 * @param workspace - The destination workspace name this sandbox stands in for.
 */
async function resolveFixtureProofScope(
  dbModule: DbModule,
  workspace: string,
): Promise<FixtureProofScope> {
  const { db, organization, team, actor, integration } = dbModule;
  const slug = fixtureProofSlug(workspace);

  const org =
    (await db.query.organization.findFirst({ where: (t, { eq }) => eq(t.slug, slug) })) ??
    firstRow(
      await db
        .insert(organization)
        .values({
          name: `${FIXTURE_PROOF_ORG_PREFIX}${workspace}`,
          slug,
          lifecycleState: 'active',
          purpose:
            'Disposable sandbox created by `pnpm sunsama:import --apply` to prove the Sunsama → ' +
            'Docket migration pipeline end-to-end on the offline fixture. Safe to delete.',
        })
        .returning(),
      `organization for ${workspace}`,
    );

  const teamRow =
    (await db.query.team.findFirst({ where: (t, { eq }) => eq(t.organizationId, org.id) })) ??
    firstRow(
      await db
        .insert(team)
        .values({ organizationId: org.id, name: 'Migrated work', key: 'MIG' })
        .returning(),
      `team for ${workspace}`,
    );

  const actorRow =
    (await db.query.actor.findFirst({
      where: (t, { and, eq }) => and(eq(t.organizationId, org.id), eq(t.kind, 'agent')),
    })) ??
    firstRow(
      await db
        .insert(actor)
        .values({ organizationId: org.id, kind: 'agent', displayName: 'Sunsama migration' })
        .returning(),
      `actor for ${workspace}`,
    );

  const integrationRow =
    (await db.query.integration.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.organizationId, org.id), eq(t.provider, 'sunsama'), eq(t.pattern, 'migration')),
    })) ??
    firstRow(
      await db
        .insert(integration)
        .values({
          organizationId: org.id,
          provider: 'sunsama',
          pattern: 'migration',
          roles: ['work'],
          syncMode: 'import',
          syncCadenceMinutes: null,
          createdBy: actorRow.id,
        })
        .returning(),
      `integration for ${workspace}`,
    );

  return { orgId: org.id, teamId: teamRow.id, actorId: actorRow.id, integrationRow };
}

/** What applying the migration to Docket produced. */
interface ApplyResult {
  /** Per-workspace created/already-present counts, keyed by workspace name. */
  readonly countsByWorkspace: ReadonlyMap<string, { created: number; alreadyPresent: number }>;
  /** Docket tasks that carry one of the source Sunsama ids after the run. */
  readonly docketMatchedCount: number;
  /** Sunsama ids with no Docket counterpart after the run. */
  readonly unmatchedSunsamaIds: readonly string[];
  /** Docket-linked-task ids/external ids carrying a Sunsama id the source no longer has. */
  readonly unmatchedDocketIds: readonly string[];
  /** DB-measured field persistence (see `RunReport.persistedByReconciler`). */
  readonly persisted: { startDate: number; estimateMinutes: number; childRows: number };
}

/**
 * Reconcile every destination workspace's mapped tasks into Docket, and report what actually
 * happened.
 *
 * @remarks
 * `@docket/db` and `reconcileTasks` are imported HERE, dynamically, rather than at module scope —
 * so the default read-only path (no `--apply`) never needs `DATABASE_URL` or the rest of the app
 * env `apps/api/src/routes/integration-reconcile.ts` transitively requires. Only an `--apply` run
 * pays that cost, and only after {@link assertSafeApplyDatabase} has already vetted the database.
 *
 * @param itemsByWorkspace - Every mapped task, grouped by destination workspace.
 * @param sunsamaIds - Every active Sunsama task id this run read (the WIL-01 reconciliation set).
 */
async function applyToDocket(
  itemsByWorkspace: ReadonlyMap<DocketWorkspaceName, readonly ImportedItem[]>,
  sunsamaIds: readonly string[],
): Promise<ApplyResult> {
  const dbModule = await import('../packages/db/src');
  const { reconcileTasks } = await import('../apps/api/src/routes/integration-reconcile');

  const countsByWorkspace = new Map<string, { created: number; alreadyPresent: number }>();
  const integrationIds: string[] = [];

  for (const [workspace, items] of itemsByWorkspace) {
    const scope = await resolveFixtureProofScope(dbModule, workspace);
    integrationIds.push(scope.integrationRow.id);

    const tally = await reconcileTasks(
      scope.orgId,
      scope.actorId,
      scope.integrationRow,
      scope.teamId,
      items,
      { assigneeId: null, writable: null },
    );
    countsByWorkspace.set(workspace, {
      created: tally.inserted,
      alreadyPresent: items.length - tally.inserted,
    });
  }

  const { db } = dbModule;
  const linkedRows =
    integrationIds.length === 0
      ? []
      : await db.query.task.findMany({
          where: (t, { and, eq, inArray }) =>
            and(inArray(t.sourceIntegrationId, integrationIds), eq(t.source, 'linked')),
          columns: {
            id: true,
            externalId: true,
            startDate: true,
            estimateMinutes: true,
            parentTaskId: true,
          },
        });

  const docketExternalIds = new Set(
    linkedRows.map((row) => row.externalId).filter((id): id is string => id !== null),
  );
  const sunsamaIdSet = new Set(sunsamaIds);
  const unmatchedSunsamaIds = sunsamaIds.filter((id) => !docketExternalIds.has(id));
  const unmatchedDocketIds = linkedRows
    .filter((row) => row.externalId === null || !sunsamaIdSet.has(row.externalId))
    .map((row) => row.externalId ?? row.id);

  // Measured from what the database actually holds after the reconcile — the proof that the
  // §5.3 fields (planned day, estimate, subtasks-as-child-rows) survive the write path.
  const persisted = {
    startDate: linkedRows.filter((row) => row.startDate !== null).length,
    estimateMinutes: linkedRows.filter((row) => row.estimateMinutes !== null).length,
    childRows: linkedRows.filter((row) => row.parentTaskId !== null).length,
  };

  // The database handle (PGlite or postgres-js) keeps its own timers/sockets alive, which would
  // otherwise leave the CLI process hanging after the report is written — close it explicitly so
  // `pnpm sunsama:import --apply` exits on its own rather than needing Ctrl-C every time.
  await dbModule.closeDb();

  return {
    countsByWorkspace,
    docketMatchedCount: docketExternalIds.size,
    unmatchedSunsamaIds,
    unmatchedDocketIds,
    persisted,
  };
}

/** Run the migration. */
async function main(): Promise<void> {
  const options = parseImportOptions(process.argv.slice(2));
  if (options.apply) {
    if (options.source === 'live') refuseLiveApply();
    assertSafeApplyDatabase();
  }

  const routingProblems = validateSunsamaRouting(SUNSAMA_ROUTING);
  if (routingProblems.length > 0) {
    console.error('Routing declaration is invalid:');
    for (const problem of routingProblems) {
      console.error(`  ${problem.code}: ${problem.subject}`);
    }
    process.exitCode = 1;
    return;
  }

  const account = await readAccount(options);
  const routingReport = verifySunsamaRouting(account.tasks, SUNSAMA_ROUTING);
  const importedAt = new Date().toISOString();

  const mappedByTask = account.tasks.map((task) => ({
    task,
    mapped: mapSunsamaTask(task, SUNSAMA_ROUTING),
  }));
  const groups = groupByWorkspace(mappedByTask);

  const preservedFields: Record<string, Record<string, unknown>> = {};
  for (const entry of mappedByTask) {
    if (Object.keys(entry.mapped.preserved).length > 0) {
      preservedFields[entry.task.id] = { ...entry.mapped.preserved };
    }
  }

  const mappedItems = sunsamaAccountToImportedItems(account.tasks, SUNSAMA_ROUTING, importedAt);
  const itemsByWorkspace = groupSunsamaImportedItemsByWorkspace(mappedItems);
  // The WIL-01 reconciliation set: every source id the write path is expected to land, which
  // since the §5.3 closure includes each subtask's child-row id alongside its parent's.
  const allSourceIds = mappedItems.flatMap((entry) => [
    entry.item.provenance.externalId,
    ...entry.childItems.map((child) => child.provenance.externalId),
  ]);
  const childRowsByWorkspace = new Map<string, number>();
  for (const entry of mappedItems) {
    childRowsByWorkspace.set(
      entry.workspace,
      (childRowsByWorkspace.get(entry.workspace) ?? 0) + entry.childItems.length,
    );
  }

  const applyResult =
    options.apply && options.source === 'fixture'
      ? await applyToDocket(itemsByWorkspace, allSourceIds)
      : undefined;

  const outcomes: WorkspaceOutcome[] = [];
  for (const [workspace, entries] of groups) {
    const counts = applyResult?.countsByWorkspace.get(workspace);
    outcomes.push({
      workspace,
      routed: entries.length,
      childRows: childRowsByWorkspace.get(workspace) ?? 0,
      created: counts?.created ?? 0,
      alreadyPresent: counts?.alreadyPresent ?? 0,
    });
  }

  // Without --apply, nothing is written, so every source id is honestly unmatched. With it,
  // applyToDocket already computed the real reconciliation.
  const docketMatched = applyResult?.docketMatchedCount ?? 0;
  const unmatchedDocketIds = applyResult ? [...applyResult.unmatchedDocketIds] : [];
  const unmatchedSunsamaIds = applyResult ? [...applyResult.unmatchedSunsamaIds] : allSourceIds;

  const report: RunReport = {
    ranAt: new Date().toISOString(),
    source: options.source,
    endpoint: options.source === 'fixture' ? SUNSAMA_FIXTURE_URL : SUNSAMA_MCP_URL,
    applied: applyResult !== undefined,
    sunsamaActiveCount: account.tasks.length,
    sunsamaArchivedCount: account.archived.length,
    docketMatchedCount: docketMatched,
    unmatchedSunsamaIds,
    unmatchedDocketIds,
    workspaces: outcomes,
    routing: {
      label: SUNSAMA_ROUTING.label,
      fallbackWorkspace: SUNSAMA_ROUTING.fallbackWorkspace,
      expectedFallbackTaskCount: routingReport.expectedFallbackCount,
      observedFallbackTaskCount: routingReport.fallbackCount,
      matchesDeclaration: routingReport.matchesDeclaration,
      unroutedCount: routingReport.unroutedCount,
    },
    mcpInvocations: account.invocations.map((i) => ({
      capability: i.capability,
      tool: i.tool,
      input: { ...i.input },
      taskCount: i.taskCount,
    })),
    missingCapabilities: [...account.missingCapabilities],
    plannedDayWindow: options.days,
    preservedFields,
    ...(applyResult ? { persistedByReconciler: applyResult.persisted } : {}),
  };

  const reportPath = resolve(process.cwd(), options.reportPath);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(
    `Sunsama → Docket (${options.source}, ${report.applied ? 'APPLIED' : 'dry run — nothing written'})`,
  );
  console.log(`  active tasks read      ${report.sunsamaActiveCount}`);
  console.log(`  archived tasks read    ${report.sunsamaArchivedCount}`);
  for (const outcome of outcomes) {
    console.log(
      `  ${outcome.workspace.padEnd(52)} routed ${outcome.routed}  child rows ${outcome.childRows}  created ${outcome.created}  already-present ${outcome.alreadyPresent}`,
    );
  }
  console.log(
    `  fallback              ${report.routing.observedFallbackTaskCount} (declared ${report.routing.expectedFallbackTaskCount})`,
  );
  console.log(`  report                 ${options.reportPath}`);

  if (!routingReport.matchesDeclaration) {
    console.error(
      `\nFAIL: ${routingReport.fallbackCount} tasks fell through to "${SUNSAMA_ROUTING.fallbackWorkspace}", but the declaration allows ${routingReport.expectedFallbackCount}. Add the missing stream routes and re-run.`,
    );
    process.exitCode = 1;
  }
  if (routingReport.unroutedCount !== 0) {
    console.error(`\nFAIL: ${routingReport.unroutedCount} tasks have no workspace.`);
    process.exitCode = 1;
  }
  if (report.applied) {
    console.log(
      `  RECONCILED             ${String(docketMatched)}/${String(allSourceIds.length)} Sunsama tasks and subtasks now have a Docket task id` +
        (unmatchedSunsamaIds.length > 0
          ? ` — ${String(unmatchedSunsamaIds.length)} still unmatched`
          : ''),
    );
    if (applyResult) {
      console.log(
        `  PERSISTED              startDate on ${String(applyResult.persisted.startDate)} rows, ` +
          `estimateMinutes on ${String(applyResult.persisted.estimateMinutes)} rows, ` +
          `${String(applyResult.persisted.childRows)} subtask child rows`,
      );
    }
  } else {
    const reason =
      options.source === 'live'
        ? 'live writes are refused — see docs/migration/sunsama-to-docket.md §5.1'
        : 'dry run — pass --apply to write for real (see docs/migration/sunsama-to-docket.md §5.2)';
    console.log(`  NOT MIGRATED           ${String(unmatchedSunsamaIds.length)} tasks — ${reason}`);
  }
}

/* v8 ignore start -- CLI entrypoint */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
/* v8 ignore stop */
