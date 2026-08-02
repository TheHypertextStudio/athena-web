/**
 * `@docket/integrations` — the Sunsama → Docket field mapping and workspace routing.
 *
 * @remarks
 * Two separate contracts live here, both pure and both testable with no network:
 *
 * 1. **Field mapping** ({@link SUNSAMA_FIELD_MAPPING}, {@link mapSunsamaTask}). Every field
 *    Sunsama's MCP server returns is enumerated with either a Docket destination or a written
 *    reason it has none. A field with no destination is *reported*, never quietly discarded —
 *    which is what makes "as much metadata as possible" checkable instead of aspirational. The
 *    enumeration is the source the committed mapping table in
 *    `docs/migration/sunsama-to-docket.md` is generated from, so the doc cannot drift from the code.
 *
 * 2. **Workspace routing** ({@link SunsamaWorkspaceRouting}, {@link routeSunsamaTask}). Sunsama
 *    organizes work into *streams*; Docket organizes it into workspaces. The migration must land
 *    each task in the right one of the author's eight workspaces rather than dumping everything in
 *    a catch-all, so the routing is declared BEFORE a run and the run verifies reality against the
 *    declaration — including how many tasks were expected to fall through to the fallback.
 */
import type { SunsamaTask } from './sunsama';

/**
 * The eight workspaces the migration may route work into, spelled exactly as the author listed
 * them.
 *
 * @remarks
 * Character-for-character; the spelling is the contract (the dba parenthetical included). A
 * routing entry naming anything outside this list is rejected by
 * {@link validateSunsamaRouting} rather than silently creating a ninth workspace.
 */
export const DOCKET_WORKSPACE_NAMES = [
  'Personal Life',
  'The Willie Diaries',
  'Las Vegans for Better Transit',
  'Reasonable Tech Company',
  'Hypertext Studio',
  'Rebuilding America Project',
  'Project Oasis',
  'Willie Enterprises (dba Vibe Code Cleanup Company)',
] as const;
/** One of the eight workspace names. */
export type DocketWorkspaceName = (typeof DOCKET_WORKSPACE_NAMES)[number];

/** Where one Sunsama field ends up in Docket — or why it cannot. */
export interface SunsamaFieldMappingEntry {
  /** The Sunsama field, named as {@link SunsamaTask} carries it. */
  readonly source: keyof SunsamaTask | 'subtasks[].completed';
  /** The Docket destination, or `null` when the field cannot be mapped. */
  readonly destination: string | null;
  /** Why it maps that way, or — when unmappable — why Docket cannot hold it. */
  readonly note: string;
}

/**
 * The complete Sunsama → Docket field mapping table.
 *
 * @remarks
 * Exhaustive over {@link SunsamaTask} by construction: a test asserts every key of the interface
 * appears here, so adding a field to the normalizer without deciding its destination fails the
 * build rather than shipping a silent drop.
 */
export const SUNSAMA_FIELD_MAPPING: readonly SunsamaFieldMappingEntry[] = [
  {
    source: 'id',
    destination: 'task.externalId (with task.source = "linked")',
    note: 'The migration join key. Unique per (integration, externalId), so a re-run updates rather than duplicating.',
  },
  {
    source: 'title',
    destination: 'task.title',
    note: 'Direct. A blank Sunsama title would violate Docket’s not-blank CHECK, so it becomes "Untitled task".',
  },
  {
    source: 'notes',
    destination: 'task.description',
    note: 'Markdown preferred over HTML when the server offers both.',
  },
  {
    source: 'completed',
    destination: 'task.state (the team’s first completed-type workflow state)',
    note: 'Docket has no boolean done flag; completion is a workflow state, resolved per team.',
  },
  {
    source: 'completedAt',
    destination: 'task.completedAt',
    note: 'Direct. Preserved so historical completion timestamps survive the move.',
  },
  {
    source: 'plannedDate',
    destination: 'task.startDate',
    note: 'Sunsama’s "the day I intend to do this" is Docket’s start date, not its due date — conflating the two would invent deadlines that were never set.',
  },
  {
    source: 'dueDate',
    destination: 'task.dueDate',
    note: 'Direct.',
  },
  {
    source: 'timeEstimateMinutes',
    destination: 'task.estimateMinutes',
    note: 'Direct; both are minutes.',
  },
  {
    source: 'actualTimeMinutes',
    destination: null,
    note: 'UNMAPPED. Docket’s tracked time is a ledger of `time_record` segments with real start/stop boundaries, not a scalar total; writing a bare number would fabricate segments that never happened. Preserved in the migration report per task.',
  },
  {
    source: 'streamIds',
    destination: 'workspace routing (see SunsamaWorkspaceRouting)',
    note: 'The stream decides which of the eight workspaces the task lands in — it is routing, not a stored field.',
  },
  {
    source: 'streamNames',
    destination: 'workspace routing (display side)',
    note: 'Used to resolve routing when a run maps by stream NAME rather than id.',
  },
  {
    source: 'subtasks',
    destination: 'child task rows (task.parentTaskId)',
    note: 'Each subtask becomes its own Docket task parented to the migrated task, so its title survives as work rather than as prose in a note.',
  },
  {
    source: 'subtasks[].completed',
    destination: 'child task.state',
    note: 'Each subtask keeps its own completion, mapped exactly as the parent’s is.',
  },
  {
    source: 'backlog',
    destination: 'task.startDate = null',
    note: 'A backlog item is precisely one with no planned day; Docket needs no separate flag.',
  },
  {
    source: 'archived',
    destination: 'excluded from the active migration',
    note: 'Archived Sunsama work is read and counted in the report but is not active work, so it is not migrated as such.',
  },
  {
    source: 'createdAt',
    destination: null,
    note: 'UNMAPPED. `task.createdAt` is Docket’s own insert time and back-dating it would misreport when the row entered this system. Preserved in the migration report per task.',
  },
  {
    source: 'updatedAt',
    destination: 'task.externalUpdatedAt',
    note: 'Stored as the sync anchor, so a later two-way sync can tell a Sunsama edit from a Docket one.',
  },
  {
    source: 'sourceIntegration',
    destination: 'task.externalUrl (when it is a URL)',
    note: 'Sunsama’s GitHub/Linear/Gmail provenance string; kept verbatim in the report when it is not a URL.',
  },
  {
    source: 'unmapped',
    destination: null,
    note: 'UNMAPPED BY DEFINITION. Everything the normalizer did not recognise (e.g. `recurringDefinitionId` — Docket has no task-recurrence model). Enumerated per task in the migration report so nothing disappears without being named.',
  },
];

/** One stream → workspace routing rule. */
export interface SunsamaStreamRoute {
  /** The Sunsama stream id, when known. */
  readonly streamId?: string;
  /** The Sunsama stream name, matched case-insensitively when the id is not known. */
  readonly streamName?: string;
  /** The workspace tasks in this stream land in. */
  readonly workspace: DocketWorkspaceName;
}

/**
 * A routing declaration, committed BEFORE a migration run.
 *
 * @remarks
 * `expectedFallbackTaskCount` is the part that makes this a contract rather than a description:
 * the number of tasks allowed to land in the fallback workspace is declared up front, and
 * {@link verifySunsamaRouting} fails the run when reality disagrees. Discovering after the fact
 * that four hundred tasks fell into a catch-all is exactly the outcome the requirement forbids.
 */
export interface SunsamaWorkspaceRouting {
  /** Human-readable label for this declaration (appears in the run report). */
  readonly label: string;
  /** Per-stream destinations. */
  readonly routes: readonly SunsamaStreamRoute[];
  /** Where a task with no matching route goes. */
  readonly fallbackWorkspace: DocketWorkspaceName;
  /** How many tasks the author expects to land in {@link fallbackWorkspace}. */
  readonly expectedFallbackTaskCount: number;
}

/** A routing declaration that could not be accepted. */
export interface SunsamaRoutingProblem {
  /** Stable machine code for the problem. */
  readonly code: 'unknown-workspace' | 'empty-route' | 'duplicate-route';
  /** The offending route's stream id or name. */
  readonly subject: string;
}

/**
 * Validate a routing declaration before a run touches anything.
 *
 * @param routing - The declaration to check.
 * @returns the problems found; empty means the declaration is usable.
 */
export function validateSunsamaRouting(
  routing: SunsamaWorkspaceRouting,
): readonly SunsamaRoutingProblem[] {
  const problems: SunsamaRoutingProblem[] = [];
  const seen = new Set<string>();
  const known = new Set<string>(DOCKET_WORKSPACE_NAMES);
  if (!known.has(routing.fallbackWorkspace)) {
    problems.push({ code: 'unknown-workspace', subject: routing.fallbackWorkspace });
  }
  for (const route of routing.routes) {
    const subject = route.streamId ?? route.streamName ?? '';
    if (subject === '') {
      problems.push({ code: 'empty-route', subject: '(no stream id or name)' });
      continue;
    }
    const key = subject.toLowerCase();
    if (seen.has(key)) problems.push({ code: 'duplicate-route', subject });
    seen.add(key);
    if (!known.has(route.workspace)) {
      problems.push({ code: 'unknown-workspace', subject: route.workspace });
    }
  }
  return problems;
}

/** Where one task was routed, and whether it took the fallback. */
export interface SunsamaRouteDecision {
  /** The destination workspace name. */
  readonly workspace: DocketWorkspaceName;
  /** True when no route matched and the fallback was used. */
  readonly usedFallback: boolean;
}

/**
 * Route one Sunsama task to a workspace.
 *
 * @remarks
 * Ids beat names (a stream can be renamed; its id cannot), and the fallback is always a real
 * workspace — the return type has no null, so a migrated task cannot end up unassigned.
 *
 * @param task - The normalized task.
 * @param routing - The validated routing declaration.
 */
export function routeSunsamaTask(
  task: SunsamaTask,
  routing: SunsamaWorkspaceRouting,
): SunsamaRouteDecision {
  for (const streamId of task.streamIds) {
    const byId = routing.routes.find((r) => r.streamId === streamId);
    if (byId) return { workspace: byId.workspace, usedFallback: false };
  }
  for (const name of task.streamNames) {
    const byName = routing.routes.find((r) => r.streamName?.toLowerCase() === name.toLowerCase());
    if (byName) return { workspace: byName.workspace, usedFallback: false };
  }
  return { workspace: routing.fallbackWorkspace, usedFallback: true };
}

/** The per-workspace outcome of routing a whole account. */
export interface SunsamaRoutingReport {
  /** Task count per destination workspace. */
  readonly perWorkspace: Readonly<Record<string, number>>;
  /** How many tasks took the fallback. */
  readonly fallbackCount: number;
  /** The count the declaration promised. */
  readonly expectedFallbackCount: number;
  /** Whether reality matched the declaration. */
  readonly matchesDeclaration: boolean;
  /** Tasks with no workspace at all — must always be zero. */
  readonly unroutedCount: number;
}

/**
 * Route every task and check the result against the declaration.
 *
 * @param tasks - The account's active tasks.
 * @param routing - The validated routing declaration.
 * @returns the per-workspace counts plus whether the fallback count matched what was declared.
 */
export function verifySunsamaRouting(
  tasks: readonly SunsamaTask[],
  routing: SunsamaWorkspaceRouting,
): SunsamaRoutingReport {
  const perWorkspace: Record<string, number> = {};
  let fallbackCount = 0;
  for (const task of tasks) {
    const decision = routeSunsamaTask(task, routing);
    perWorkspace[decision.workspace] = (perWorkspace[decision.workspace] ?? 0) + 1;
    if (decision.usedFallback) fallbackCount += 1;
  }
  const routed = Object.values(perWorkspace).reduce((sum, n) => sum + n, 0);
  return {
    perWorkspace,
    fallbackCount,
    expectedFallbackCount: routing.expectedFallbackTaskCount,
    matchesDeclaration: fallbackCount === routing.expectedFallbackTaskCount,
    unroutedCount: tasks.length - routed,
  };
}

/** What one Sunsama task becomes in Docket, before any database write. */
export interface MappedSunsamaTask {
  /** The destination workspace. */
  readonly workspace: DocketWorkspaceName;
  /** Docket task title. */
  readonly title: string;
  /** Docket task description. */
  readonly description: string | null;
  /** Whether the task is complete (resolved to a workflow state at write time). */
  readonly completed: boolean;
  /** Completion timestamp (ISO-8601), when known. */
  readonly completedAt: string | null;
  /** Docket `startDate` — Sunsama's planned day. */
  readonly startDate: string | null;
  /** Docket `dueDate`. */
  readonly dueDate: string | null;
  /** Docket `estimateMinutes`. */
  readonly estimateMinutes: number | null;
  /** The Sunsama id, stored as `task.externalId`. */
  readonly externalId: string;
  /** The sync anchor, stored as `task.externalUpdatedAt`. */
  readonly externalUpdatedAt: string | null;
  /** The provenance URL, when Sunsama's integration string was one. */
  readonly externalUrl: string | null;
  /** Child tasks, one per Sunsama subtask. */
  readonly children: readonly { title: string; completed: boolean }[];
  /** Every source field with no Docket destination, kept for the run report. */
  readonly preserved: Readonly<Record<string, unknown>>;
}

/**
 * Map one normalized Sunsama task onto the Docket shape the importer writes.
 *
 * @remarks
 * Pure: it performs no writes and reads no clock. Every field with no destination lands in
 * {@link MappedSunsamaTask.preserved}, which the run report prints per task — the mechanism by
 * which "unmappable" means "written down somewhere", not "gone".
 *
 * @param task - The normalized Sunsama task.
 * @param routing - The validated routing declaration.
 *
 * @example
 * ```typescript
 * const mapped = mapSunsamaTask(task, routing);
 * mapped.workspace; // 'Las Vegans for Better Transit'
 * ```
 */
export function mapSunsamaTask(
  task: SunsamaTask,
  routing: SunsamaWorkspaceRouting,
): MappedSunsamaTask {
  const preserved: Record<string, unknown> = { ...task.unmapped };
  if (task.actualTimeMinutes !== null) preserved['actualTimeMinutes'] = task.actualTimeMinutes;
  if (task.createdAt !== null) preserved['sunsamaCreatedAt'] = task.createdAt;
  if (task.sourceIntegration !== null && !isUrl(task.sourceIntegration)) {
    preserved['sunsamaSourceIntegration'] = task.sourceIntegration;
  }
  if (task.streamIds.length > 0) preserved['sunsamaStreamIds'] = [...task.streamIds];

  return {
    workspace: routeSunsamaTask(task, routing).workspace,
    title: task.title.trim() === '' ? 'Untitled task' : task.title,
    description: task.notes !== null && task.notes.trim() !== '' ? task.notes : null,
    completed: task.completed,
    completedAt: task.completedAt,
    startDate: task.plannedDate,
    dueDate: task.dueDate,
    estimateMinutes: task.timeEstimateMinutes,
    externalId: task.id,
    externalUpdatedAt: task.updatedAt,
    externalUrl:
      task.sourceIntegration !== null && isUrl(task.sourceIntegration)
        ? task.sourceIntegration
        : null,
    children: task.subtasks.map((s) => ({ title: s.title, completed: s.completed })),
    preserved,
  };
}

/** Whether a provenance string is an absolute http(s) URL. */
function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
