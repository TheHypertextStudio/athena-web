/**
 * `@docket/integrations` — a metadata-complete offline Sunsama MCP server.
 *
 * @remarks
 * The Sunsama migration cannot be run live without a one-time interactive OAuth authorization
 * against `https://api.sunsama.com/mcp`, so every part of it that is *not* the OAuth handshake is
 * proven against this fixture server instead. It is not a toy: each task carries the full field
 * set Sunsama's MCP server returns (notes, subtasks with their own completion, planned day, due
 * date, planned vs actual time, streams, completion timestamp, backlog flag, creation/modification
 * timestamps, integration provenance) plus a field the normalizer deliberately does not consume,
 * so the "nothing is silently dropped" guarantee has something to catch.
 *
 * The existing minimal `SUNSAMA_FIXTURE_SERVER` in `./mcp-connector` stays exactly as it is — it
 * backs the generic remote-MCP tests. This one is the migration's fixture, registered by host so a
 * caller opts into it explicitly.
 */
import type { FixtureMcpServer, RemoteToolResult } from './mcp-connector';

/** The host {@link SUNSAMA_MIGRATION_FIXTURE_SERVER} is registered under in the mock connector. */
export const SUNSAMA_FIXTURE_HOST = 'sunsama.fixture.localhost';

/** The endpoint URL that reaches {@link SUNSAMA_MIGRATION_FIXTURE_SERVER}. */
export const SUNSAMA_FIXTURE_URL = `https://${SUNSAMA_FIXTURE_HOST}/mcp`;

/** The streams (Sunsama's channels) the fixture account defines. */
export const SUNSAMA_FIXTURE_STREAMS: readonly { id: string; name: string }[] = [
  { id: 'str-transit', name: 'Las Vegans for Better Transit' },
  { id: 'str-newsletter', name: 'Weekly newsletter' },
  { id: 'str-personal', name: 'Personal' },
  { id: 'str-docket', name: 'Docket' },
];

/**
 * The fixture account's active work: three backlog items and three planned ones.
 *
 * @remarks
 * Written in Sunsama's own payload shape (`text` rather than `title`, `day` for the planned date,
 * `timeEstimate`/`actualTime` in minutes) so the normalizer is exercised against the real key
 * names rather than against Docket's. `recurringDefinitionId` on `su-006` is the deliberate
 * unmapped field.
 */
export const SUNSAMA_FIXTURE_TASKS: readonly Record<string, unknown>[] = [
  {
    _id: 'su-001',
    text: 'Send the contractor agreement',
    notes: 'Legal wants it this week. Attach the signed W-9.',
    completed: false,
    day: null,
    backlog: true,
    dueDate: '2026-08-08',
    timeEstimate: 45,
    actualTime: 0,
    streamIds: ['str-transit'],
    subtasks: [
      { id: 'sub-001a', title: 'Attach the W-9', completed: true },
      { id: 'sub-001b', title: 'Send for signature', completed: false },
    ],
    createdAt: '2026-07-02T15:04:00.000Z',
    updatedAt: '2026-07-30T09:12:00.000Z',
  },
  {
    _id: 'su-002',
    text: 'Book the venue for the offsite',
    notes: 'Compare the two quotes before deciding.',
    completed: false,
    day: null,
    backlog: true,
    timeEstimate: 30,
    streamIds: ['str-transit'],
    subtasks: [],
    createdAt: '2026-07-10T18:00:00.000Z',
    updatedAt: '2026-07-28T11:00:00.000Z',
  },
  {
    _id: 'su-003',
    text: 'Import the old Substack archive',
    notes: '',
    completed: false,
    day: null,
    backlog: true,
    streamIds: ['str-newsletter'],
    subtasks: [],
    createdAt: '2026-06-20T12:00:00.000Z',
    updatedAt: '2026-07-01T12:00:00.000Z',
  },
  {
    _id: 'su-004',
    text: 'Draft the RTC public-comment letter',
    notes: 'Cite the September ridership figures.',
    completed: false,
    day: '2026-08-03',
    backlog: false,
    dueDate: '2026-08-05',
    timeEstimate: 90,
    actualTime: 25,
    streamIds: ['str-transit'],
    subtasks: [{ id: 'sub-004a', title: 'Pull the ridership numbers', completed: false }],
    createdAt: '2026-07-25T08:00:00.000Z',
    updatedAt: '2026-08-01T17:45:00.000Z',
  },
  {
    _id: 'su-005',
    text: 'Ship the Notion connector',
    notes: 'Two-way, Docket wins conflicts.',
    completed: false,
    day: '2026-08-04',
    backlog: false,
    timeEstimate: 240,
    actualTime: 120,
    streamIds: ['str-docket'],
    subtasks: [],
    createdAt: '2026-07-28T09:00:00.000Z',
    updatedAt: '2026-08-02T07:30:00.000Z',
    integration: 'github:hypertext-studio/athena-web#412',
  },
  {
    _id: 'su-006',
    text: 'Weekly newsletter — Monday send',
    notes: 'Recurring: every Monday 9am.',
    completed: false,
    day: '2026-08-03',
    backlog: false,
    timeEstimate: 60,
    streamIds: ['str-newsletter'],
    subtasks: [],
    createdAt: '2026-05-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    // Deliberately unrecognised by the normalizer: Docket has no recurrence model for tasks, so
    // this must surface in the report's unmapped list rather than disappear.
    recurringDefinitionId: 'rec-newsletter-monday',
  },
  {
    // No stream at all — the one task the routing declaration must account for as a fallback.
    _id: 'su-007',
    text: 'Renew the PO box',
    notes: null,
    completed: false,
    day: null,
    backlog: true,
    streamIds: [],
    subtasks: [],
    createdAt: '2026-07-19T14:00:00.000Z',
    updatedAt: '2026-07-19T14:00:00.000Z',
  },
];

/** The fixture account's archived work — read for the report, never migrated as active. */
export const SUNSAMA_FIXTURE_ARCHIVED: readonly Record<string, unknown>[] = [
  {
    _id: 'su-900',
    text: 'File the Q2 sales tax return',
    completed: true,
    completedAt: '2026-07-15T22:10:00.000Z',
    day: '2026-07-15',
    backlog: false,
    archived: true,
    actualTime: 35,
    streamIds: ['str-transit'],
    subtasks: [],
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-15T22:10:00.000Z',
  },
];

/** Serialize a JSON payload as an MCP text result. */
function ok(payload: unknown): RemoteToolResult {
  return { content: JSON.stringify(payload), isError: false };
}

/**
 * A deterministic offline stand-in for Sunsama's remote MCP server.
 *
 * @remarks
 * Advertises the tools under Sunsama's own announced snake_case names (`get_backlog_tasks`,
 * `get_tasks_by_day`, `get_archived_tasks`, `get_task_by_id`, `get_streams`, `get_user`) so the
 * alias resolution is exercised against a real naming convention rather than one invented to
 * match the code.
 */
export const SUNSAMA_MIGRATION_FIXTURE_SERVER: FixtureMcpServer = {
  serverInfo: { name: 'Sunsama', title: 'Sunsama (fixture)' },
  tools: [
    {
      name: 'get_user',
      description: 'Get the connected Sunsama user profile, timezone, and group.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
    },
    {
      name: 'get_streams',
      description: 'List the streams (channels) the account organizes work into.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
    },
    {
      name: 'get_backlog_tasks',
      description: 'List the backlog tasks of the connected Sunsama account.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
    },
    {
      name: 'get_tasks_by_day',
      description: 'List the tasks planned for one day.',
      inputSchema: {
        type: 'object',
        properties: { day: { type: 'string' } },
        required: ['day'],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: 'get_archived_tasks',
      description: 'List archived tasks.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
    },
    {
      name: 'get_task_by_id',
      description: 'Fetch one Sunsama task by id.',
      inputSchema: {
        type: 'object',
        properties: { taskId: { type: 'string' } },
        required: ['taskId'],
      },
      annotations: { readOnlyHint: true },
    },
  ],
  call(name, input) {
    switch (name) {
      case 'get_user':
        return ok({
          id: 'usr-fixture',
          email: 'willie@lasvegasfortransit.org',
          timezone: 'America/Los_Angeles',
        });
      case 'get_streams':
        return ok({ streams: SUNSAMA_FIXTURE_STREAMS });
      case 'get_backlog_tasks':
        return ok({ tasks: SUNSAMA_FIXTURE_TASKS.filter((t) => t['backlog'] === true) });
      case 'get_tasks_by_day': {
        const day =
          input && typeof input === 'object' && 'day' in input
            ? String((input as Record<string, unknown>)['day'])
            : '';
        return ok({ tasks: SUNSAMA_FIXTURE_TASKS.filter((t) => t['day'] === day) });
      }
      case 'get_archived_tasks':
        return ok({ tasks: SUNSAMA_FIXTURE_ARCHIVED, hasMore: false });
      case 'get_task_by_id': {
        const id =
          input && typeof input === 'object' && 'taskId' in input
            ? String((input as Record<string, unknown>)['taskId'])
            : '';
        const task = [...SUNSAMA_FIXTURE_TASKS, ...SUNSAMA_FIXTURE_ARCHIVED].find(
          (t) => t['_id'] === id,
        );
        return task ? ok(task) : { content: `Task not found: ${id}`, isError: true };
      }
      default:
        return { content: `Unknown tool: ${name}`, isError: true };
    }
  },
};

/** The days the fixture account has planned work on — what a full read must sweep. */
export const SUNSAMA_FIXTURE_DAYS: readonly string[] = ['2026-08-03', '2026-08-04'];
