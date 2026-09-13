import type { TurnEvent, TurnInput } from '@docket/athena/turn';
import type * as DbModule from '@docket/db';
import type { Capability } from '@docket/identity-access/capabilities';
import { assertDefined } from '@docket/test-utils';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeAll, vi } from 'vitest';

import type { McpContext } from '../../src/mcp/auth';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { getMigratedDb } from '../support/db';
import { seedStatuses } from '../support/routes-harness';

export let schema!: typeof DbModule;
export let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
});

export interface DestinationReviewSeed {
  readonly organizationId: string;
  readonly actorId: string;
  readonly userId: string;
  readonly email: string;
  readonly taskId: string;
}

export async function seedWorkspace(
  capabilities: readonly Capability[] = ['view'],
): Promise<DestinationReviewSeed> {
  const slug = `destination-review-${Math.random().toString(36).slice(2, 10)}`;
  const [organization] = await db
    .insert(schema.organization)
    .values({ name: 'LVBT', slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const organizationId = assertDefined(organization).id;
  const statusId = await seedStatuses(db, schema, organizationId);
  const [role] = await db
    .insert(schema.role)
    .values({ organizationId, key: 'reviewer', name: 'Reviewer', capabilities: [...capabilities] })
    .returning({ id: schema.role.id });
  const roleId = assertDefined(role).id;
  const email = `${slug}@example.com`;
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email })
    .returning({ id: schema.user.id });
  const userId = assertDefined(user).id;
  const [actor] = await db
    .insert(schema.actor)
    .values({ organizationId, kind: 'human', displayName: 'Ada', userId, roleId })
    .returning({ id: schema.actor.id });
  const actorId = assertDefined(actor).id;
  await db.insert(schema.hub).values({ userId });
  await db.insert(schema.grant).values({
    organizationId,
    subjectKind: 'role',
    subjectId: roleId,
    resourceKind: 'organization',
    resourceId: organizationId,
    capabilities: [...capabilities],
    effect: 'allow',
  });
  const [team] = await db
    .insert(schema.team)
    .values({ organizationId, name: 'Strategy', key: `S${slug.slice(-5)}` })
    .returning({ id: schema.team.id });
  const [task] = await db
    .insert(schema.task)
    .values({
      organizationId,
      teamId: assertDefined(team).id,
      title: 'Write the LVBT social strategy',
      description: 'Record research findings in the LVBT strategy document.',
      state: 'todo',
      statusId: statusId('task', 'todo'),
      createdBy: actorId,
    })
    .returning({ id: schema.task.id });
  return { organizationId, actorId, userId, email, taskId: assertDefined(task).id };
}

export async function seedUnprivilegedPeer(
  workspace: DestinationReviewSeed,
): Promise<DestinationReviewSeed> {
  const slug = `destination-review-peer-${Math.random().toString(36).slice(2, 10)}`;
  const [role] = await db
    .insert(schema.role)
    .values({
      organizationId: workspace.organizationId,
      key: slug,
      name: 'Observer',
      capabilities: [],
    })
    .returning({ id: schema.role.id });
  const email = `${slug}@example.com`;
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Bea', email })
    .returning({ id: schema.user.id });
  const userId = assertDefined(user).id;
  const [actor] = await db
    .insert(schema.actor)
    .values({
      organizationId: workspace.organizationId,
      kind: 'human',
      displayName: 'Bea',
      userId,
      roleId: assertDefined(role).id,
    })
    .returning({ id: schema.actor.id });
  await db.insert(schema.hub).values({ userId });
  return {
    organizationId: workspace.organizationId,
    actorId: assertDefined(actor).id,
    userId,
    email,
    taskId: workspace.taskId,
  };
}

const connections: { close(): Promise<void> }[] = [];

export async function connect(
  seed: DestinationReviewSeed,
  scopes = ['agents:run', 'work:read'],
): Promise<Client> {
  const ctx: McpContext = {
    principal: { kind: 'user', userId: seed.userId, userName: 'Ada', userEmail: seed.email },
    scopes,
  };
  const server = new McpServer(
    { name: 'work-destination-review-test', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
  registerTools(server, ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  connections.push({
    close: async () => {
      await client.close();
      await server.close();
    },
  });
  return client;
}

export const request = (
  seed: DestinationReviewSeed,
  justification: string,
  challengeAnswer?: string,
) => ({
  organizationId: seed.organizationId,
  taskId: seed.taskId,
  destination: { origin: 'https://www.instagram.com', path: '/transitcenter' },
  justification,
  ...(challengeAnswer === undefined ? {} : { challengeAnswer }),
});

export function asCallToolResult(result: unknown): CallToolResult {
  if (
    typeof result !== 'object' ||
    result === null ||
    !('content' in result) ||
    !Array.isArray(result.content)
  ) {
    throw new Error('Expected an immediate MCP tool result.');
  }
  return result as CallToolResult;
}

export function resultPayload(result: unknown): Record<string, unknown> {
  const immediate = asCallToolResult(result);
  const text = (immediate.content[0] as { text: string }).text;
  if (immediate.isError) throw new Error(text);
  return JSON.parse(text) as Record<string, unknown>;
}

export function reviewTurn(result: unknown): (input: TurnInput) => AsyncIterable<TurnEvent> {
  return async function* () {
    const message = {
      role: 'assistant' as const,
      content: [
        { type: 'tool_use' as const, id: 'review_result_1', name: 'review_result', input: result },
      ],
    };
    yield { type: 'tool_use', id: 'review_result_1', name: 'review_result', input: result };
    yield { type: 'turn_end', stopReason: 'tool_use', message };
  };
}

export function thinkingReviewTurn(
  result: unknown,
): (input: TurnInput) => AsyncIterable<TurnEvent> {
  return async function* () {
    const message = {
      role: 'assistant' as const,
      content: [
        { type: 'thinking' as const, thinking: 'Checking the task context.', signature: 'sig_1' },
        { type: 'tool_use' as const, id: 'review_result_1', name: 'review_result', input: result },
      ],
    };
    yield { type: 'thinking', text: 'Checking the task context.' };
    yield { type: 'tool_use', id: 'review_result_1', name: 'review_result', input: result };
    yield { type: 'turn_end', stopReason: 'tool_use', message };
  };
}

export function textTurn(): (input: TurnInput) => AsyncIterable<TurnEvent> {
  return async function* () {
    const message = {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'Grant it.' }],
    };
    yield { type: 'text', text: 'Grant it.' };
    yield { type: 'turn_end', stopReason: 'end_turn', message };
  };
}

export function mixedTextReviewTurn(
  result: unknown,
): (input: TurnInput) => AsyncIterable<TurnEvent> {
  return async function* () {
    const message = {
      role: 'assistant' as const,
      content: [
        { type: 'text' as const, text: 'This is justified.' },
        { type: 'tool_use' as const, id: 'review_result_1', name: 'review_result', input: result },
      ],
    };
    yield { type: 'text', text: 'This is justified.' };
    yield { type: 'tool_use', id: 'review_result_1', name: 'review_result', input: result };
    yield { type: 'turn_end', stopReason: 'tool_use', message };
  };
}

export function unrelatedToolReviewTurn(
  result: unknown,
): (input: TurnInput) => AsyncIterable<TurnEvent> {
  return async function* () {
    const message = {
      role: 'assistant' as const,
      content: [
        { type: 'tool_use' as const, id: 'other_1', name: 'other_tool', input: {} },
        { type: 'tool_use' as const, id: 'review_result_1', name: 'review_result', input: result },
      ],
    };
    yield { type: 'tool_use', id: 'other_1', name: 'other_tool', input: {} };
    yield { type: 'tool_use', id: 'review_result_1', name: 'review_result', input: result };
    yield { type: 'turn_end', stopReason: 'tool_use', message };
  };
}

export function terminalTextReviewTurn(
  result: unknown,
): (input: TurnInput) => AsyncIterable<TurnEvent> {
  return async function* () {
    const message = {
      role: 'assistant' as const,
      content: [
        { type: 'text' as const, text: 'This should not be present.' },
        { type: 'tool_use' as const, id: 'review_result_1', name: 'review_result', input: result },
      ],
    };
    yield { type: 'tool_use', id: 'review_result_1', name: 'review_result', input: result };
    yield { type: 'turn_end', stopReason: 'tool_use', message };
  };
}

export function twoReviewTurns(): (input: TurnInput) => AsyncIterable<TurnEvent> {
  return async function* () {
    const first = { decision: 'deny', reason: 'First result.' };
    const second = { decision: 'deny', reason: 'Second result.' };
    const message = {
      role: 'assistant' as const,
      content: [
        { type: 'tool_use' as const, id: 'review_result_1', name: 'review_result', input: first },
        { type: 'tool_use' as const, id: 'review_result_2', name: 'review_result', input: second },
      ],
    };
    yield { type: 'tool_use', id: 'review_result_1', name: 'review_result', input: first };
    yield { type: 'tool_use', id: 'review_result_2', name: 'review_result', input: second };
    yield { type: 'turn_end', stopReason: 'tool_use', message };
  };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  while (connections.length > 0) await assertDefined(connections.pop()).close();
});
