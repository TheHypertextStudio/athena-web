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
 * **What it writes: nothing, yet — deliberately.** `--apply` is refused, and
 * {@link assertProvenanceWritable} explains why in full: Docket's task-create API accepts no
 * provenance, so tasks written through it would carry no Sunsama id, a re-run would duplicate
 * every one of them, and the id-level reconciliation this report exists for would be
 * unanswerable. Writing anyway and calling it a migration is the false claim this project has
 * already been burned by, so the tool stops and says what is missing instead.
 *
 * **The report.** Every run writes a JSON report containing the source counts, the per-workspace
 * routing counts checked against the pre-declared routing, the not-yet-migrated list, the MCP
 * invocation log, and every source field that had no Docket destination. Committing that file is
 * what makes the state of the migration auditable rather than a claim.
 *
 * Usage (from the repo root):
 *
 * ```sh
 * # prove the pipeline offline — no accounts, no network, no writes
 * pnpm sunsama:import --source=fixture --report=docs/migration/sunsama-run.json
 *
 * # the same, against the real account (needs SUNSAMA_MCP_TOKEN)
 * pnpm sunsama:import --source=live
 * ```
 *
 * Exits non-zero when the routing declaration is violated, when a task ends up unrouted, or when
 * a live run is asked for without an authorized credential.
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
  type MappedSunsamaTask,
  type SunsamaReadResult,
  type SunsamaTask,
  type SunsamaWorkspaceRouting,
  mapSunsamaTask,
  readSunsamaAccount,
  validateSunsamaRouting,
  verifySunsamaRouting,
} from '../packages/integrations/src';

/**
 * The committed routing declaration: which Sunsama stream lands in which of the eight workspaces.
 *
 * @remarks
 * Declared here, in the tool, BEFORE any run — which is the point. `expectedFallbackTaskCount`
 * states up front how many tasks are allowed to fall through to the fallback workspace; the run
 * fails if reality disagrees, so "everything ended up in one catch-all" cannot be discovered after
 * the fact. Stream ids are the fixture account's; a live run adds the real ids alongside them
 * (matching is by id first, then by name, so a name-only entry works before ids are known).
 */
export const SUNSAMA_ROUTING: SunsamaWorkspaceRouting = {
  label: 'Sunsama → Docket, 2026-08',
  routes: [
    { streamId: 'str-transit', workspace: 'Las Vegans for Better Transit' },
    { streamName: 'Las Vegans for Better Transit', workspace: 'Las Vegans for Better Transit' },
    { streamId: 'str-newsletter', workspace: 'The Willie Diaries' },
    { streamName: 'Weekly newsletter', workspace: 'The Willie Diaries' },
    { streamId: 'str-personal', workspace: 'Personal Life' },
    { streamName: 'Personal', workspace: 'Personal Life' },
    { streamId: 'str-docket', workspace: 'Hypertext Studio' },
    { streamName: 'Docket', workspace: 'Hypertext Studio' },
    { streamName: 'Reasonable Tech', workspace: 'Reasonable Tech Company' },
    { streamName: 'Rebuilding America', workspace: 'Rebuilding America Project' },
    { streamName: 'Oasis', workspace: 'Project Oasis' },
    {
      streamName: 'Vibe Code Cleanup',
      workspace: 'Willie Enterprises (dba Vibe Code Cleanup Company)',
    },
  ],
  fallbackWorkspace: 'Personal Life',
  // The fixture account has exactly one stream-less task. A live run that produces a different
  // number stops here rather than quietly dumping work into the fallback.
  expectedFallbackTaskCount: 1,
};

/** Where the reader's data comes from. */
export type ImportSource = 'fixture' | 'live';

/** Parsed command line. */
interface CliOptions {
  /** Fixture (offline) or live (requires an authorized Sunsama MCP token). */
  readonly source: ImportSource;
  /** Whether the caller asked to write. Accepted so the refusal can explain itself, then refused. */
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
  /** Tasks created this run (0 on a dry run). */
  readonly created: number;
  /** Tasks skipped because the same Sunsama id was already present. */
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

/** Group mapped tasks by destination workspace. */
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
 * Refuse `--apply` while the write path cannot record where a task came from.
 *
 * @remarks
 * This is a deliberate stop, not an oversight. `POST /v1/orgs/:orgId/tasks` accepts no provenance:
 * `TaskProvenance` is machine metadata the reconcile engine owns, and the public API correctly does
 * not let a client claim a task is `linked`. A migration written through that endpoint therefore
 * produces tasks that carry **no Sunsama id**, and three things follow:
 *
 * 1. A second run cannot recognise its own prior output, so it would duplicate every task.
 * 2. The reconciliation this tool exists to produce — every Sunsama id mapping to exactly one
 *    Docket task id, both unmatched lists empty — is unanswerable, because there is nothing on the
 *    Docket side to match against.
 * 3. The report would say "migrated" while being unable to prove it.
 *
 * Writing tasks anyway and reporting success is precisely the false claim this project has been
 * burned by, so the tool stops here and says what is missing. Closing it means giving Sunsama a
 * `ConnectorProvider` client (as Notion has), so migrated work flows through the reconcile engine
 * that does write provenance; the read/route/map half of the pipeline above is already built and
 * tested against it.
 *
 * @throws {Error} Always — this path is not yet safe to run.
 */
function assertProvenanceWritable(): never {
  throw new Error(
    [
      '--apply is not available yet, and the tool will not write work it cannot account for.',
      '',
      'Docket’s task-create API accepts no provenance (TaskProvenance is written by the reconcile',
      'engine, not by clients), so tasks created this way would carry no Sunsama id. A re-run would',
      'then duplicate every task, and the id-level reconciliation this report is for could not be',
      'computed at all.',
      '',
      'What works today: the full read → normalize → route → map → report pipeline. Run it with',
      '--source=fixture (offline) or --source=live (needs SUNSAMA_MCP_TOKEN) and read the report.',
      '',
      'What closes this: a Sunsama ConnectorProvider client, so migrated work flows through the',
      'reconcile engine that stamps task.external_id. See docs/migration/sunsama-to-docket.md §5.',
    ].join('\n'),
  );
}

/** Run the migration. */
async function main(): Promise<void> {
  const options = parseImportOptions(process.argv.slice(2));
  if (options.apply) assertProvenanceWritable();

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
  const mapped = account.tasks.map((task) => ({
    task,
    mapped: mapSunsamaTask(task, SUNSAMA_ROUTING),
  }));
  const groups = groupByWorkspace(mapped);

  const preservedFields: Record<string, Record<string, unknown>> = {};
  for (const entry of mapped) {
    if (Object.keys(entry.mapped.preserved).length > 0) {
      preservedFields[entry.task.id] = { ...entry.mapped.preserved };
    }
  }

  const outcomes: WorkspaceOutcome[] = [];
  for (const [workspace, entries] of groups) {
    outcomes.push({ workspace, routed: entries.length, created: 0, alreadyPresent: 0 });
  }

  // Nothing is written yet (see `assertProvenanceWritable`), so every source id is unmatched on
  // the Docket side and the report says exactly that rather than implying a completed migration.
  const docketMatched = 0;
  const unmatchedDocketIds: string[] = [];
  const unmatchedSunsamaIds = account.tasks.map((t) => t.id);

  const report: RunReport = {
    ranAt: new Date().toISOString(),
    source: options.source,
    endpoint: options.source === 'fixture' ? SUNSAMA_FIXTURE_URL : SUNSAMA_MCP_URL,
    applied: false,
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
  };

  const reportPath = resolve(process.cwd(), options.reportPath);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Sunsama → Docket (${options.source}, dry run — nothing written)`);
  console.log(`  active tasks read      ${report.sunsamaActiveCount}`);
  console.log(`  archived tasks read    ${report.sunsamaArchivedCount}`);
  for (const outcome of outcomes) {
    console.log(
      `  ${outcome.workspace.padEnd(52)} routed ${outcome.routed}  created ${outcome.created}  already-present ${outcome.alreadyPresent}`,
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
  console.log(
    `  NOT MIGRATED           ${String(unmatchedSunsamaIds.length)} tasks — writes are blocked; see docs/migration/sunsama-to-docket.md §5.2`,
  );
}

/* v8 ignore start -- CLI entrypoint */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
/* v8 ignore stop */
