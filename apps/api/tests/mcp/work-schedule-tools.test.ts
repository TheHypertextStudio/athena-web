/** Protocol tests isolate services and never migrate or write the shared development database. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../src/error';
import { registerWorkScheduleTools } from '../../src/mcp/work-schedule-tools';
import type { McpContext } from '../../src/mcp/auth';

const services = vi.hoisted(() => ({
  resolveActor: vi.fn(),
  canActor: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  load: vi.fn(),
  history: vi.fn(),
  create: vi.fn(),
  revise: vi.fn(),
  transition: vi.fn(),
  run: vi.fn(),
  retry: vi.fn(),
}));
vi.mock('../../src/mcp/auth', () => ({ resolveActor: services.resolveActor }));
vi.mock('@docket/authz', () => ({ canActor: services.canActor }));
vi.mock('../../src/lib/recurrence/schedule-reads', () => ({
  listWorkSchedules: services.list,
  loadWorkScheduleDetail: services.detail,
  loadWorkSchedule: services.load,
}));
vi.mock('../../src/lib/recurrence/schedule-authoring', () => ({
  createWorkSchedule: services.create,
  reviseWorkSchedule: services.revise,
}));
vi.mock('../../src/lib/recurrence/schedule-history', () => ({
  listWorkScheduleRuns: services.history,
}));
vi.mock('../../src/lib/recurrence/schedule-lifecycle', () => ({
  transitionWorkSchedule: services.transition,
}));
vi.mock('../../src/lib/recurrence/schedule-run-commands', () => ({
  runWorkSchedule: services.run,
  retryWorkSchedule: services.retry,
}));

const id = '01M50P7S91S499N4C4GWHC99FC';
const actorId = '01M50P937J1KYJA8AQRAP69B4V';
const identity = { organizationId: id, actorId, seriesId: id };
const run = {
  id,
  seriesId: id,
  scheduledFor: '2026-10-15',
  originalScheduledFor: null,
  status: 'failed',
  attempt: 1,
  failureCode: 'creation_failed',
  failedAt: null,
  retryAvailableAt: null,
  completedAt: null,
  canRetry: true,
  roots: [],
  templates: [],
};
let client: Client;
let server: McpServer;

async function connect(scopes: readonly string[] = ['work:read', 'work:write']): Promise<void> {
  const ctx: McpContext = {
    principal: { kind: 'user', userId: 'user', userName: 'Ada', userEmail: 'ada@example.test' },
    scopes,
  };
  server = new McpServer({ name: 'schedule-test', version: '1' }, { capabilities: { tools: {} } });
  registerWorkScheduleTools(server, ctx);
  client = new Client({ name: 'schedule-client', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
}
beforeEach(() => {
  vi.resetAllMocks();
  services.resolveActor.mockResolvedValue({ orgId: id, actorId });
  services.canActor.mockResolvedValue({ allow: true });
  services.list.mockResolvedValue({ items: [] });
  services.history.mockResolvedValue({ items: [run] });
  services.run.mockResolvedValue(run);
  services.retry.mockResolvedValue(run);
});
afterEach(async () => {
  await client.close();
  await server.close();
});

describe('canonical schedule MCP adapters', () => {
  it('uses current actor and bounded canonical discovery/history', async () => {
    await connect();
    const listed = await client.callTool({
      name: 'list_work_schedules',
      arguments: { orgId: id, query: { action: 'list', ownerProgramId: id } },
    });
    expect(listed.isError, JSON.stringify(listed)).not.toBe(true);
    expect(services.list).toHaveBeenCalledWith(expect.anything(), {
      organizationId: id,
      actorId,
      ownerProgramId: id,
      limit: 50,
    });
    await client.callTool({
      name: 'list_work_schedules',
      arguments: {
        orgId: id,
        query: { action: 'history', scheduleId: id, limit: 7, cursor: 'opaque' },
      },
    });
    expect(services.history).toHaveBeenCalledWith(expect.anything(), identity, {
      limit: 7,
      cursor: 'opaque',
    });
    expect(services.resolveActor).toHaveBeenCalledTimes(2);
  });
  it('dispatches run and retry through the same checked public service as REST', async () => {
    await connect();
    const result = await client.callTool({
      name: 'manage_work_schedule',
      arguments: {
        orgId: id,
        command: { action: 'run', scheduleId: id, run: { scheduledFor: '2026-10-15' } },
      },
    });
    expect(result.structuredContent, JSON.stringify(result)).toMatchObject({
      data: { result: 'run', run: { failureCode: 'creation_failed' } },
    });
    expect(services.run).toHaveBeenCalledWith(expect.anything(), identity, {
      scheduledFor: '2026-10-15',
    });
    await client.callTool({
      name: 'manage_work_schedule',
      arguments: { orgId: id, command: { action: 'retry', scheduleId: id, occurrenceId: id } },
    });
    expect(services.retry).toHaveBeenCalledWith(expect.anything(), identity, id);
  });
  it('denies writes before identity or services for a read-only token', async () => {
    await connect(['work:read']);
    const result = await client.callTool({
      name: 'manage_work_schedule',
      arguments: { orgId: id, command: { action: 'pause', scheduleId: id } },
    });
    expect(result.isError).toBe(true);
    expect(services.resolveActor).not.toHaveBeenCalled();
    expect(services.transition).not.toHaveBeenCalled();
  });
  it('hides revoked private schedules without disclosing provider exception text', async () => {
    await connect();
    services.history.mockRejectedValue(new NotFoundError('private provider token'));
    const result = await client.callTool({
      name: 'list_work_schedules',
      arguments: { orgId: id, query: { action: 'history', scheduleId: id } },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private provider token');
  });
});
