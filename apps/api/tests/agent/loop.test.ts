import { resolve } from 'node:path';

import type { TurnMessage } from '@docket/types';
import { and, asc, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Stub Better Auth (module-scope import via the mcp auth chain).
const getSession = vi.fn(async () => null);
vi.mock('@docket/auth', () => ({ auth: { api: { getSession } } }));

import type * as DbModule from '@docket/db';
import type * as AgentRuntimeModule from '@docket/agent-runtime';

import type {
  driveSession as DriveSession,
  resumeSessionExecution as ResumeSessionExecution,
  LoopDeps,
} from '../../src/agent/loop';
import type { approveAndResume as ApproveAndResume } from '../../src/agent/loop';
import type { ensureDefaultAgent as EnsureDefaultAgent } from '../../src/lib/default-agent';
import type { replyToElicitation as ReplyToElicitation } from '../../src/routes/agent-session-approval';

process.env['DATABASE_URL'] = 'pglite://memory://';
process.env['APP_MODE'] = 'test';
process.env['NODE_ENV'] = 'test';
process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
process.env['CRON_SECRET'] = 'test-cron-secret';
process.env['SKIP_ENV_VALIDATION'] = '1';
process.env['AGENT_MAX_TURNS'] = '6';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let agentRuntime!: typeof AgentRuntimeModule;
let driveSession!: typeof DriveSession;
let resumeSessionExecution!: typeof ResumeSessionExecution;
let approveAndResume!: typeof ApproveAndResume;
let ensureDefaultAgent!: typeof EnsureDefaultAgent;
let replyToElicitation!: typeof ReplyToElicitation;

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  agentRuntime = await import('@docket/agent-runtime');
  ({ driveSession, approveAndResume, resumeSessionExecution } =
    await import('../../src/agent/loop'));
  ({ ensureDefaultAgent } = await import('../../src/lib/default-agent'));
  ({ replyToElicitation } = await import('../../src/routes/agent-session-approval'));
});

interface Seed {
  userId: string;
  orgId: string;
  teamId: string;
  humanActorId: string;
  agentId: string;
  agentActorId: string;
  sessionId: string;
}

/** Seed an org + default agent + a pending prompt-seeded session. */
async function seedSession(policy?: 'suggest' | 'act_with_approval' | 'autonomous'): Promise<Seed> {
  const slug = `lp-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = org!.id;
  const [u] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@e.com` })
    .returning({ id: schema.user.id });
  await db.insert(schema.hub).values({ userId: u!.id });
  const [human] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId: u!.id })
    .returning({ id: schema.actor.id });
  const [team] = await db
    .insert(schema.team)
    .values({ organizationId: orgId, name: 'Core', key: 'CORE' })
    .returning({ id: schema.team.id });

  const agent = await ensureDefaultAgent(orgId, human!.id);
  if (policy && policy !== 'act_with_approval') {
    await db
      .update(schema.agent)
      .set({ approvalPolicy: policy })
      .where(eq(schema.agent.id, agent.id));
  }
  const [agentRow] = await db
    .select({ actorId: schema.agent.actorId })
    .from(schema.agent)
    .where(eq(schema.agent.id, agent.id))
    .limit(1);

  const [session] = await db
    .insert(schema.agentSession)
    .values({
      organizationId: orgId,
      agentId: agent.id,
      trigger: 'delegation',
      status: 'pending',
      initiatorId: human!.id,
    })
    .returning({ id: schema.agentSession.id });
  await db.insert(schema.sessionActivity).values({
    sessionId: session!.id,
    organizationId: orgId,
    type: 'response',
    body: { text: 'Import my backlog.' },
  });

  return {
    userId: u!.id,
    orgId,
    teamId: team!.id,
    humanActorId: human!.id,
    agentId: agent.id,
    agentActorId: agentRow!.actorId,
    sessionId: session!.id,
  };
}

/** Build deps whose turn runtime replays the given script. */
function scripted(script: readonly AgentRuntimeModule.ScriptedTurn[]): LoopDeps {
  return { turnRuntime: new agentRuntime.MockAgentTurnRuntime({ script }) };
}

/** A one-create-then-summarize job script targeting real seeded ids. */
function createTaskScript(seed: Seed): readonly AgentRuntimeModule.ScriptedTurn[] {
  return [
    {
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Reading the brief.', signature: 'sig-0' },
          {
            type: 'tool_use',
            id: 'toolu_ct_1',
            name: 'create_task',
            input: { orgId: seed.orgId, teamId: seed.teamId, title: 'Book the venue' },
          },
        ],
      },
      stopReason: 'tool_use',
    },
    {
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Created the task.' }],
      },
      stopReason: 'end_turn',
    },
  ];
}

async function activities(
  sessionId: string,
): Promise<(typeof DbModule.sessionActivity.$inferSelect)[]> {
  return db
    .select()
    .from(schema.sessionActivity)
    .where(eq(schema.sessionActivity.sessionId, sessionId))
    .orderBy(asc(schema.sessionActivity.createdAt));
}

async function transcriptMessages(sessionId: string): Promise<TurnMessage[]> {
  const rows = await db
    .select()
    .from(schema.agentSessionTranscript)
    .where(eq(schema.agentSessionTranscript.sessionId, sessionId));
  return rows[0]?.messages ?? [];
}

describe('driveSession — act_with_approval (the default dial)', () => {
  it('pauses on a proposed write with the executable toolCall and a proposal group', async () => {
    const seed = await seedSession();
    const settled = await driveSession(
      seed.orgId,
      seed.sessionId,
      scripted(createTaskScript(seed)),
    );
    expect(settled.status).toBe('awaiting_approval');

    const acts = await activities(seed.sessionId);
    const thought = acts.find((a) => a.type === 'thought');
    expect(thought?.body.text).toBe('Reading the brief.');

    const action = acts.find((a) => a.type === 'action');
    expect(action?.approvalStatus).toBe('proposed');
    expect(action?.proposalGroupId).toBeTruthy();
    expect(action?.body.action?.toolCall).toEqual({
      connection: 'docket',
      tool: 'create_task',
      input: { orgId: seed.orgId, teamId: seed.teamId, title: 'Book the venue' },
      toolUseId: 'toolu_ct_1',
    });
    expect(action?.body.action?.mode).toBe('proposal');

    // Nothing executed: no task exists yet.
    const tasks = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.organizationId, seed.orgId));
    expect(tasks).toHaveLength(0);

    // The transcript holds the brief + the full assistant turn (resume state).
    const messages = await transcriptMessages(seed.sessionId);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('user');
    expect(messages[1]?.role).toBe('assistant');
  });

  it('approve executes the stored toolCall as the agent actor and resumes to completion', async () => {
    const seed = await seedSession();
    const deps = scripted(createTaskScript(seed));
    await driveSession(seed.orgId, seed.sessionId, deps);

    const acts = await activities(seed.sessionId);
    const action = acts.find((a) => a.type === 'action');

    const settled = await approveAndResume(
      seed.orgId,
      seed.humanActorId,
      seed.sessionId,
      action!.id,
      { decision: 'approve' },
      deps,
    );
    expect(settled.status).toBe('completed');

    // The task landed, attributed to the agent actor.
    const tasks = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.organizationId, seed.orgId));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe('Book the venue');
    expect(tasks[0]?.createdBy).toBe(seed.agentActorId);

    // The action row settled applied and carries the execution result.
    const after = await activities(seed.sessionId);
    const applied = after.find((a) => a.id === action!.id);
    expect(applied?.approvalStatus).toBe('applied');
    expect(applied?.body.action?.result?.isError).toBe(false);

    // The model heard the result and summarized (turn 1 of the script).
    expect(after.some((a) => a.type === 'response' && a.body.text === 'Created the task.')).toBe(
      true,
    );

    // Transcript: brief, assistant turn, tool_result user message, final assistant turn.
    const messages = await transcriptMessages(seed.sessionId);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('reject feeds the rejection back and the session continues instead of cancelling', async () => {
    const seed = await seedSession();
    const deps = scripted(createTaskScript(seed));
    await driveSession(seed.orgId, seed.sessionId, deps);
    const action = (await activities(seed.sessionId)).find((a) => a.type === 'action');

    const settled = await approveAndResume(
      seed.orgId,
      seed.humanActorId,
      seed.sessionId,
      action!.id,
      { decision: 'reject' },
      deps,
    );
    expect(settled.status).toBe('completed');

    // Nothing executed.
    const tasks = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.organizationId, seed.orgId));
    expect(tasks).toHaveLength(0);

    // The rejection reached the model as an isError tool_result.
    const messages = await transcriptMessages(seed.sessionId);
    const resultMsg = messages.find(
      (m) => m.role === 'user' && m.content.some((b) => b.type === 'tool_result'),
    );
    const block = resultMsg?.content.flatMap((b) => (b.type === 'tool_result' ? [b] : []))[0];
    expect(block?.isError).toBe(true);
  });

  it('read tools execute immediately without pausing (the dial gates mutation only)', async () => {
    const seed = await seedSession();
    const script: readonly AgentRuntimeModule.ScriptedTurn[] = [
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_rd_1',
              name: 'search',
              input: { orgId: seed.orgId, query: 'venue' },
            },
          ],
        },
        stopReason: 'tool_use',
      },
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'Nothing found.' }] },
        stopReason: 'end_turn',
      },
    ];
    const settled = await driveSession(seed.orgId, seed.sessionId, scripted(script));
    expect(settled.status).toBe('completed');
    const acts = await activities(seed.sessionId);
    const action = acts.find((a) => a.type === 'action');
    expect(action?.approvalStatus).toBe('applied');
    expect(action?.body.action?.result?.isError).toBe(false);
  });
});

describe('driveSession — autonomous', () => {
  it('executes writes immediately, fully audited, and completes in one drive', async () => {
    const seed = await seedSession('autonomous');
    await db
      .update(schema.hub)
      .set({ preferences: { athena: { approvalMode: 'routine_autonomy' } } })
      .where(eq(schema.hub.userId, seed.userId));
    const settled = await driveSession(
      seed.orgId,
      seed.sessionId,
      scripted(createTaskScript(seed)),
    );
    expect(settled.status).toBe('completed');

    const tasks = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.organizationId, seed.orgId));
    expect(tasks).toHaveLength(1);

    const action = (await activities(seed.sessionId)).find((a) => a.type === 'action');
    expect(action?.approvalStatus).toBe('applied');

    const audits = await db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.organizationId, seed.orgId),
          eq(schema.auditEvent.subjectType, 'agent_session'),
        ),
      );
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});

describe('driveSession — suggest', () => {
  it('records writes as suggestions, never executes, and finishes awaiting review', async () => {
    const seed = await seedSession('suggest');
    const settled = await driveSession(
      seed.orgId,
      seed.sessionId,
      scripted(createTaskScript(seed)),
    );
    // The suggestion is still pending review at the end of the job.
    expect(settled.status).toBe('awaiting_approval');

    const tasks = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.organizationId, seed.orgId));
    expect(tasks).toHaveLength(0);

    const acts = await activities(seed.sessionId);
    const action = acts.find((a) => a.type === 'action');
    expect(action?.approvalStatus).toBe('proposed');
    expect(action?.body.action?.mode).toBe('suggestion');

    // The model continued past the suggestion (turn 1 ran within the same drive).
    expect(acts.some((a) => a.type === 'response' && a.body.text === 'Created the task.')).toBe(
      true,
    );
  });
});

describe('driveSession — elicitation (ask_user)', () => {
  it('pauses awaiting_input on ask_user and resumes from the human reply', async () => {
    const seed = await seedSession();
    const script: readonly AgentRuntimeModule.ScriptedTurn[] = [
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_ask_1',
              name: 'ask_user',
              input: { question: 'Which venue do you prefer?' },
            },
          ],
        },
        stopReason: 'tool_use',
      },
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'Booking the loft.' }] },
        stopReason: 'end_turn',
      },
    ];
    const deps = scripted(script);
    const paused = await driveSession(seed.orgId, seed.sessionId, deps);
    expect(paused.status).toBe('awaiting_input');

    const acts = await activities(seed.sessionId);
    const elicitation = acts.find((a) => a.type === 'elicitation');
    expect(elicitation?.body.text).toBe('Which venue do you prefer?');

    await db.insert(schema.sessionActivity).values(
      Array.from({ length: 11 }, (_, index) => ({
        sessionId: seed.sessionId,
        organizationId: seed.orgId,
        type: 'response' as const,
        body: {
          text: `Unrelated response ${String(index)}`,
          toolUseId: `toolu_other_${String(index)}`,
        },
        createdAt: new Date(index),
      })),
    );
    await replyToElicitation(seed.orgId, seed.sessionId, elicitation!.id, 'The loft, please.');
    const settled = await resumeSessionExecution(seed.orgId, seed.sessionId, deps);
    expect(settled.status).toBe('completed');

    // The reply reached the model as the ask_user tool_result.
    const messages = await transcriptMessages(seed.sessionId);
    const resultMsg = messages.find(
      (m) => m.role === 'user' && m.content.some((b) => b.type === 'tool_result'),
    );
    const block = resultMsg?.content.flatMap((b) => (b.type === 'tool_result' ? [b] : []))[0];
    expect(block?.isError).toBe(false);
    expect(block?.content).toContain('The loft');
  });
});

describe('driveSession — bounds and failure surfaces', () => {
  it('fails the session with an error activity when the model refuses', async () => {
    const seed = await seedSession();
    const script: readonly AgentRuntimeModule.ScriptedTurn[] = [
      { message: { role: 'assistant', content: [] }, stopReason: 'refusal' },
    ];
    const settled = await driveSession(seed.orgId, seed.sessionId, scripted(script));
    expect(settled.status).toBe('failed');
    const acts = await activities(seed.sessionId);
    expect(acts.some((a) => a.type === 'error')).toBe(true);
  });

  it('fails the session when the turn budget is exhausted', async () => {
    const seed = await seedSession('autonomous');
    // Every turn issues another read; the script never reaches end_turn within budget.
    const turn = {
      message: {
        role: 'assistant' as const,
        content: [
          {
            type: 'tool_use' as const,
            id: 'toolu_loop',
            name: 'search',
            input: { orgId: seed.orgId, query: 'again' },
          },
        ],
      },
      stopReason: 'tool_use' as const,
    };
    // Unique tool_use ids per turn so results pair correctly.
    const script = Array.from({ length: 10 }, (_, i) => ({
      ...turn,
      message: {
        ...turn.message,
        content: [{ ...turn.message.content[0]!, id: `toolu_loop_${i}` }],
      },
    }));
    const settled = await driveSession(seed.orgId, seed.sessionId, scripted(script));
    expect(settled.status).toBe('failed');
    const acts = await activities(seed.sessionId);
    expect(acts.some((a) => a.type === 'error' && /turn/i.test(a.body.text ?? ''))).toBe(true);
  });
});
