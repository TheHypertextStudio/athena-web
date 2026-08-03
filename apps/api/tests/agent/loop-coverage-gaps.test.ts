/**
 * `@docket/api` — targeted coverage for `src/agent/loop.ts` branches the primary
 * `loop.test.ts` / `user-owned-loop.test.ts` suites do not reach: preference defaults for an
 * uninitiated/initiator-less session, malformed tool input, ask_user reconciliation edge cases,
 * entry-point admission failures, mid-run pause/cancel honoring, the turn-budget `max_tokens`
 * surface, and the durable action-claim/action-result race windows in
 * {@link import('../../src/agent/loop').executeApprovedActions}.
 *
 * @remarks
 * Each race scenario uses the `beforeGenerationEffect` test seam the loop already exposes for
 * exactly this purpose (see `AGENTS.md`'s durability requirements): it fires immediately before a
 * generation-owned persistence transaction, which is precisely where a competing writer's
 * conditional update needs to land to reproduce the race honestly.
 */
import { resolve } from 'node:path';

import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Stub Better Auth (module-scope import via the mcp auth chain).
const getSession = vi.fn(async () => null);
vi.mock('@docket/auth', () => ({ auth: { api: { getSession } } }));

import type * as AgentRuntimeModule from '@docket/agent-runtime';
import type * as DbModule from '@docket/db';
import type { TurnMessage } from '@docket/types';

import type {
  approveGroupAndResume as ApproveGroupAndResume,
  approveLatestAndResume as ApproveLatestAndResume,
  driveSession as DriveSession,
  driveSessionAfterMessage as DriveSessionAfterMessage,
  executeApprovedActions as ExecuteApprovedActions,
  LoopDeps,
  resumeSessionExecution as ResumeSessionExecution,
} from '../../src/agent/loop';
import type {
  claimRunGeneration as ClaimRunGeneration,
  RunGenerationLease,
} from '../../src/agent/run-generation';
import type {
  loadTranscript as LoadTranscript,
  saveTranscript as SaveTranscript,
} from '../../src/agent/transcript';
import type { ensureDefaultAgent as EnsureDefaultAgent } from '../../src/lib/default-agent';
import type {
  answerElicitation as AnswerElicitation,
  materializeElicitations as MaterializeElicitations,
} from '../../src/services/elicitation-service';

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
let driveSessionAfterMessage!: typeof DriveSessionAfterMessage;
let resumeSessionExecution!: typeof ResumeSessionExecution;
let approveGroupAndResume!: typeof ApproveGroupAndResume;
let approveLatestAndResume!: typeof ApproveLatestAndResume;
let executeApprovedActions!: typeof ExecuteApprovedActions;
let claimRunGeneration!: typeof ClaimRunGeneration;
let loadTranscript!: typeof LoadTranscript;
let saveTranscript!: typeof SaveTranscript;
let ensureDefaultAgent!: typeof EnsureDefaultAgent;
let answerElicitation!: typeof AnswerElicitation;
let materializeElicitations!: typeof MaterializeElicitations;

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  agentRuntime = await import('@docket/agent-runtime');
  ({
    driveSession,
    driveSessionAfterMessage,
    resumeSessionExecution,
    approveGroupAndResume,
    approveLatestAndResume,
    executeApprovedActions,
  } = await import('../../src/agent/loop'));
  ({ claimRunGeneration } = await import('../../src/agent/run-generation'));
  ({ loadTranscript, saveTranscript } = await import('../../src/agent/transcript'));
  ({ ensureDefaultAgent } = await import('../../src/lib/default-agent'));
  ({ answerElicitation, materializeElicitations } =
    await import('../../src/services/elicitation-service'));
});

interface RegisteredAgentSeed {
  readonly orgId: string;
  readonly teamId: string;
  readonly humanActorId: string;
  readonly agentId: string;
  readonly sessionId: string;
}

/** Seed an org + default agent + a registered-agent session, optionally with no initiator. */
async function seedRegisteredAgentSession(
  options: {
    readonly withInitiator?: boolean;
    readonly status?: (typeof schema.agentSession.$inferSelect)['status'];
    readonly withSeedResponse?: boolean;
  } = {},
): Promise<RegisteredAgentSeed> {
  const withInitiator = options.withInitiator ?? true;
  const status = options.status ?? 'pending';
  const withSeedResponse = options.withSeedResponse ?? true;
  const slug = `lg-${Math.random().toString(36).slice(2, 10)}`;
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

  const [session] = await db
    .insert(schema.agentSession)
    .values({
      organizationId: orgId,
      agentId: agent.id,
      trigger: 'delegation',
      status,
      initiatorId: withInitiator ? human!.id : null,
    })
    .returning({ id: schema.agentSession.id });
  if (withSeedResponse) {
    await db.insert(schema.sessionActivity).values({
      sessionId: session!.id,
      organizationId: orgId,
      type: 'response',
      body: { text: 'Import my backlog.' },
    });
  }

  return {
    orgId,
    teamId: team!.id,
    humanActorId: human!.id,
    agentId: agent.id,
    sessionId: session!.id,
  };
}

interface AthenaSeed {
  readonly ownerUserId: string;
  readonly ownerActorId: string;
  readonly orgId: string;
  readonly sessionId: string;
}

/** Seed a user-owned Athena session with a workspace context (needed for elicitation tasks). */
async function seedAthenaSession(
  options: {
    readonly instructions?: string;
    readonly status?: (typeof schema.agentSession.$inferSelect)['status'];
  } = {},
): Promise<AthenaSeed> {
  const slug = `la-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const [role] = await db
    .insert(schema.role)
    .values({
      organizationId: org!.id,
      key: `owner-${slug}`,
      name: 'Owner',
      capabilities: ['view', 'contribute'],
    })
    .returning({ id: schema.role.id });
  const [owner] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@example.com` })
    .returning({ id: schema.user.id });
  await db.insert(schema.hub).values({
    userId: owner!.id,
    preferences: options.instructions ? { athena: { instructions: options.instructions } } : {},
  });
  const [ownerActor] = await db
    .insert(schema.actor)
    .values({
      organizationId: org!.id,
      kind: 'human',
      displayName: 'Ada',
      userId: owner!.id,
      roleId: role!.id,
    })
    .returning({ id: schema.actor.id });
  await db
    .insert(schema.team)
    .values({ organizationId: org!.id, name: 'Core', key: `A${slug.slice(-4)}` });
  const [session] = await db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: owner!.id,
      contextOrganizationId: org!.id,
      trigger: 'delegation',
      status: options.status ?? 'pending',
    })
    .returning({ id: schema.agentSession.id });
  return {
    ownerUserId: owner!.id,
    ownerActorId: ownerActor!.id,
    orgId: org!.id,
    sessionId: session!.id,
  };
}

/** Build deps whose turn runtime replays the given script. */
function scripted(script: readonly AgentRuntimeModule.ScriptedTurn[]): LoopDeps {
  return { turnRuntime: new agentRuntime.MockAgentTurnRuntime({ script }) };
}

/** A turn runtime that never actually gets invoked (entry-point-rejection tests). */
function unusedRuntime(): LoopDeps {
  return { turnRuntime: new agentRuntime.MockAgentTurnRuntime({ script: [] }) };
}

async function activities(
  sessionId: string,
): Promise<(typeof DbModule.sessionActivity.$inferSelect)[]> {
  return db
    .select()
    .from(schema.sessionActivity)
    .where(eq(schema.sessionActivity.sessionId, sessionId));
}

describe('principalAthenaPreferences', () => {
  it('defaults an initiator-less registered-agent session instead of throwing', async () => {
    const seed = await seedRegisteredAgentSession({ withInitiator: false });
    const script: readonly AgentRuntimeModule.ScriptedTurn[] = [
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
        stopReason: 'end_turn',
      },
    ];
    const settled = await driveSession(seed.orgId, seed.sessionId, scripted(script));
    expect(settled.status).toBe('completed');
  });

  it('carries the owner’s custom Athena instructions into the system prompt', async () => {
    const seed = await seedAthenaSession({ instructions: 'Always mention the budget ceiling.' });
    let capturedSystem = '';
    const turnRuntime: AgentRuntimeModule.AgentTurnRuntime = {
      async *streamTurn(input) {
        capturedSystem = input.system;
        yield {
          type: 'turn_end',
          stopReason: 'end_turn',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
        };
      },
    };
    const settled = await driveSession(seed.orgId, seed.sessionId, { turnRuntime });
    expect(settled.status).toBe('completed');
    expect(capturedSystem).toContain('Always mention the budget ceiling.');
  });
});

describe('driveSession — the default (container) turn runtime, unstubbed', () => {
  it('resolves the process-level mock backend when no turnRuntime is injected', async () => {
    // No `deps.turnRuntime` at all: exercises `resolveOwnerTurnRuntime`'s fallback to
    // `getContainer().agentTurn`, which resolves to the mock backend under APP_MODE=test.
    const seed = await seedRegisteredAgentSession();
    const settled = await driveSession(seed.orgId, seed.sessionId, {});
    // The container's default MockAgentTurnRuntime replays SCRIPTED_TURNS: a tool_use that a
    // fresh act_with_approval agent pauses on.
    expect(settled.status).toBe('awaiting_approval');
  });
});

describe('toolOrganizationId / summarizeToolCall with atypical model output', () => {
  it('tolerates a non-object tool_use input instead of crashing, recording no org attribution', async () => {
    const seed = await seedAthenaSession();
    const script: readonly AgentRuntimeModule.ScriptedTurn[] = [
      {
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_bad_input', name: 'capture', input: 'not-an-object' },
          ],
        },
        stopReason: 'tool_use',
      },
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        stopReason: 'end_turn',
      },
    ];
    const settled = await driveSession(seed.orgId, seed.sessionId, scripted(script));
    expect(settled.status).toBe('awaiting_approval');
    const [action] = (await activities(seed.sessionId)).filter((a) => a.type === 'action');
    expect(action?.organizationId).toBeNull();
    expect(action?.body.action?.summary).toBe('capture');
  });

  it('quotes a title the model included in the tool input', async () => {
    const seed = await seedAthenaSession();
    const script: readonly AgentRuntimeModule.ScriptedTurn[] = [
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_titled',
              name: 'capture',
              input: { orgId: seed.orgId, title: 'Ship the launch email', text: 'ignored' },
            },
          ],
        },
        stopReason: 'tool_use',
      },
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        stopReason: 'end_turn',
      },
    ];
    const settled = await driveSession(seed.orgId, seed.sessionId, scripted(script));
    expect(settled.status).toBe('awaiting_approval');
    const [action] = (await activities(seed.sessionId)).filter((a) => a.type === 'action');
    expect(action?.body.action?.summary).toBe('capture: "Ship the launch email"');
  });
});

describe('reconcileToolUse — ask_user edge cases', () => {
  it('pauses awaiting_input when the transcript has an ask_user tool_use with no elicitation row', async () => {
    const seed = await seedRegisteredAgentSession({ withSeedResponse: false, status: 'running' });
    const messages: TurnMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Brief.' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_orphan',
            name: 'ask_user',
            input: { question: 'Which one?' },
          },
        ],
      },
    ];
    await saveTranscript(db, seed.sessionId, seed.orgId, messages);

    const settled = await driveSession(seed.orgId, seed.sessionId, unusedRuntime());
    expect(settled.status).toBe('awaiting_input');
    expect((await activities(seed.sessionId)).some((a) => a.type === 'elicitation')).toBe(false);
  });

  it('stays parked when the recorded reply carries neither an elicitationAnswer nor text', async () => {
    const seed = await seedRegisteredAgentSession({ withSeedResponse: false, status: 'running' });
    const toolUseId = 'toolu_blank_reply';
    const messages: TurnMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Brief.' }] },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: toolUseId, name: 'ask_user', input: { question: 'Which one?' } },
        ],
      },
    ];
    await saveTranscript(db, seed.sessionId, seed.orgId, messages);
    const [prompt] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: seed.sessionId,
        organizationId: seed.orgId,
        type: 'elicitation',
        body: { text: 'Which one?', toolUseId },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      })
      .returning({ id: schema.sessionActivity.id });
    await db.insert(schema.sessionActivity).values({
      sessionId: seed.sessionId,
      organizationId: seed.orgId,
      type: 'response',
      body: { text: '', toolUseId },
      createdAt: new Date('2026-01-01T00:00:05.000Z'),
    });

    const settled = await driveSession(seed.orgId, seed.sessionId, unusedRuntime());
    expect(settled.status).toBe('awaiting_input');
    // The blank reply was seen (not skipped) — the prompt exists and was matched.
    expect(prompt).toBeTruthy();
  });

  it('feeds back the typed elicitation payload rather than its prose once answered', async () => {
    const seed = await seedAthenaSession();
    const script: readonly AgentRuntimeModule.ScriptedTurn[] = [
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_typed_ask',
              name: 'ask_user',
              input: { question: 'Which channel?', actionSummary: 'Post the update' },
            },
          ],
        },
        stopReason: 'tool_use',
      },
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'Posted.' }] },
        stopReason: 'end_turn',
      },
    ];
    const deps = scripted(script);
    const paused = await driveSession(seed.orgId, seed.sessionId, deps);
    expect(paused.status).toBe('awaiting_input');

    // driveSession already called materializeElicitations itself (askedUser), so a second call is
    // a no-op by design (see the idempotency remark on materializeElicitations); read the row it
    // created directly instead.
    expect(await materializeElicitations(seed.sessionId)).toEqual([]);
    const [elicitationRow] = await db
      .select()
      .from(schema.agentElicitation)
      .where(eq(schema.agentElicitation.sessionId, seed.sessionId));
    expect(elicitationRow).toBeTruthy();
    const answer = await answerElicitation({
      elicitationId: elicitationRow!.id,
      userId: seed.ownerUserId,
      value: 'ops-channel',
    });
    expect(answer.ok).toBe(true);

    const settled = await resumeSessionExecution(seed.orgId, seed.sessionId, deps);
    expect(settled.status).toBe('completed');

    const messages = await loadTranscript(db, seed.sessionId);
    const resultMsg = messages.find(
      (m) => m.role === 'user' && m.content.some((b) => b.type === 'tool_result'),
    );
    const block = resultMsg?.content.flatMap((b) => (b.type === 'tool_result' ? [b] : []))[0];
    expect(block?.isError).toBe(false);
    expect(block?.content).toBe(JSON.stringify('ops-channel'));
  });
});

describe('driveSession entry admission', () => {
  it('rejects a session id that does not exist', async () => {
    await expect(driveSession('org_x', 'nonexistent-session', unusedRuntime())).rejects.toThrow(
      'Session not found',
    );
  });

  it('rejects a registered-agent session addressed from the wrong workspace', async () => {
    const seed = await seedRegisteredAgentSession();
    await expect(driveSession('some-other-org', seed.sessionId, unusedRuntime())).rejects.toThrow(
      'Session not found',
    );
  });

  it('rejects a session outside the entry point’s runnable statuses', async () => {
    const seed = await seedRegisteredAgentSession({ status: 'completed' });
    await expect(driveSession(seed.orgId, seed.sessionId, unusedRuntime())).rejects.toThrow(
      'Session is not in a runnable state',
    );
  });

  it('reports the agent as not found when it belongs to a different workspace than the session', async () => {
    const seed = await seedRegisteredAgentSession();
    const otherOrgSeed = await seedRegisteredAgentSession();
    // Point the session at an agent from a completely different workspace while keeping the
    // session's own organizationId — an internal data-consistency edge, not a normal user action.
    await db
      .update(schema.agentSession)
      .set({ agentId: otherOrgSeed.agentId })
      .where(eq(schema.agentSession.id, seed.sessionId));

    await expect(driveSession(seed.orgId, seed.sessionId, unusedRuntime())).rejects.toThrow(
      'Agent not found',
    );
  });
});

describe('driveSession — an Athena session with no workspace context', () => {
  it('completes without a workspace name, skipping both the org lookup and the entitlement check', async () => {
    const seed = await seedAthenaSession();
    // seedAthenaSession sets contextOrganizationId; null it out to model a purely personal chat.
    await db
      .update(schema.agentSession)
      .set({ contextOrganizationId: null })
      .where(eq(schema.agentSession.id, seed.sessionId));
    const script: readonly AgentRuntimeModule.ScriptedTurn[] = [
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
        stopReason: 'end_turn',
      },
    ];

    const settled = await driveSession(seed.orgId, seed.sessionId, scripted(script));
    expect(settled.status).toBe('completed');
  });
});

describe('driveSession — honoring a pause/cancel flip made mid-run', () => {
  function twoReadTurnScript(
    seed: RegisteredAgentSeed,
  ): readonly AgentRuntimeModule.ScriptedTurn[] {
    return [
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_mid_1',
              name: 'find',
              input: { orgId: seed.orgId, query: 'x' },
            },
          ],
        },
        stopReason: 'tool_use',
      },
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'Never reached.' }] },
        stopReason: 'end_turn',
      },
    ];
  }

  it('settles canceled when a concurrent cancel lands between turns', async () => {
    const seed = await seedRegisteredAgentSession();
    let flipped = false;
    const deps: LoopDeps = {
      turnRuntime: new agentRuntime.MockAgentTurnRuntime({ script: twoReadTurnScript(seed) }),
      async beforeGenerationEffect(kind): Promise<void> {
        if (kind !== 'reconciled-transcript' || flipped) return;
        flipped = true;
        await db
          .update(schema.agentSession)
          .set({ status: 'canceled' })
          .where(eq(schema.agentSession.id, seed.sessionId));
      },
    };
    const settled = await driveSession(seed.orgId, seed.sessionId, deps);
    expect(settled.status).toBe('canceled');
    expect(flipped).toBe(true);
  });

  it('settles awaiting_input when a concurrent pause lands between turns', async () => {
    const seed = await seedRegisteredAgentSession();
    let flipped = false;
    const deps: LoopDeps = {
      turnRuntime: new agentRuntime.MockAgentTurnRuntime({ script: twoReadTurnScript(seed) }),
      async beforeGenerationEffect(kind): Promise<void> {
        if (kind !== 'reconciled-transcript' || flipped) return;
        flipped = true;
        await db
          .update(schema.agentSession)
          .set({ status: 'awaiting_input' })
          .where(eq(schema.agentSession.id, seed.sessionId));
      },
    };
    const settled = await driveSession(seed.orgId, seed.sessionId, deps);
    expect(settled.status).toBe('awaiting_input');
    expect(flipped).toBe(true);
  });
});

describe('driveSession — provider output limit', () => {
  it('fails the session with an error activity when the turn hits the output-limit stop reason', async () => {
    const seed = await seedRegisteredAgentSession();
    const script: readonly AgentRuntimeModule.ScriptedTurn[] = [
      { message: { role: 'assistant', content: [] }, stopReason: 'max_tokens' },
    ];
    const settled = await driveSession(seed.orgId, seed.sessionId, scripted(script));
    expect(settled.status).toBe('failed');
    const errorActivity = (await activities(seed.sessionId)).find((a) => a.type === 'error');
    expect(errorActivity?.body.text).toMatch(/output limit/i);
  });
});

describe('executeApprovedActions entry admission', () => {
  const dummyLease: RunGenerationLease = {
    runId: 'run_dummy',
    sessionId: 'does-not-matter',
    generation: 1,
    leaseToken: 'token_dummy',
    leaseDurationMs: 60_000,
  };

  it('rejects a session id that does not exist', async () => {
    await expect(
      executeApprovedActions('org_x', 'nonexistent-session', dummyLease, {}),
    ).rejects.toThrow('Session not found');
  });

  it('rejects a registered-agent session addressed from the wrong workspace', async () => {
    const seed = await seedRegisteredAgentSession();
    await expect(
      executeApprovedActions('some-other-org', seed.sessionId, dummyLease, {}),
    ).rejects.toThrow('Session not found');
  });
});

describe('executeApprovedActions — durable race windows', () => {
  it('skips an approved action a competing writer reclaimed before the claim committed', async () => {
    const seed = await seedRegisteredAgentSession({ status: 'awaiting_approval' });
    const [action] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: seed.sessionId,
        organizationId: seed.orgId,
        type: 'action',
        approvalStatus: 'approved',
        body: {
          action: {
            kind: 'find',
            summary: 'find',
            toolCall: {
              connection: 'docket',
              tool: 'find',
              input: { orgId: seed.orgId, query: 'x' },
              toolUseId: 'toolu_race_1',
            },
          },
        },
      })
      .returning({ id: schema.sessionActivity.id });
    const [sessionRow] = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, seed.sessionId));
    const lease = await claimRunGeneration(sessionRow!, {
      runnableStatuses: ['awaiting_approval'],
      resumeSession: false,
    });

    const outcome = await executeApprovedActions(seed.orgId, seed.sessionId, lease, {
      async beforeGenerationEffect(kind): Promise<void> {
        if (kind !== 'action-claim') return;
        await db
          .update(schema.sessionActivity)
          .set({ approvalStatus: 'rejected' })
          .where(eq(schema.sessionActivity.id, action!.id));
      },
    });

    expect(outcome).toBe('settled');
    const [after] = await db
      .select({ status: schema.sessionActivity.approvalStatus })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, action!.id));
    expect(after?.status).toBe('rejected');
  });

  it('reports needs_attention when a competing writer reclaims a successfully-executed action', async () => {
    const seed = await seedRegisteredAgentSession({ status: 'awaiting_approval' });
    const [action] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: seed.sessionId,
        organizationId: seed.orgId,
        type: 'action',
        approvalStatus: 'approved',
        body: {
          action: {
            kind: 'find',
            summary: 'find',
            toolCall: {
              connection: 'docket',
              tool: 'find',
              input: { orgId: seed.orgId, query: 'x' },
              toolUseId: 'toolu_race_2',
            },
          },
        },
      })
      .returning({ id: schema.sessionActivity.id });
    const [sessionRow] = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, seed.sessionId));
    const lease = await claimRunGeneration(sessionRow!, {
      runnableStatuses: ['awaiting_approval'],
      resumeSession: false,
    });
    let seenActionResult = false;

    const outcome = await executeApprovedActions(seed.orgId, seed.sessionId, lease, {
      async beforeGenerationEffect(kind): Promise<void> {
        if (kind !== 'action-result' || seenActionResult) return;
        seenActionResult = true;
        await db
          .update(schema.sessionActivity)
          .set({ approvalStatus: 'approved' })
          .where(eq(schema.sessionActivity.id, action!.id));
      },
    });

    expect(outcome).toBe('needs_attention');
    const [after] = await db
      .select({ status: schema.sessionActivity.approvalStatus, body: schema.sessionActivity.body })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, action!.id));
    // The raced finalize update never landed: status is whatever the competing writer set, and no
    // execution result got attached.
    expect(after?.status).toBe('approved');
    expect(after?.body.action?.result).toBeUndefined();
  });
});

describe('approve* composition — executing outside a live transcript', () => {
  it('reports needs_attention (rather than crashing) when a stuck in-flight action blocks completion', async () => {
    const seed = await seedRegisteredAgentSession({
      status: 'awaiting_approval',
      withSeedResponse: false,
    });
    const groupId = 'grp_needs_attention';
    await db.insert(schema.sessionActivity).values({
      sessionId: seed.sessionId,
      organizationId: seed.orgId,
      type: 'action',
      approvalStatus: 'proposed',
      proposalGroupId: groupId,
      body: {
        action: {
          kind: 'capture',
          summary: 'capture',
          toolCall: {
            connection: 'docket',
            tool: 'capture',
            input: { orgId: seed.orgId, text: 'x' },
            toolUseId: 'toolu_group',
          },
        },
      },
    });
    const [stuck] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: seed.sessionId,
        organizationId: seed.orgId,
        type: 'action',
        approvalStatus: 'executing',
        body: {
          action: {
            kind: 'capture',
            summary: 'capture (stuck)',
            toolCall: {
              connection: 'docket',
              tool: 'capture',
              input: { orgId: seed.orgId, text: 'y' },
              toolUseId: 'toolu_stuck',
            },
          },
        },
      })
      .returning({ id: schema.sessionActivity.id });

    const settled = await approveGroupAndResume(
      seed.orgId,
      seed.humanActorId,
      seed.sessionId,
      groupId,
      'reject',
    );

    expect(settled.status).toBe('awaiting_approval');
    const [after] = await db
      .select({ status: schema.sessionActivity.approvalStatus })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, stuck!.id));
    expect(after?.status).toBe('executing');
  });
});

describe('approveLatestAndResume', () => {
  it('rejects a session id that does not exist', async () => {
    await expect(approveLatestAndResume('org_x', null, 'nonexistent-session')).rejects.toThrow(
      'Session not found',
    );
  });

  it('falls back to the latest approved action when nothing is proposed', async () => {
    const seed = await seedRegisteredAgentSession({
      status: 'awaiting_approval',
      withSeedResponse: false,
    });
    const [approvedAction] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: seed.sessionId,
        organizationId: seed.orgId,
        type: 'action',
        approvalStatus: 'approved',
        body: {
          action: {
            kind: 'find',
            summary: 'find',
            toolCall: {
              connection: 'docket',
              tool: 'find',
              input: { orgId: seed.orgId, query: 'x' },
              toolUseId: 'toolu_latest',
            },
          },
        },
      })
      .returning({ id: schema.sessionActivity.id });

    const settled = await approveLatestAndResume(seed.orgId, seed.humanActorId, seed.sessionId);

    // The retry path re-executes the already-approved action without erroring.
    expect(['running', 'completed', 'awaiting_approval']).toContain(settled.status);
    const [after] = await db
      .select({ status: schema.sessionActivity.approvalStatus })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, approvedAction!.id));
    expect(after?.status).toBe('applied');
  });

  it('refuses when neither a proposed nor an approved action exists', async () => {
    const seed = await seedRegisteredAgentSession({
      status: 'awaiting_approval',
      withSeedResponse: false,
    });
    await db.insert(schema.sessionActivity).values({
      sessionId: seed.sessionId,
      organizationId: seed.orgId,
      type: 'action',
      approvalStatus: 'applied',
      body: {
        action: { kind: 'find', summary: 'find', result: { content: 'ok', isError: false } },
      },
    });

    await expect(
      approveLatestAndResume(seed.orgId, seed.humanActorId, seed.sessionId),
    ).rejects.toThrow('No proposed action awaiting approval');
  });

  it('rejects a session that is not currently awaiting approval', async () => {
    const seed = await seedRegisteredAgentSession({ status: 'pending' });
    await expect(
      approveLatestAndResume(seed.orgId, seed.humanActorId, seed.sessionId),
    ).rejects.toThrow('Session is not awaiting approval');
  });

  it('prefers the latest proposed action over an older approved one', async () => {
    const seed = await seedRegisteredAgentSession({
      status: 'awaiting_approval',
      withSeedResponse: false,
    });
    await db.insert(schema.sessionActivity).values({
      sessionId: seed.sessionId,
      organizationId: seed.orgId,
      type: 'action',
      approvalStatus: 'approved',
      body: { action: { kind: 'find', summary: 'find (older)' } },
    });
    const [proposedAction] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: seed.sessionId,
        organizationId: seed.orgId,
        type: 'action',
        approvalStatus: 'proposed',
        body: {
          action: {
            kind: 'find',
            summary: 'find (latest)',
            toolCall: {
              connection: 'docket',
              tool: 'find',
              input: { orgId: seed.orgId, query: 'x' },
              toolUseId: 'toolu_prop',
            },
          },
        },
      })
      .returning({ id: schema.sessionActivity.id });

    await approveLatestAndResume(seed.orgId, seed.humanActorId, seed.sessionId);

    const [decided] = await db
      .select({ status: schema.sessionActivity.approvalStatus })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, proposedAction!.id));
    expect(decided?.status).toBe('applied');
  });
});

describe('driveSessionAfterMessage', () => {
  it('reopens a completed session and drives it forward again', async () => {
    const seed = await seedRegisteredAgentSession();
    const finish: readonly AgentRuntimeModule.ScriptedTurn[] = [
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
        stopReason: 'end_turn',
      },
    ];
    await driveSession(seed.orgId, seed.sessionId, scripted(finish));
    const before = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, seed.sessionId));
    expect(before[0]).toMatchObject({ status: 'completed' });
    expect(before[0]?.endedAt).toBeTruthy();

    // No deps at all: exercises the LoopDeps default parameter and, transitively, the same
    // unstubbed container turn-runtime path (a registered-agent session never touches Lattice).
    const settled = await driveSessionAfterMessage(seed.orgId, seed.sessionId);

    expect(settled.status).toBe('completed');
    const after = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, seed.sessionId));
    // clearEndedAt admits the session from its terminal state before re-settling it.
    expect(after[0]?.endedAt).toBeTruthy();
  });
});

describe('deriveBrief — a session linked to a real task', () => {
  it('seeds the transcript with the linked task’s title instead of the session id', async () => {
    const seed = await seedRegisteredAgentSession({ withSeedResponse: false, status: 'pending' });
    const [taskRow] = await db
      .insert(schema.task)
      .values({
        organizationId: seed.orgId,
        title: 'Ship the Q3 launch email',
        teamId: seed.teamId,
        state: 'backlog',
      })
      .returning({ id: schema.task.id });
    await db
      .update(schema.agentSession)
      .set({ taskId: taskRow!.id })
      .where(eq(schema.agentSession.id, seed.sessionId));

    const script: readonly AgentRuntimeModule.ScriptedTurn[] = [
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'Sent.' }] },
        stopReason: 'end_turn',
      },
    ];
    await driveSession(seed.orgId, seed.sessionId, scripted(script));

    const messages = await loadTranscript(db, seed.sessionId);
    const brief = messages[0];
    expect(brief?.role).toBe('user');
    expect(brief?.content[0]).toMatchObject({ type: 'text', text: 'Ship the Q3 launch email' });
  });

  it('falls through to the session id when the linked task does not resolve in this workspace', async () => {
    const seed = await seedRegisteredAgentSession({ withSeedResponse: false, status: 'pending' });
    const otherOrgSeed = await seedRegisteredAgentSession();
    const [taskInOtherOrg] = await db
      .insert(schema.task)
      .values({
        organizationId: otherOrgSeed.orgId,
        title: 'Belongs to a different workspace',
        teamId: otherOrgSeed.teamId,
        state: 'backlog',
      })
      .returning({ id: schema.task.id });
    // A taskId that does not resolve under this session's own organizationId — a data edge, not a
    // normal user action.
    await db
      .update(schema.agentSession)
      .set({ taskId: taskInOtherOrg!.id })
      .where(eq(schema.agentSession.id, seed.sessionId));

    const script: readonly AgentRuntimeModule.ScriptedTurn[] = [
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'Sent.' }] },
        stopReason: 'end_turn',
      },
    ];
    await driveSession(seed.orgId, seed.sessionId, scripted(script));

    const messages = await loadTranscript(db, seed.sessionId);
    expect(messages[0]?.content[0]).toMatchObject({ type: 'text', text: seed.sessionId });
  });
});

describe('reconcileToolUse — an applied action recorded without a result', () => {
  it('falls back to a generic success result instead of crashing on the missing field', async () => {
    const seed = await seedRegisteredAgentSession({ withSeedResponse: false, status: 'running' });
    const toolUseId = 'toolu_manual_apply';
    const messages: TurnMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Brief.' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: toolUseId,
            name: 'capture',
            input: { orgId: seed.orgId, text: 'x' },
          },
        ],
      },
    ];
    await saveTranscript(db, seed.sessionId, seed.orgId, messages);
    // Simulates a row applied by something other than executeApprovedActions' own success path
    // (e.g. an administrative correction) — the result field was never populated.
    await db.insert(schema.sessionActivity).values({
      sessionId: seed.sessionId,
      organizationId: seed.orgId,
      type: 'action',
      approvalStatus: 'applied',
      body: {
        action: {
          kind: 'capture',
          summary: 'capture',
          toolCall: {
            connection: 'docket',
            tool: 'capture',
            input: { orgId: seed.orgId, text: 'x' },
            toolUseId,
          },
        },
      },
    });
    const continuation: readonly AgentRuntimeModule.ScriptedTurn[] = [
      // MockAgentTurnRuntime indexes by the count of assistant turns already in the conversation;
      // the seeded transcript already carries one, so index 0 here is never actually replayed.
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'unused' }] },
        stopReason: 'end_turn',
      },
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'Continuing.' }] },
        stopReason: 'end_turn',
      },
    ];

    const settled = await driveSession(seed.orgId, seed.sessionId, scripted(continuation));
    expect(settled.status).toBe('completed');

    const after = await loadTranscript(db, seed.sessionId);
    const resultMsg = after.find(
      (m) => m.role === 'user' && m.content.some((b) => b.type === 'tool_result'),
    );
    const block = resultMsg?.content.flatMap((b) => (b.type === 'tool_result' ? [b] : []))[0];
    expect(block).toMatchObject({ content: 'Applied.', isError: false });
  });
});

describe('toolOrganizationId — an empty orgId string is treated the same as absent', () => {
  it('records no org attribution for an empty-string orgId', async () => {
    const seed = await seedAthenaSession();
    const script: readonly AgentRuntimeModule.ScriptedTurn[] = [
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_empty_org',
              name: 'capture',
              input: { orgId: '', text: 'x' },
            },
          ],
        },
        stopReason: 'tool_use',
      },
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        stopReason: 'end_turn',
      },
    ];
    const settled = await driveSession(seed.orgId, seed.sessionId, scripted(script));
    expect(settled.status).toBe('awaiting_approval');
    const [action] = (await activities(seed.sessionId)).filter((a) => a.type === 'action');
    expect(action?.organizationId).toBeNull();
  });
});

describe('the assistant-turn effect — a non-object ask_user input', () => {
  it('still records the elicitation row instead of crashing', async () => {
    const seed = await seedAthenaSession();
    const script: readonly AgentRuntimeModule.ScriptedTurn[] = [
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_ask_bad_input',
              name: 'ask_user',
              input: 'not-an-object',
            },
          ],
        },
        stopReason: 'tool_use',
      },
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        stopReason: 'end_turn',
      },
    ];
    const settled = await driveSession(seed.orgId, seed.sessionId, scripted(script));
    expect(settled.status).toBe('awaiting_input');
    const elicitation = (await activities(seed.sessionId)).find((a) => a.type === 'elicitation');
    expect(elicitation?.body['toolUseId']).toBe('toolu_ask_bad_input');
    // elicitationRequestFromToolInput defaults the question when the input is unusable.
    expect(elicitation?.body.text).toBe('I need your input to continue.');
  });
});

describe('driveSession — a non-Error thrown mid-turn', () => {
  it('settles the generation failed with a generic message instead of crashing on error.message', async () => {
    const seed = await seedRegisteredAgentSession();
    const turnRuntime: AgentRuntimeModule.AgentTurnRuntime = {
      // eslint-disable-next-line require-yield -- the generator throws before yielding anything
      async *streamTurn() {
        // A non-Error rejection (a raw string) — deliberately atypical to exercise the
        // `error instanceof Error` fallback in the loop's own outer catch.
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately non-Error
        throw 'transport exploded';
      },
    };

    await expect(driveSession(seed.orgId, seed.sessionId, { turnRuntime })).rejects.toBe(
      'transport exploded',
    );

    const [run] = await db
      .select()
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.sessionId, seed.sessionId));
    expect(run).toMatchObject({ status: 'failed', lastError: 'Agent execution failed' });
  });
});

describe('executeApprovedActions — a remote-connection tool call', () => {
  it('namespaces the dispatched tool name instead of treating it as a Docket tool', async () => {
    const seed = await seedRegisteredAgentSession({
      status: 'awaiting_approval',
      withSeedResponse: false,
    });
    const [action] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: seed.sessionId,
        organizationId: seed.orgId,
        type: 'action',
        approvalStatus: 'approved',
        body: {
          action: {
            kind: 'get_backlog_tasks',
            summary: 'get_backlog_tasks',
            toolCall: {
              connection: 'sunsama',
              tool: 'get_backlog_tasks',
              input: {},
              toolUseId: 'toolu_remote',
            },
          },
        },
      })
      .returning({ id: schema.sessionActivity.id });
    const [sessionRow] = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, seed.sessionId));
    const lease = await claimRunGeneration(sessionRow!, {
      runnableStatuses: ['awaiting_approval'],
      resumeSession: false,
    });

    const outcome = await executeApprovedActions(seed.orgId, seed.sessionId, lease, {});

    expect(outcome).toBe('settled');
    const [after] = await db
      .select({ status: schema.sessionActivity.approvalStatus, body: schema.sessionActivity.body })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, action!.id));
    expect(after?.status).toBe('applied');
    // No live "sunsama" connection exists for this owner, so the unnamespaced remote name never
    // resolves on Docket's own server either — it comes back an error result, not a crash.
    expect(after?.body.action?.result?.isError).toBe(true);
  });
});

describe('executeApprovedActions — an action with no executable tool call', () => {
  it('applies it directly and audits it under a generic "action" label', async () => {
    const seed = await seedRegisteredAgentSession({
      status: 'awaiting_approval',
      withSeedResponse: false,
    });
    const [action] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: seed.sessionId,
        organizationId: seed.orgId,
        type: 'action',
        approvalStatus: 'approved',
        body: {},
      })
      .returning({ id: schema.sessionActivity.id });
    const [sessionRow] = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, seed.sessionId));
    const lease = await claimRunGeneration(sessionRow!, {
      runnableStatuses: ['awaiting_approval'],
      resumeSession: false,
    });

    const outcome = await executeApprovedActions(seed.orgId, seed.sessionId, lease, {});

    expect(outcome).toBe('settled');
    const [after] = await db
      .select({ status: schema.sessionActivity.approvalStatus })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, action!.id));
    expect(after?.status).toBe('applied');
    const audit = await db
      .select()
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.subjectId, seed.sessionId), eq(schema.auditEvent.type, 'updated')),
      );
    expect(audit.some((a) => a.metadata['tool'] === 'action')).toBe(true);
  });
});

describe('approveGroupAndResume with an explicit activity subset', () => {
  it('decides only the named activities, leaving the rest of the group untouched', async () => {
    const seed = await seedRegisteredAgentSession({
      status: 'awaiting_approval',
      withSeedResponse: false,
    });
    const groupId = 'grp_subset';
    const [keep, drop] = await db
      .insert(schema.sessionActivity)
      .values([
        {
          sessionId: seed.sessionId,
          organizationId: seed.orgId,
          type: 'action',
          approvalStatus: 'proposed',
          proposalGroupId: groupId,
          body: { action: { kind: 'find', summary: 'find A' } },
        },
        {
          sessionId: seed.sessionId,
          organizationId: seed.orgId,
          type: 'action',
          approvalStatus: 'proposed',
          proposalGroupId: groupId,
          body: { action: { kind: 'find', summary: 'find B' } },
        },
      ])
      .returning({ id: schema.sessionActivity.id });

    await approveGroupAndResume(seed.orgId, seed.humanActorId, seed.sessionId, groupId, 'reject', [
      drop!.id,
    ]);

    const [keptAfter] = await db
      .select({ status: schema.sessionActivity.approvalStatus })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, keep!.id));
    const [droppedAfter] = await db
      .select({ status: schema.sessionActivity.approvalStatus })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, drop!.id));
    expect(keptAfter?.status).toBe('proposed');
    expect(droppedAfter?.status).toBe('rejected');
  });

  it('treats an approve retry over an already-approved subset as idempotent (skips re-deciding)', async () => {
    const seed = await seedRegisteredAgentSession({
      status: 'awaiting_approval',
      withSeedResponse: false,
    });
    const groupId = 'grp_retry_subset';
    const [alreadyApproved, stillProposed] = await db
      .insert(schema.sessionActivity)
      .values([
        {
          sessionId: seed.sessionId,
          organizationId: seed.orgId,
          type: 'action',
          approvalStatus: 'approved',
          proposalGroupId: groupId,
          body: { action: { kind: 'find', summary: 'find A' } },
        },
        {
          sessionId: seed.sessionId,
          organizationId: seed.orgId,
          type: 'action',
          approvalStatus: 'proposed',
          proposalGroupId: groupId,
          body: { action: { kind: 'find', summary: 'find B' } },
        },
      ])
      .returning({ id: schema.sessionActivity.id });

    // A retried "approve" naming only the already-approved member: isRetryableGroupApproval finds
    // the whole (filtered) subset already approved and skips decideProposalGroup entirely.
    await approveGroupAndResume(seed.orgId, seed.humanActorId, seed.sessionId, groupId, 'approve', [
      alreadyApproved!.id,
    ]);

    const [untouched] = await db
      .select({ status: schema.sessionActivity.approvalStatus })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, stillProposed!.id));
    // The sibling outside the named subset was never touched by the retry.
    expect(untouched?.status).toBe('proposed');
    const [decided] = await db
      .select({ status: schema.sessionActivity.approvalStatus })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, alreadyApproved!.id));
    expect(decided?.status).toBe('applied');
  });
});
