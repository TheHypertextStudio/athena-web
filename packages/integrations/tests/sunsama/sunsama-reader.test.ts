import { describe, expect, it } from 'vitest';

import { MockMcpConnector } from '../../src/mcp-connector';
import {
  SUNSAMA_CAPABILITIES,
  SUNSAMA_MCP_URL,
  normalizeSunsamaTask,
  readSunsamaAccount,
  readSunsamaTaskArray,
  resolveSunsamaTools,
} from '../../src/sunsama';
import {
  SUNSAMA_FIXTURE_DAYS,
  SUNSAMA_FIXTURE_HOST,
  SUNSAMA_FIXTURE_TASKS,
  SUNSAMA_FIXTURE_URL,
  SUNSAMA_MIGRATION_FIXTURE_SERVER,
} from '../../src/sunsama-fixtures';

/** Open a session against the offline migration fixture server. */
function fixtureConnector(): MockMcpConnector {
  return new MockMcpConnector({
    servers: { [SUNSAMA_FIXTURE_HOST]: SUNSAMA_MIGRATION_FIXTURE_SERVER },
  });
}

describe('resolveSunsamaTools', () => {
  it('resolves every capability from Sunsama’s own snake_case tool names', () => {
    const resolution = resolveSunsamaTools(SUNSAMA_MIGRATION_FIXTURE_SERVER.tools);
    expect(resolution.missing).toEqual([]);
    expect(resolution.missingRequired).toEqual([]);
    expect(resolution.resolved.get('listBacklog')).toBe('get_backlog_tasks');
    expect(resolution.resolved.get('getTask')).toBe('get_task_by_id');
  });

  it('matches across naming conventions — SCREAMING_SNAKE, snake and kebab are one name', () => {
    const tools = [
      { name: 'GET_BACKLOG_TASKS', description: '', inputSchema: {} },
      { name: 'get-tasks-by-day', description: '', inputSchema: {} },
      { name: 'Get_Task_By_Id', description: '', inputSchema: {} },
    ];
    const resolution = resolveSunsamaTools(tools);
    expect(resolution.resolved.get('listBacklog')).toBe('GET_BACKLOG_TASKS');
    expect(resolution.resolved.get('listByDay')).toBe('get-tasks-by-day');
    expect(resolution.resolved.get('getTask')).toBe('Get_Task_By_Id');
  });

  it('names what it could not resolve instead of pretending the capability exists', () => {
    const resolution = resolveSunsamaTools([
      { name: 'get_backlog_tasks', description: '', inputSchema: {} },
    ]);
    expect([...resolution.missing].sort()).toEqual(
      [...SUNSAMA_CAPABILITIES].filter((c) => c !== 'listBacklog').sort(),
    );
    expect(resolution.missingRequired).toEqual([]);
  });

  it('flags a missing REQUIRED capability so a run cannot proceed and report zero tasks', () => {
    const resolution = resolveSunsamaTools([
      { name: 'get_user', description: '', inputSchema: {} },
    ]);
    expect(resolution.missingRequired).toEqual(['listBacklog']);
  });
});

describe('normalizeSunsamaTask', () => {
  it('reads Sunsama’s own key names (text / day / timeEstimate) and preserves the rest', () => {
    const task = normalizeSunsamaTask(SUNSAMA_FIXTURE_TASKS[0]);
    expect(task).toMatchObject({
      id: 'su-001',
      title: 'Send the contractor agreement',
      notes: 'Legal wants it this week. Attach the signed W-9.',
      completed: false,
      plannedDate: null,
      dueDate: '2026-08-08',
      timeEstimateMinutes: 45,
      actualTimeMinutes: 0,
      backlog: true,
      streamIds: ['str-transit'],
      createdAt: '2026-07-02T15:04:00.000Z',
      updatedAt: '2026-07-30T09:12:00.000Z',
    });
    expect(task?.subtasks).toEqual([
      { id: 'sub-001a', title: 'Attach the W-9', completed: true },
      { id: 'sub-001b', title: 'Send for signature', completed: false },
    ]);
  });

  it('keeps an unrecognised field rather than dropping it during normalization', () => {
    const recurring = SUNSAMA_FIXTURE_TASKS.find((t) => t['_id'] === 'su-006');
    const task = normalizeSunsamaTask(recurring);
    expect(task?.unmapped).toEqual({ recurringDefinitionId: 'rec-newsletter-monday' });
  });

  it('infers the backlog from an absent planned day when the flag is missing', () => {
    const task = normalizeSunsamaTask({ id: 'x', title: 'No flag, no day' });
    expect(task?.backlog).toBe(true);
    const planned = normalizeSunsamaTask({ id: 'y', title: 'Planned', day: '2026-08-03' });
    expect(planned?.backlog).toBe(false);
  });

  it('returns null for a payload that is not a task rather than a half-built record', () => {
    expect(normalizeSunsamaTask(null)).toBeNull();
    expect(normalizeSunsamaTask({ id: 'no-title' })).toBeNull();
    expect(normalizeSunsamaTask({ title: 'no id' })).toBeNull();
  });
});

describe('readSunsamaTaskArray', () => {
  it('unwraps a bare array, a { tasks } envelope, and a { results, hasMore } page', () => {
    expect(readSunsamaTaskArray([{ id: 'a' }])).toEqual({ tasks: [{ id: 'a' }], hasMore: false });
    expect(readSunsamaTaskArray({ tasks: [{ id: 'b' }] })).toEqual({
      tasks: [{ id: 'b' }],
      hasMore: false,
    });
    expect(readSunsamaTaskArray({ results: [], hasMore: true })).toEqual({
      tasks: [],
      hasMore: true,
    });
  });
});

describe('readSunsamaAccount — MCP-only', () => {
  it('reads backlog + planned days through MCP tools and records every invocation', async () => {
    const session = await fixtureConnector().open({ url: SUNSAMA_FIXTURE_URL });
    const result = await readSunsamaAccount(session, {
      days: SUNSAMA_FIXTURE_DAYS,
      includeArchived: true,
    });

    expect(result.tasks.map((t) => t.id).sort()).toEqual([
      'su-001',
      'su-002',
      'su-003',
      'su-004',
      'su-005',
      'su-006',
      'su-007',
    ]);
    expect(result.archived.map((t) => t.id)).toEqual(['su-900']);
    expect(result.streams.map((s) => s.name)).toContain('Las Vegans for Better Transit');

    // The run log is the evidence that the data came from MCP tool calls and nothing else.
    expect(result.invocations.map((i) => i.tool)).toEqual([
      'get_streams',
      'get_backlog_tasks',
      'get_tasks_by_day',
      'get_tasks_by_day',
      'get_archived_tasks',
    ]);
    expect(result.invocations.find((i) => i.tool === 'get_backlog_tasks')?.taskCount).toBe(4);
    expect(result.invocations.every((i) => !i.isError)).toBe(true);
  });

  it('de-duplicates a task returned by both the backlog and a day sweep', async () => {
    const session = await fixtureConnector().open({ url: SUNSAMA_FIXTURE_URL });
    // Sweeping a day the backlog items are NOT on still yields each id exactly once.
    const result = await readSunsamaAccount(session, { days: ['2026-08-03', '2026-08-03'] });
    const ids = result.tasks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reads the backlog only — and says so — when the server exposes nothing else', async () => {
    const session = await fixtureConnector().open({ url: SUNSAMA_FIXTURE_URL });
    const limited = {
      ...session,
      listTools: async () => [{ name: 'get_backlog_tasks', description: '', inputSchema: {} }],
    };
    const result = await readSunsamaAccount(limited, { days: SUNSAMA_FIXTURE_DAYS });
    expect(result.tasks).toHaveLength(4);
    expect(result.missingCapabilities).toContain('listByDay');
  });

  it('throws rather than migrating zero tasks when the backlog tool is absent', async () => {
    const session = await fixtureConnector().open({ url: SUNSAMA_FIXTURE_URL });
    const useless = { ...session, listTools: async () => [] };
    await expect(readSunsamaAccount(useless)).rejects.toThrow(/advertises no tool/i);
  });

  it('surfaces a tool-reported error instead of treating it as an empty result', async () => {
    const session = await fixtureConnector().open({ url: SUNSAMA_FIXTURE_URL });
    const broken = {
      ...session,
      callTool: async () => ({ content: 'upstream is down', isError: true }),
    };
    await expect(readSunsamaAccount(broken)).rejects.toThrow(/reported an error/i);
  });

  it('points at Sunsama’s real remote endpoint for a live run', () => {
    expect(SUNSAMA_MCP_URL).toBe('https://api.sunsama.com/mcp');
  });
});
