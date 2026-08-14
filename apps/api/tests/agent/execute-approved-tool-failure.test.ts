/**
 * `@docket/api` — the genuine-failure surfaces of `executeApprovedActions` /
 * `executeApprovedGeneration` in `src/agent/loop.ts`: a claimed tool call whose execution
 * actually throws (not merely returns an error result), and a toolbox that fails to open at all.
 *
 * @remarks
 * Neither scenario is reachable through Docket's own real MCP tools — an unknown tool name or a
 * validation failure returns a `CallToolResult` with `isError: true` rather than throwing (see
 * `toolbox.ts`'s own remark on this). Reproducing an actual thrown exception from tool dispatch
 * therefore requires replacing `openToolbox` at the module boundary, exactly the seam the loop
 * already isolates it behind.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn(async () => null);
vi.mock('@docket/auth', () => ({ auth: { api: { getSession } } }));

import type * as DbModule from '@docket/db';

import type {
  approveAndResume as ApproveAndResume,
  executeApprovedActions as ExecuteApprovedActions,
} from '../../src/agent/loop';
import type { claimRunGeneration as ClaimRunGeneration } from '../../src/agent/run-generation';
import type * as ToolboxModule from '../../src/agent/toolbox';
import type { ensureDefaultAgent as EnsureDefaultAgent } from '../../src/lib/default-agent';
import { getMigratedDb } from '../support/db';
import { assertDefined } from '@docket/test-utils';

const openToolbox = vi.fn();
vi.mock('../../src/agent/toolbox', async (importOriginal) => ({
  ...(await importOriginal<typeof ToolboxModule>()),
  openToolbox,
}));

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let executeApprovedActions!: typeof ExecuteApprovedActions;
let approveAndResume!: typeof ApproveAndResume;
let claimRunGeneration!: typeof ClaimRunGeneration;
let ensureDefaultAgent!: typeof EnsureDefaultAgent;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  ({ executeApprovedActions, approveAndResume } = await import('../../src/agent/loop'));
  ({ claimRunGeneration } = await import('../../src/agent/run-generation'));
  ({ ensureDefaultAgent } = await import('../../src/lib/default-agent'));
});

interface Seed {
  readonly orgId: string;
  readonly humanActorId: string;
  readonly agentId: string;
  readonly sessionId: string;
}

/** Seed a registered-agent session in the given status, with no transcript. */
async function seedSession(status: 'awaiting_approval' = 'awaiting_approval'): Promise<Seed> {
  const slug = `tf-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = assertDefined(org).id;
  const [u] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@e.com` })
    .returning({ id: schema.user.id });
  await db.insert(schema.hub).values({ userId: assertDefined(u).id });
  const [human] = await db
    .insert(schema.actor)
    .values({
      organizationId: orgId,
      kind: 'human',
      displayName: 'Ada',
      userId: assertDefined(u).id,
    })
    .returning({ id: schema.actor.id });
  const agent = await ensureDefaultAgent(orgId, assertDefined(human).id);
  const [session] = await db
    .insert(schema.agentSession)
    .values({ organizationId: orgId, agentId: agent.id, trigger: 'delegation', status })
    .returning({ id: schema.agentSession.id });
  return {
    orgId,
    humanActorId: assertDefined(human).id,
    agentId: agent.id,
    sessionId: assertDefined(session).id,
  };
}

describe('a claimed tool call that throws instead of returning an error result', () => {
  it('parks the action executing, records the failure, and reports needs_attention', async () => {
    openToolbox.mockResolvedValueOnce({
      tools: [],
      annotations: () => undefined,
      resolve: (name: string) => ({ connection: 'docket', rawName: name }),
      callTool: vi.fn().mockRejectedValue(new Error('MCP transport crashed mid-call')),
      close: vi.fn(),
    });
    const seed = await seedSession();
    const [action] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: seed.sessionId,
        organizationId: seed.orgId,
        type: 'action',
        approvalStatus: 'approved',
        body: {
          action: {
            kind: 'capture',
            summary: 'capture',
            toolCall: {
              connection: 'docket',
              tool: 'capture',
              input: { orgId: seed.orgId, text: 'x' },
              toolUseId: 'toolu_throws',
            },
          },
        },
      })
      .returning({ id: schema.sessionActivity.id });
    const [sessionRow] = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, seed.sessionId));
    const lease = await claimRunGeneration(assertDefined(sessionRow), {
      runnableStatuses: ['awaiting_approval'],
      resumeSession: false,
    });

    const outcome = await executeApprovedActions(seed.orgId, seed.sessionId, lease, {});

    expect(outcome).toBe('needs_attention');
    const [after] = await db
      .select({ status: schema.sessionActivity.approvalStatus, body: schema.sessionActivity.body })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, assertDefined(action).id));
    expect(after?.status).toBe('executing');
    expect(after?.body.action?.result).toEqual({
      content: 'MCP transport crashed mid-call',
      isError: true,
    });
    const errorActivity = await db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, seed.sessionId));
    expect(errorActivity.some((a) => a.type === 'error')).toBe(true);
  });

  it('records a generic message when the thrown value is not an Error instance', async () => {
    openToolbox.mockResolvedValueOnce({
      tools: [],
      annotations: () => undefined,
      resolve: (name: string) => ({ connection: 'docket', rawName: name }),
      // Deliberately non-Error, to exercise the `error instanceof Error` fallback.
      callTool: vi.fn().mockRejectedValue('a raw string rejection'),
      close: vi.fn(),
    });
    const seed = await seedSession();
    const [action] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: seed.sessionId,
        organizationId: seed.orgId,
        type: 'action',
        approvalStatus: 'approved',
        body: {
          action: {
            kind: 'capture',
            summary: 'capture',
            toolCall: {
              connection: 'docket',
              tool: 'capture',
              input: { orgId: seed.orgId, text: 'x' },
              toolUseId: 'toolu_nonerror',
            },
          },
        },
      })
      .returning({ id: schema.sessionActivity.id });
    const [sessionRow] = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, seed.sessionId));
    const lease = await claimRunGeneration(assertDefined(sessionRow), {
      runnableStatuses: ['awaiting_approval'],
      resumeSession: false,
    });

    const outcome = await executeApprovedActions(seed.orgId, seed.sessionId, lease, {});

    expect(outcome).toBe('needs_attention');
    const [after] = await db
      .select({ body: schema.sessionActivity.body })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, assertDefined(action).id));
    expect(after?.body.action?.result).toEqual({
      content: 'Approved action execution failed',
      isError: true,
    });
  });
});

describe('executeApprovedGeneration when the toolbox itself never opens', () => {
  it('settles the generation failed and re-throws instead of leaving it stuck running', async () => {
    openToolbox.mockRejectedValueOnce(new Error('could not reach the MCP transport'));
    const seed = await seedSession();
    await db.insert(schema.sessionActivity).values({
      sessionId: seed.sessionId,
      organizationId: seed.orgId,
      type: 'action',
      approvalStatus: 'approved',
      body: {
        action: {
          kind: 'capture',
          summary: 'capture',
          toolCall: {
            connection: 'docket',
            tool: 'capture',
            input: { orgId: seed.orgId, text: 'x' },
            toolUseId: 'toolu_open_fails',
          },
        },
      },
    });

    await expect(
      approveAndResume(
        seed.orgId,
        seed.humanActorId,
        seed.sessionId,
        assertDefined(
          (
            await db
              .select({ id: schema.sessionActivity.id })
              .from(schema.sessionActivity)
              .where(eq(schema.sessionActivity.sessionId, seed.sessionId))
          )[0],
        ).id,
        { decision: 'approve' },
      ),
    ).rejects.toThrow('could not reach the MCP transport');

    const [run] = await db
      .select()
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.sessionId, seed.sessionId));
    expect(run).toMatchObject({ status: 'failed', lastError: 'could not reach the MCP transport' });
    const [session] = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, seed.sessionId));
    expect(session?.status).toBe('failed');
  });

  it('settles the generation failed with a generic message when the thrown value is not an Error', async () => {
    // Deliberately non-Error, to exercise the `error instanceof Error` fallback in
    // executeApprovedGeneration's own catch.
    openToolbox.mockRejectedValueOnce('a raw string rejection');
    const seed = await seedSession();
    await db.insert(schema.sessionActivity).values({
      sessionId: seed.sessionId,
      organizationId: seed.orgId,
      type: 'action',
      approvalStatus: 'approved',
      body: {
        action: {
          kind: 'capture',
          summary: 'capture',
          toolCall: {
            connection: 'docket',
            tool: 'capture',
            input: { orgId: seed.orgId, text: 'x' },
            toolUseId: 'toolu_open_fails_nonerror',
          },
        },
      },
    });
    const [activityId] = await db
      .select({ id: schema.sessionActivity.id })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, seed.sessionId));

    await expect(
      approveAndResume(
        seed.orgId,
        seed.humanActorId,
        seed.sessionId,
        assertDefined(activityId).id,
        {
          decision: 'approve',
        },
      ),
    ).rejects.toBe('a raw string rejection');

    const [run] = await db
      .select()
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.sessionId, seed.sessionId));
    expect(run).toMatchObject({ status: 'failed', lastError: 'Agent execution failed' });
  });
});
