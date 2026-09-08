import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Capability } from '@docket/identity-access/capabilities';
import { assertDefined } from '@docket/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import type { TurnEvent, TurnInput } from '@docket/athena/turn';

import { getContainer } from '../../src/container';
import { WorkDestinationReviewMcpOut } from '../../src/contracts/work-destination-review';
import type { McpContext } from '../../src/mcp/auth';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { getMigratedDb } from '../support/db';
import { seedStatuses } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
});

interface Seed {
  readonly organizationId: string;
  readonly actorId: string;
  readonly userId: string;
  readonly email: string;
  readonly taskId: string;
}

async function seedWorkspace(capabilities: readonly Capability[] = ['view']): Promise<Seed> {
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

async function seedUnprivilegedPeer(workspace: Seed): Promise<Seed> {
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

async function connect(seed: Seed, scopes = ['agents:run', 'work:read']): Promise<Client> {
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

const request = (seed: Seed, justification: string, challengeAnswer?: string) => ({
  organizationId: seed.organizationId,
  taskId: seed.taskId,
  destination: { origin: 'https://www.instagram.com', path: '/transitcenter' },
  justification,
  ...(challengeAnswer === undefined ? {} : { challengeAnswer }),
});

function asCallToolResult(result: unknown): CallToolResult {
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

function resultPayload(result: unknown): Record<string, unknown> {
  const immediate = asCallToolResult(result);
  const text = (immediate.content[0] as { text: string }).text;
  if (immediate.isError) throw new Error(text);
  return JSON.parse(text) as Record<string, unknown>;
}

function reviewTurn(result: unknown): (input: TurnInput) => AsyncIterable<TurnEvent> {
  return async function* () {
    const message = {
      role: 'assistant' as const,
      content: [
        {
          type: 'tool_use' as const,
          id: 'review_result_1',
          name: 'review_result',
          input: result,
        },
      ],
    };
    yield { type: 'tool_use', id: 'review_result_1', name: 'review_result', input: result };
    yield { type: 'turn_end', stopReason: 'tool_use', message };
  };
}

function thinkingReviewTurn(result: unknown): (input: TurnInput) => AsyncIterable<TurnEvent> {
  return async function* () {
    const message = {
      role: 'assistant' as const,
      content: [
        { type: 'thinking' as const, thinking: 'Checking the task context.', signature: 'sig_1' },
        {
          type: 'tool_use' as const,
          id: 'review_result_1',
          name: 'review_result',
          input: result,
        },
      ],
    };
    yield { type: 'thinking', text: 'Checking the task context.' };
    yield { type: 'tool_use', id: 'review_result_1', name: 'review_result', input: result };
    yield { type: 'turn_end', stopReason: 'tool_use', message };
  };
}

function textTurn(): (input: TurnInput) => AsyncIterable<TurnEvent> {
  return async function* () {
    const message = {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'Grant it.' }],
    };
    yield { type: 'text', text: 'Grant it.' };
    yield { type: 'turn_end', stopReason: 'end_turn', message };
  };
}

function mixedTextReviewTurn(result: unknown): (input: TurnInput) => AsyncIterable<TurnEvent> {
  return async function* () {
    const message = {
      role: 'assistant' as const,
      content: [
        { type: 'text' as const, text: 'This is justified.' },
        {
          type: 'tool_use' as const,
          id: 'review_result_1',
          name: 'review_result',
          input: result,
        },
      ],
    };
    yield { type: 'text', text: 'This is justified.' };
    yield { type: 'tool_use', id: 'review_result_1', name: 'review_result', input: result };
    yield { type: 'turn_end', stopReason: 'tool_use', message };
  };
}

function unrelatedToolReviewTurn(result: unknown): (input: TurnInput) => AsyncIterable<TurnEvent> {
  return async function* () {
    const message = {
      role: 'assistant' as const,
      content: [
        { type: 'tool_use' as const, id: 'other_1', name: 'other_tool', input: {} },
        {
          type: 'tool_use' as const,
          id: 'review_result_1',
          name: 'review_result',
          input: result,
        },
      ],
    };
    yield { type: 'tool_use', id: 'other_1', name: 'other_tool', input: {} };
    yield { type: 'tool_use', id: 'review_result_1', name: 'review_result', input: result };
    yield { type: 'turn_end', stopReason: 'tool_use', message };
  };
}

function terminalTextReviewTurn(result: unknown): (input: TurnInput) => AsyncIterable<TurnEvent> {
  return async function* () {
    const message = {
      role: 'assistant' as const,
      content: [
        { type: 'text' as const, text: 'This should not be present.' },
        {
          type: 'tool_use' as const,
          id: 'review_result_1',
          name: 'review_result',
          input: result,
        },
      ],
    };
    yield { type: 'tool_use', id: 'review_result_1', name: 'review_result', input: result };
    yield { type: 'turn_end', stopReason: 'tool_use', message };
  };
}

function twoReviewTurns(): (input: TurnInput) => AsyncIterable<TurnEvent> {
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

describe('review_work_destination', () => {
  it('requires agents:run before reviewing a destination', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed, ['work:read']);

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will record three TransitCenter posting patterns in the strategy document.',
      ),
    });

    expect(asCallToolResult(result).isError).toBe(true);
    expect((asCallToolResult(result).content[0] as { text: string }).text).toContain('agents:run');
  });

  it('requires work:read inside the reviewer handler', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed, ['agents:run']);

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will record three TransitCenter posting patterns in the strategy document.',
      ),
    });

    expect(asCallToolResult(result).isError).toBe(true);
    expect((asCallToolResult(result).content[0] as { text: string }).text).toContain('work:read');
  });

  it('does not run the model for a task outside the caller workspace', async () => {
    const caller = await seedWorkspace();
    const foreign = await seedWorkspace();
    const client = await connect(caller);
    const stream = vi.spyOn(getContainer().agentTurn, 'streamTurn');

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: {
        ...request(
          caller,
          'I will record three TransitCenter posting patterns in the strategy document.',
        ),
        organizationId: foreign.organizationId,
        taskId: foreign.taskId,
      },
    });

    expect(asCallToolResult(result).isError).toBe(true);
    expect(stream).not.toHaveBeenCalled();
  });

  it('runs Athena for a non-guest who can read a public task without an explicit grant', async () => {
    const workspace = await seedWorkspace();
    const peer = await seedUnprivilegedPeer(workspace);
    const client = await connect(peer);
    const stream = vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      reviewTurn({
        decision: 'deny',
        reason: 'The destination does not support the task.',
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        peer,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(asCallToolResult(result).isError).not.toBe(true);
    expect(resultPayload(result)).toMatchObject({ decision: 'deny' });
    expect(stream).toHaveBeenCalledOnce();
  });

  it('does not run Athena for a same-workspace caller without view access', async () => {
    const workspace = await seedWorkspace();
    const peer = await seedUnprivilegedPeer(workspace);
    await db
      .update(schema.task)
      .set({ visibility: 'private' })
      .where(eq(schema.task.id, workspace.taskId));
    const client = await connect(peer);
    const stream = vi.spyOn(getContainer().agentTurn, 'streamTurn');

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        peer,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(asCallToolResult(result).isError).toBe(true);
    expect(stream).not.toHaveBeenCalled();
  });

  it('advertises decision-specific output variants that reject missing required fields', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    const { tools } = await client.listTools();
    const review = tools.find((tool) => tool.name === 'review_work_destination');

    expect(review?.outputSchema).toMatchObject({
      oneOf: expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            decision: expect.objectContaining({ const: 'grant' }),
          }),
          required: expect.arrayContaining(['decision', 'reason', 'scope']),
          additionalProperties: false,
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            decision: expect.objectContaining({ const: 'challenge' }),
          }),
          required: expect.arrayContaining(['decision', 'reason', 'question']),
          additionalProperties: false,
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            decision: expect.objectContaining({ const: 'deny' }),
          }),
          required: expect.arrayContaining(['decision', 'reason']),
          additionalProperties: false,
        }),
      ]),
    });
  });

  it.each([
    ['grant without scope', { decision: 'grant', reason: 'The task has a named output.' }],
    [
      'challenge without question',
      { decision: 'challenge', reason: 'The task is underspecified.' },
    ],
    [
      'deny with scope',
      {
        decision: 'deny',
        reason: 'The destination does not support the task.',
        scope: { kind: 'origin', value: 'https://www.instagram.com' },
      },
    ],
    [
      'deny with question',
      {
        decision: 'deny',
        reason: 'The destination does not support the task.',
        question: 'What will you produce?',
      },
    ],
  ])('rejects %s through the registered-compatible result schema', (_label, value) => {
    expect(WorkDestinationReviewMcpOut.safeParse(value).success).toBe(false);
  });

  it('returns a bounded grant after Athena calls the one result tool', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      reviewTurn({
        decision: 'grant',
        reason: 'The research has a named output for this task.',
        scope: { kind: 'path_prefix', value: 'https://www.instagram.com/transitcenter' },
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(resultPayload(result)).toEqual({
      decision: 'grant',
      reason: 'The research has a named output for this task.',
      scope: { kind: 'path_prefix', value: 'https://www.instagram.com/transitcenter' },
    });
  });

  it.each([
    ['an equal path', '/transitcenter', '/transitcenter', 'grant'],
    ['an equal path with a trailing slash', '/transitcenter', '/transitcenter/', 'grant'],
    ['a parent prefix', '/transitcenter/posts/weekly', '/transitcenter', 'grant'],
    ['a child prefix', '/transitcenter', '/transitcenter/posts', 'deny'],
    ['a partial path segment', '/transitcenter-archive', '/transitcenter', 'deny'],
  ])(
    'handles %s for destination %s and scope %s',
    async (_case, destinationPath, scopePath, expectedDecision) => {
      const seed = await seedWorkspace();
      const client = await connect(seed);
      vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
        reviewTurn({
          decision: 'grant',
          reason: 'The research has a named output for this task.',
          scope: {
            kind: 'path_prefix',
            value: `https://www.instagram.com${scopePath}`,
          },
        }),
      );

      const result = await client.callTool({
        name: 'review_work_destination',
        arguments: {
          ...request(
            seed,
            'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
          ),
          destination: { origin: 'https://www.instagram.com', path: destinationPath },
        },
      });

      expect(resultPayload(result)).toMatchObject({ decision: expectedDecision });
    },
  );

  it.each([
    ['the requested origin', 'https://www.instagram.com', 'grant'],
    ['another origin', 'https://example.com', 'deny'],
  ])('handles %s with scope %s', async (_case, scopeOrigin, expectedDecision) => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      reviewTurn({
        decision: 'grant',
        reason: 'The research has a named output for this task.',
        scope: { kind: 'origin', value: scopeOrigin },
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(resultPayload(result)).toMatchObject({ decision: expectedDecision });
  });

  it('rejects an unnormalized destination path before Athena runs', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    const stream = vi.spyOn(getContainer().agentTurn, 'streamTurn');

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: {
        ...request(
          seed,
          'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
        ),
        destination: {
          origin: 'https://www.instagram.com',
          path: '/transitcenter/../privacy',
        },
      },
    });

    expect(asCallToolResult(result).isError).toBe(true);
    expect(stream).not.toHaveBeenCalled();
  });

  it('accepts Athena thinking that accompanies the one review result', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      thinkingReviewTurn({
        decision: 'grant',
        reason: 'The research has a named output for this task.',
        scope: { kind: 'path_prefix', value: 'https://www.instagram.com/transitcenter' },
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(resultPayload(result)).toMatchObject({ decision: 'grant' });
  });

  it('denies Athena text that accompanies an otherwise valid review result', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      mixedTextReviewTurn({
        decision: 'grant',
        reason: 'The research has a named output for this task.',
        scope: { kind: 'path_prefix', value: 'https://www.instagram.com/transitcenter' },
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(resultPayload(result)).toMatchObject({ decision: 'deny' });
  });

  it('denies another Athena tool use that accompanies a valid review result', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      unrelatedToolReviewTurn({
        decision: 'grant',
        reason: 'The research has a named output for this task.',
        scope: { kind: 'path_prefix', value: 'https://www.instagram.com/transitcenter' },
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(resultPayload(result)).toMatchObject({ decision: 'deny' });
  });

  it('denies assistant text contained only in Athena’s terminal transcript', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      terminalTextReviewTurn({
        decision: 'grant',
        reason: 'The research has a named output for this task.',
        scope: { kind: 'path_prefix', value: 'https://www.instagram.com/transitcenter' },
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(resultPayload(result)).toMatchObject({ decision: 'deny' });
  });

  it('returns a targeted challenge when more task detail is needed', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      reviewTurn({
        decision: 'challenge',
        reason: 'The intended output is missing.',
        question: 'Which strategy document section will contain the findings?',
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(seed, 'I need Instagram to research transit outreach.'),
    });

    expect(resultPayload(result)).toEqual({
      decision: 'challenge',
      reason: 'The intended output is missing.',
      question: 'Which strategy document section will contain the findings?',
    });
  });

  it('denies when Athena returns a challenge after a challenge answer', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      reviewTurn({
        decision: 'challenge',
        reason: 'Still need more detail.',
        question: 'What else?',
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
        'I will place them under the outreach research heading.',
      ),
    });

    expect(resultPayload(result)).toMatchObject({ decision: 'deny' });
  });

  it('denies malformed or text-only Athena output', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    const stream = vi.spyOn(getContainer().agentTurn, 'streamTurn');
    stream.mockImplementationOnce(textTurn());
    stream.mockImplementationOnce(reviewTurn({ decision: 'grant', reason: 'Missing scope.' }));

    const first = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });
    const second = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(resultPayload(first)).toMatchObject({ decision: 'deny' });
    expect(resultPayload(second)).toMatchObject({ decision: 'deny' });
  });

  it('denies an Athena turn that calls the result tool more than once', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(twoReviewTurns());

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(resultPayload(result)).toMatchObject({ decision: 'deny' });
  });

  it('denies a model turn that times out', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(async function* () {
      await new Promise<void>(() => undefined);
      yield* [] as TurnEvent[];
    });
    vi.useFakeTimers();

    const pending = client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });
    await vi.advanceTimersByTimeAsync(15_000);

    expect(resultPayload(await pending)).toMatchObject({ decision: 'deny' });
  });

  it('denies a vague Instagram request even when Athena proposes a grant', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      reviewTurn({
        decision: 'grant',
        reason: 'Social media research.',
        scope: { kind: 'origin', value: 'https://www.instagram.com' },
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(seed, 'I need Instagram for social media.'),
    });

    expect(resultPayload(result)).toMatchObject({ decision: 'deny' });
  });

  it('allows the concrete Instagram research request to receive a bounded grant', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      reviewTurn({
        decision: 'grant',
        reason: 'The task names a source, action, output, and destination for the findings.',
        scope: { kind: 'path_prefix', value: 'https://www.instagram.com/transitcenter' },
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(resultPayload(result)).toMatchObject({ decision: 'grant' });
  });
});
