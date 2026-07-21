import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import type * as AgentRuntimeModule from '@docket/agent-runtime';

import type { getContainer as GetContainer } from '../../src/container';
import type cronRouter from '../../src/routes/cron';
import type { ensureDefaultAgent as EnsureDefaultAgent } from '../../src/lib/default-agent';
import { getDb, one } from '../support/routes-harness';

const AUTH = { authorization: 'Bearer test-cron-secret' };

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let cron!: typeof cronRouter;
let getContainer!: typeof GetContainer;
let agentRuntime!: typeof AgentRuntimeModule;
let ensureDefaultAgent!: typeof EnsureDefaultAgent;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  cron = (await import('../../src/routes/cron')).default;
  ({ getContainer } = await import('../../src/container'));
  agentRuntime = await import('@docket/agent-runtime');
  ({ ensureDefaultAgent } = await import('../../src/lib/default-agent'));
});

/** Script a single text-only assistant turn — the session settles `completed` after it. */
function textOnlyScript(text: string): readonly AgentRuntimeModule.ScriptedTurn[] {
  return [
    {
      message: { role: 'assistant', content: [{ type: 'text', text }] },
      stopReason: 'end_turn',
    },
  ];
}

interface SeededRun {
  readonly orgId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly humanActorId: string;
}

/** The `agent_session.status` / `agent_session_run.status` enum literals this helper accepts. */
type SessionStatusLiteral =
  | 'pending'
  | 'running'
  | 'awaiting_input'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'canceled';
type RunStatusLiteral = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'canceled';

/** Seed an org + default agent + a prompt-seeded session, plus one `agent_session_run` row. */
async function seedSessionWithRun(
  opts: {
    sessionStatus?: SessionStatusLiteral;
    runStatus?: RunStatusLiteral;
    leaseExpiresAt?: Date | null;
    queuedAt?: Date;
  } = {},
): Promise<SeededRun> {
  const slug = `lac-${Math.random().toString(36).slice(2, 10)}`;
  const org = one(
    await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id }),
  );
  const u = one(
    await db
      .insert(schema.user)
      .values({ name: 'Ada', email: `${slug}@e.com` })
      .returning({ id: schema.user.id }),
  );
  await db.insert(schema.hub).values({ userId: u.id });
  const human = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: org.id, kind: 'human', displayName: 'Ada', userId: u.id })
      .returning({ id: schema.actor.id }),
  );
  const agent = await ensureDefaultAgent(org.id, human.id);

  const session = one(
    await db
      .insert(schema.agentSession)
      .values({
        organizationId: org.id,
        agentId: agent.id,
        trigger: 'delegation',
        status: opts.sessionStatus ?? 'pending',
        initiatorId: human.id,
      })
      .returning({ id: schema.agentSession.id }),
  );
  await db.insert(schema.sessionActivity).values({
    sessionId: session.id,
    organizationId: org.id,
    type: 'response',
    body: { text: 'Summarize my week.' },
  });

  const run = one(
    await db
      .insert(schema.agentSessionRun)
      .values({
        sessionId: session.id,
        organizationId: org.id,
        generation: 0,
        workflowInstanceId: `placeholder:${schema.genId()}`,
        status: opts.runStatus ?? 'queued',
        queuedAt: opts.queuedAt ?? new Date(),
        leaseExpiresAt: opts.leaseExpiresAt,
      })
      .returning({ id: schema.agentSessionRun.id }),
  );

  return { orgId: org.id, sessionId: session.id, runId: run.id, humanActorId: human.id };
}

describe('POST /internal/cron/run-linear-agent-sessions', () => {
  it('401s without the cron secret', async () => {
    const res = await cron.request('/run-linear-agent-sessions', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('claims a queued run, drives it via the scripted turn runtime, and marks it completed', async () => {
    const seeded = await seedSessionWithRun();
    const runtime = new agentRuntime.MockAgentTurnRuntime({
      script: textOnlyScript('All caught up — nothing urgent this week.'),
    });
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation((input) =>
      runtime.streamTurn(input),
    );

    const res = await cron.request('/run-linear-agent-sessions', { method: 'POST', headers: AUTH });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ swept: true, claimed: 1, succeeded: 1, failed: 0 });

    const [run] = await db
      .select()
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.id, seeded.runId));
    expect(run?.status).toBe('completed');
    expect(run?.completedAt).toBeInstanceOf(Date);
    expect(run?.attempt).toBe(1);

    const [session] = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, seeded.sessionId));
    expect(session?.status).toBe('completed');
  });

  it('maps a session that settles awaiting approval/input to the run status "waiting", not "completed"', async () => {
    const seeded = await seedSessionWithRun();
    const runtime = new agentRuntime.MockAgentTurnRuntime({
      script: [
        {
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_ask_1',
                name: 'ask_user',
                input: { question: 'Which project?' },
              },
            ],
          },
          stopReason: 'tool_use',
        },
      ],
    });
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation((input) =>
      runtime.streamTurn(input),
    );

    const res = await cron.request('/run-linear-agent-sessions', { method: 'POST', headers: AUTH });
    expect(await res.json()).toEqual({ swept: true, claimed: 1, succeeded: 1, failed: 0 });

    const [run] = await db
      .select()
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.id, seeded.runId));
    expect(run?.status).toBe('waiting');

    const [session] = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, seeded.sessionId));
    expect(session?.status).toBe('awaiting_input');
  });

  it('marks a run failed and records lastError when driveSession itself throws, without failing the sweep', async () => {
    // A session already `completed` makes `driveSession` throw ConflictError immediately —
    // simulating a run whose session was somehow already settled by the time it was claimed.
    const seeded = await seedSessionWithRun({ sessionStatus: 'completed' });

    const res = await cron.request('/run-linear-agent-sessions', { method: 'POST', headers: AUTH });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ swept: true, claimed: 1, succeeded: 0, failed: 1 });

    const [run] = await db
      .select()
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.id, seeded.runId));
    expect(run?.status).toBe('failed');
    expect(run?.lastError).toBeTruthy();
    expect(run?.completedAt).toBeInstanceOf(Date);
  });

  it('does not reclaim a run whose lease has not expired, but reclaims it once the lease goes stale', async () => {
    const seeded = await seedSessionWithRun({
      runStatus: 'running',
      leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000), // owned by a "concurrent" worker
    });

    const untouched = await cron.request('/run-linear-agent-sessions', {
      method: 'POST',
      headers: AUTH,
    });
    expect(await untouched.json()).toEqual({ swept: true, claimed: 0, succeeded: 0, failed: 0 });
    const [stillRunning] = await db
      .select()
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.id, seeded.runId));
    expect(stillRunning?.status).toBe('running');
    expect(stillRunning?.attempt).toBe(0);

    // The lease goes stale (the owning worker presumably crashed) — now it's fair game.
    await db
      .update(schema.agentSessionRun)
      .set({ leaseExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.agentSessionRun.id, seeded.runId));

    const runtime = new agentRuntime.MockAgentTurnRuntime({
      script: textOnlyScript('Reclaimed and finished.'),
    });
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation((input) =>
      runtime.streamTurn(input),
    );

    const reclaimed = await cron.request('/run-linear-agent-sessions', {
      method: 'POST',
      headers: AUTH,
    });
    expect(await reclaimed.json()).toEqual({ swept: true, claimed: 1, succeeded: 1, failed: 0 });
    const [after] = await db
      .select()
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.id, seeded.runId));
    expect(after?.status).toBe('completed');
    expect(after?.attempt).toBe(1);
  });

  it('claims and drives multiple due runs in one sweep tick', async () => {
    const a = await seedSessionWithRun({ queuedAt: new Date(Date.now() - 2000) });
    const b = await seedSessionWithRun({ queuedAt: new Date(Date.now() - 1000) });
    const runtime = new agentRuntime.MockAgentTurnRuntime({ script: textOnlyScript('Done.') });
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation((input) =>
      runtime.streamTurn(input),
    );

    const res = await cron.request('/run-linear-agent-sessions', { method: 'POST', headers: AUTH });
    expect(await res.json()).toEqual({ swept: true, claimed: 2, succeeded: 2, failed: 0 });

    for (const seeded of [a, b]) {
      const [run] = await db
        .select()
        .from(schema.agentSessionRun)
        .where(eq(schema.agentSessionRun.id, seeded.runId));
      expect(run?.status).toBe('completed');
    }
  });
});
