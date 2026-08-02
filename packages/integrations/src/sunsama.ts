/**
 * `@docket/integrations` — the Sunsama **MCP-only** reader used by the one-time migration.
 *
 * @remarks
 * Everything this module knows about Sunsama it learns by calling tools on Sunsama's remote MCP
 * server ({@link SUNSAMA_MCP_URL}). There is deliberately no HTTP client, no HTML parsing, and no
 * CSV path anywhere in this file — the migration requirement is that the data comes through MCP,
 * and the way to make that checkable is for the alternative not to exist in the source.
 *
 * **Tool names are discovered, not assumed.** Sunsama's server has shipped its tools under more
 * than one naming convention (the official changelog names `GET_BACKLOG_TASKS` and
 * `get_task_by_id`; the widely-mirrored community server uses `get-tasks-backlog`). Rather than
 * hard-code one spelling and silently import nothing when it changes, {@link resolveSunsamaTools}
 * matches what the server actually advertises against a documented alias table and reports
 * anything it cannot resolve. A capability that cannot be resolved is a loud failure, never a
 * quietly empty result — an "empty" migration that reports success is the exact failure mode this
 * project has been burned by.
 *
 * **Nothing here writes to Sunsama.** The migration only reads; the source account is left
 * untouched, which is half of "preserve all existing data".
 */
import { asRecord, str } from './json';
import type { RemoteMcpSession, RemoteToolDescriptor } from './mcp-connector';

/** Sunsama's official remote MCP endpoint (OAuth; see `docs/engineering/mcp-access.md`). */
export const SUNSAMA_MCP_URL = 'https://api.sunsama.com/mcp';

/** The capabilities the migration needs from whatever Sunsama's server calls its tools. */
export const SUNSAMA_CAPABILITIES = [
  'getUser',
  'listStreams',
  'listBacklog',
  'listByDay',
  'listArchived',
  'getTask',
] as const;
/** One required Sunsama capability. */
export type SunsamaCapability = (typeof SUNSAMA_CAPABILITIES)[number];

/**
 * The capabilities a migration run cannot proceed without.
 *
 * @remarks
 * `listByDay`, `listArchived` and `getTask` are enriching, not load-bearing: a server that only
 * exposes the backlog can still migrate the backlog honestly (and the report says so). Losing
 * `listBacklog` means there is no active work to read at all, which must abort rather than
 * produce a zero-task "success".
 */
export const SUNSAMA_REQUIRED_CAPABILITIES: readonly SunsamaCapability[] = ['listBacklog'];

/**
 * Documented tool-name aliases per capability, in preference order.
 *
 * @remarks
 * Sourced from Sunsama's own product changelog (the `GET_BACKLOG_TASKS`, `get_task_by_id`,
 * `edit_task_notes`, `append_task_notes`, `timebox_a_task_to_calendar` names it announced) and
 * from the published `mcp-sunsama` tool list (`get-tasks-backlog`, `get-tasks-by-day`,
 * `get-archived-tasks`, `get-user`, `get-streams`). Matching is case-insensitive and ignores
 * `-`/`_` differences, so `GET_BACKLOG_TASKS`, `get_backlog_tasks` and `get-backlog-tasks` are one
 * name as far as resolution is concerned.
 */
export const SUNSAMA_TOOL_ALIASES: Readonly<Record<SunsamaCapability, readonly string[]>> = {
  getUser: ['get_user', 'get-user', 'get_current_user'],
  listStreams: ['get_streams', 'get-streams', 'list_streams'],
  listBacklog: ['get_backlog_tasks', 'get-tasks-backlog', 'get_tasks_backlog', 'list_backlog'],
  listByDay: ['get_tasks_by_day', 'get-tasks-by-day', 'get_tasks_for_day'],
  listArchived: ['get_archived_tasks', 'get-archived-tasks'],
  getTask: ['get_task_by_id', 'get-task-by-id'],
};

/** Normalize a tool name for alias matching: lower-cased, separators collapsed. */
function toolKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, '_');
}

/** The outcome of matching a server's advertised tools against the capabilities we need. */
export interface SunsamaToolResolution {
  /** Capability → the tool name this server actually advertises for it. */
  readonly resolved: ReadonlyMap<SunsamaCapability, string>;
  /** Capabilities this server advertises no tool for. */
  readonly missing: readonly SunsamaCapability[];
  /** Required capabilities that are missing — non-empty means the run must abort. */
  readonly missingRequired: readonly SunsamaCapability[];
}

/**
 * Match a server's advertised tools onto the capabilities the migration needs.
 *
 * @param tools - What `tools/list` returned from the connected Sunsama MCP server.
 * @returns which capability maps to which advertised tool, and what could not be resolved.
 *
 * @example
 * ```typescript
 * const resolution = resolveSunsamaTools(await session.listTools());
 * if (resolution.missingRequired.length > 0) throw new Error('…');
 * ```
 */
export function resolveSunsamaTools(tools: readonly RemoteToolDescriptor[]): SunsamaToolResolution {
  const advertised = new Map<string, string>();
  for (const tool of tools) advertised.set(toolKey(tool.name), tool.name);

  const resolved = new Map<SunsamaCapability, string>();
  const missing: SunsamaCapability[] = [];
  for (const capability of SUNSAMA_CAPABILITIES) {
    const match = SUNSAMA_TOOL_ALIASES[capability]
      .map((alias) => advertised.get(toolKey(alias)))
      .find((name): name is string => name !== undefined);
    if (match === undefined) missing.push(capability);
    else resolved.set(capability, match);
  }
  return {
    resolved,
    missing,
    missingRequired: SUNSAMA_REQUIRED_CAPABILITIES.filter((c) => missing.includes(c)),
  };
}

/** One Sunsama subtask, preserved with its own completion state. */
export interface SunsamaSubtask {
  /** The subtask's own id, when Sunsama supplies one. */
  readonly id: string | null;
  /** The subtask title. */
  readonly title: string;
  /** Whether the subtask is complete. */
  readonly completed: boolean;
}

/**
 * One Sunsama task, normalized but **not** narrowed.
 *
 * @remarks
 * Every field Sunsama's MCP server returns has a home here, including the ones Docket's schema
 * cannot hold — those are preserved on {@link SunsamaTask.unmapped} and reported, because
 * "preserve as much metadata as possible" is only honest if the leftovers are visible rather than
 * dropped on the floor during normalization.
 */
export interface SunsamaTask {
  /** Sunsama's task id — the migration's join key. */
  readonly id: string;
  /** Task title. */
  readonly title: string;
  /** Notes body (markdown when the server offers it, else the HTML it returned). */
  readonly notes: string | null;
  /** Whether the task is complete. */
  readonly completed: boolean;
  /** When it was completed (RFC3339), when known. */
  readonly completedAt: string | null;
  /** The day the task is planned for (`YYYY-MM-DD`), or null for backlog items. */
  readonly plannedDate: string | null;
  /** The due date (RFC3339 or `YYYY-MM-DD`), when set. */
  readonly dueDate: string | null;
  /** Planned time in minutes, when estimated. */
  readonly timeEstimateMinutes: number | null;
  /** Actual tracked time in minutes, when Sunsama recorded any. */
  readonly actualTimeMinutes: number | null;
  /** The stream/channel ids the task belongs to. */
  readonly streamIds: readonly string[];
  /** The stream/channel names, when the payload carried them. */
  readonly streamNames: readonly string[];
  /** Subtasks, each with its own completion state. */
  readonly subtasks: readonly SunsamaSubtask[];
  /** Whether the task sits in the backlog (unscheduled). */
  readonly backlog: boolean;
  /** Whether the task is archived at the source. */
  readonly archived: boolean;
  /** Creation timestamp (RFC3339), when known. */
  readonly createdAt: string | null;
  /** Last-modified timestamp (RFC3339), when known. */
  readonly updatedAt: string | null;
  /** The originating integration Sunsama recorded (GitHub repo, Linear issue, Gmail thread…). */
  readonly sourceIntegration: string | null;
  /** Every remaining top-level key from the raw payload, preserved verbatim. */
  readonly unmapped: Readonly<Record<string, unknown>>;
}

/** Keys {@link normalizeSunsamaTask} consumes; everything else lands in `unmapped`. */
const CONSUMED_KEYS = new Set([
  'id',
  '_id',
  'taskId',
  'text',
  'title',
  'name',
  'notes',
  'notesMarkdown',
  'notesHtml',
  'notesHtmlString',
  'completed',
  'complete',
  'completedAt',
  'completeDate',
  'completeOn',
  'snoozeUntil',
  'day',
  'date',
  'plannedDate',
  'scheduledDate',
  'dueDate',
  'due',
  'timeEstimate',
  'plannedTime',
  'timeEstimateMinutes',
  'actualTime',
  'actualTimeMinutes',
  'timeTracked',
  'streamIds',
  'streams',
  'channelIds',
  'subtasks',
  'backlog',
  'inBacklog',
  'archived',
  'isArchived',
  'createdAt',
  'createdDate',
  'updatedAt',
  'lastModified',
  'integration',
  'sourceIntegration',
]);

/** Read the first present number from a record, coercing numeric strings. */
function num(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

/** Read the first present non-empty string from a record. */
function firstStr(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = str(record, key);
    if (value !== undefined && value.trim() !== '') return value;
  }
  return null;
}

/** Read the first present boolean from a record. */
function bool(record: Record<string, unknown>, keys: readonly string[]): boolean | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
  }
  return null;
}

/** Read the stream ids and names off whichever shape the payload used. */
function readStreams(record: Record<string, unknown>): {
  ids: string[];
  names: string[];
} {
  const ids: string[] = [];
  const names: string[] = [];
  for (const key of ['streamIds', 'channelIds']) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    for (const entry of value) if (typeof entry === 'string') ids.push(entry);
  }
  const streams = record['streams'];
  if (Array.isArray(streams)) {
    for (const entry of streams) {
      if (typeof entry === 'string') {
        ids.push(entry);
        continue;
      }
      const rec = asRecord(entry);
      const id = firstStr(rec ?? {}, ['id', '_id', 'streamId']);
      const name = firstStr(rec ?? {}, ['name', 'title']);
      if (id !== null) ids.push(id);
      if (name !== null) names.push(name);
    }
  }
  return { ids: [...new Set(ids)], names: [...new Set(names)] };
}

/** Read the subtasks off whichever shape the payload used. */
function readSubtasks(record: Record<string, unknown>): SunsamaSubtask[] {
  const raw = record['subtasks'];
  if (!Array.isArray(raw)) return [];
  const subtasks: SunsamaSubtask[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      subtasks.push({ id: null, title: entry, completed: false });
      continue;
    }
    const rec = asRecord(entry);
    if (rec === undefined) continue;
    const title = firstStr(rec, ['title', 'text', 'name']);
    if (title === null) continue;
    subtasks.push({
      id: firstStr(rec, ['id', '_id']),
      title,
      completed: bool(rec, ['completed', 'complete']) ?? false,
    });
  }
  return subtasks;
}

/**
 * Normalize one raw Sunsama task payload, preserving every field.
 *
 * @remarks
 * Tolerant of key-name variation between server versions (`text` vs `title`, `day` vs
 * `plannedDate`, …) because the migration must not silently lose a field to a rename. Anything the
 * normalizer does not recognise survives on {@link SunsamaTask.unmapped}, which the run report
 * enumerates.
 *
 * @param raw - One task object as returned by a Sunsama MCP tool.
 * @returns the normalized task, or `null` when the payload carries neither an id nor a title.
 */
export function normalizeSunsamaTask(raw: unknown): SunsamaTask | null {
  const record = asRecord(raw);
  if (record === undefined) return null;
  const id = firstStr(record, ['id', '_id', 'taskId']);
  const title = firstStr(record, ['text', 'title', 'name']);
  if (id === null || title === null) return null;

  const streams = readStreams(record);
  const unmapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (CONSUMED_KEYS.has(key)) continue;
    unmapped[key] = value;
  }

  const backlog = bool(record, ['backlog', 'inBacklog']);
  const plannedDate = firstStr(record, ['day', 'plannedDate', 'scheduledDate', 'date']);

  return {
    id,
    title,
    notes: firstStr(record, ['notesMarkdown', 'notes', 'notesHtml', 'notesHtmlString']),
    completed: bool(record, ['completed', 'complete']) ?? false,
    completedAt: firstStr(record, ['completedAt', 'completeDate', 'completeOn']),
    plannedDate,
    dueDate: firstStr(record, ['dueDate', 'due']),
    timeEstimateMinutes: num(record, ['timeEstimate', 'plannedTime', 'timeEstimateMinutes']),
    actualTimeMinutes: num(record, ['actualTime', 'actualTimeMinutes', 'timeTracked']),
    streamIds: streams.ids,
    streamNames: streams.names,
    subtasks: readSubtasks(record),
    // Absent `backlog` flag: an item with no planned day IS the backlog, by Sunsama's own model.
    backlog: backlog ?? plannedDate === null,
    archived: bool(record, ['archived', 'isArchived']) ?? false,
    createdAt: firstStr(record, ['createdAt', 'createdDate']),
    updatedAt: firstStr(record, ['updatedAt', 'lastModified']),
    sourceIntegration: firstStr(record, ['sourceIntegration', 'integration']),
    unmapped,
  };
}

/**
 * Pull the task array out of whatever envelope a Sunsama tool wrapped it in.
 *
 * @remarks
 * MCP tools return text; Sunsama's return JSON in that text, sometimes as a bare array and
 * sometimes as `{ tasks: [...] }` / `{ results: [...] }` with a `hasMore` pagination flag.
 */
export function readSunsamaTaskArray(payload: unknown): { tasks: unknown[]; hasMore: boolean } {
  if (Array.isArray(payload)) return { tasks: payload, hasMore: false };
  const record = asRecord(payload);
  if (record === undefined) return { tasks: [], hasMore: false };
  for (const key of ['tasks', 'results', 'items', 'data']) {
    const value = record[key];
    if (Array.isArray(value)) {
      return { tasks: value, hasMore: record['hasMore'] === true || record['has_more'] === true };
    }
  }
  return { tasks: [], hasMore: false };
}

/** One MCP tool call the reader made, recorded for the run log. */
export interface SunsamaToolInvocation {
  /** The capability the call served. */
  readonly capability: SunsamaCapability;
  /** The tool name actually invoked on the server. */
  readonly tool: string;
  /** The arguments passed. */
  readonly input: Readonly<Record<string, unknown>>;
  /** How many task objects the call yielded (0 for non-task calls). */
  readonly taskCount: number;
  /** Whether the server reported the call as an error. */
  readonly isError: boolean;
}

/** What one Sunsama read produced. */
export interface SunsamaReadResult {
  /** Every active task, de-duplicated by Sunsama id. */
  readonly tasks: readonly SunsamaTask[];
  /** Every archived task read, when the server exposes them (never migrated as active work). */
  readonly archived: readonly SunsamaTask[];
  /** The streams/channels the account defines, when the server exposes them. */
  readonly streams: readonly SunsamaStream[];
  /** Every MCP tool call made, in order — the run log the migration report embeds. */
  readonly invocations: readonly SunsamaToolInvocation[];
  /** Capabilities the server did not advertise (so the report can say what was not read). */
  readonly missingCapabilities: readonly SunsamaCapability[];
}

/** One Sunsama stream (its name for a project/area of work). */
export interface SunsamaStream {
  /** The stream id. */
  readonly id: string;
  /** The stream's display name. */
  readonly name: string;
}

/** Options for {@link readSunsamaAccount}. */
export interface SunsamaReadOptions {
  /**
   * Calendar days to sweep with `listByDay`, as `YYYY-MM-DD`.
   *
   * @remarks
   * Sunsama's day lists are the *scheduled* half of active work; the backlog tool returns the
   * rest. Passing no days reads the backlog only — honest, but partial, and the report says so.
   */
  readonly days?: readonly string[];
  /** Whether to also read archived tasks (reported, never migrated as active work). */
  readonly includeArchived?: boolean;
}

/** Parse one MCP tool result's text content as JSON, tolerating a non-JSON body. */
function parseToolContent(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Read a connected Sunsama account through MCP alone.
 *
 * @remarks
 * The single entry point the migration script uses. It records every tool call it makes so the
 * committed run report can list the exact MCP invocations the data came from — the evidence that
 * no export/scrape path was involved.
 *
 * @param session - An open MCP session against Sunsama's server.
 * @param options - Which days to sweep and whether to read the archive.
 * @throws {Error} When the server advertises no tool for a required capability — an unreadable
 *   account must fail loudly rather than migrate zero tasks and call it a success.
 */
export async function readSunsamaAccount(
  session: RemoteMcpSession,
  options: SunsamaReadOptions = {},
): Promise<SunsamaReadResult> {
  const resolution = resolveSunsamaTools(await session.listTools());
  if (resolution.missingRequired.length > 0) {
    throw new Error(
      `Sunsama MCP server advertises no tool for: ${resolution.missingRequired.join(', ')}`,
    );
  }

  const invocations: SunsamaToolInvocation[] = [];
  const byId = new Map<string, SunsamaTask>();
  const archived = new Map<string, SunsamaTask>();
  const streams: SunsamaStream[] = [];

  /** Call one capability's tool, record the invocation, and return the parsed payload. */
  const call = async (
    capability: SunsamaCapability,
    input: Record<string, unknown>,
  ): Promise<unknown> => {
    const tool = resolution.resolved.get(capability);
    if (tool === undefined) return undefined;
    const result = await session.callTool(tool, input);
    const payload = parseToolContent(result.content);
    const { tasks } = readSunsamaTaskArray(payload);
    invocations.push({
      capability,
      tool,
      input,
      taskCount: tasks.length,
      isError: result.isError,
    });
    if (result.isError) {
      throw new Error(`Sunsama MCP tool ${tool} reported an error`);
    }
    return payload;
  };

  /** Absorb a payload's tasks into the active or archived index. */
  const absorb = (payload: unknown, into: Map<string, SunsamaTask>): void => {
    for (const raw of readSunsamaTaskArray(payload).tasks) {
      const task = normalizeSunsamaTask(raw);
      if (task !== null && !into.has(task.id)) into.set(task.id, task);
    }
  };

  if (resolution.resolved.has('listStreams')) {
    const payload = await call('listStreams', {});
    const raw = Array.isArray(payload) ? payload : (asRecord(payload)?.['streams'] ?? []);
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        const rec = asRecord(entry);
        const id = rec === undefined ? null : firstStr(rec, ['id', '_id', 'streamId']);
        const name = rec === undefined ? null : firstStr(rec, ['name', 'title']);
        if (id !== null && name !== null) streams.push({ id, name });
      }
    }
  }

  absorb(await call('listBacklog', {}), byId);

  for (const day of options.days ?? []) {
    absorb(await call('listByDay', { day }), byId);
  }

  if (options.includeArchived === true && resolution.resolved.has('listArchived')) {
    absorb(await call('listArchived', {}), archived);
  }

  return {
    tasks: [...byId.values()],
    archived: [...archived.values()],
    streams,
    invocations,
    missingCapabilities: resolution.missing,
  };
}
