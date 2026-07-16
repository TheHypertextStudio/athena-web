import { and, asc, eq, or } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn(async () => null);
vi.mock('@docket/auth', () => ({ auth: { api: { getSession } } }));

import type * as AgentRuntimeModule from '@docket/agent-runtime';
import type * as DbModule from '@docket/db';

import type {
  approveAndResume as ApproveAndResume,
  driveSession as DriveSession,
  executeApprovedActions as ExecuteApprovedActions,
  LoopDeps,
} from '../../src/agent/loop';
import type * as ToolboxModule from '../../src/agent/toolbox';
import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let runtime!: typeof AgentRuntimeModule;
let driveSession!: typeof DriveSession;
let approveAndResume!: typeof ApproveAndResume;
let executeApprovedActions!: typeof ExecuteApprovedActions;
let toolboxModule!: typeof ToolboxModule;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  runtime = await import('@docket/agent-runtime');
  ({ driveSession, approveAndResume, executeApprovedActions } =
    await import('../../src/agent/loop'));
  toolboxModule = await import('../../src/agent/toolbox');
});

interface Seed {
  readonly ownerUserId: string;
  readonly ownerActorId: string;
  readonly initiatorActorId: string;
  readonly roleId: string;
  readonly orgId: string;
  readonly teamId: string;
  readonly sessionId: string;
}

async function seedAthenaSession(
  approvalMode: 'ask_before_acting' | 'routine_autonomy',
): Promise<Seed> {
  const slug = `ul-${Math.random().toString(36).slice(2, 10)}`;
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
    .values({ name: 'Ada', email: `${slug}-owner@example.com` })
    .returning({ id: schema.user.id });
  await db.insert(schema.hub).values({
    userId: owner!.id,
    preferences: { athena: { approvalMode } },
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
  await db.insert(schema.grant).values({
    organizationId: org!.id,
    subjectKind: 'role',
    subjectId: role!.id,
    resourceKind: 'organization',
    resourceId: org!.id,
    capabilities: ['view', 'contribute'],
    effect: 'allow',
  });
  const [initiator] = await db
    .insert(schema.user)
    .values({ name: 'Grace', email: `${slug}-initiator@example.com` })
    .returning({ id: schema.user.id });
  const [initiatorActor] = await db
    .insert(schema.actor)
    .values({
      organizationId: org!.id,
      kind: 'human',
      displayName: 'Grace',
      userId: initiator!.id,
    })
    .returning({ id: schema.actor.id });
  const [team] = await db
    .insert(schema.team)
    .values({ organizationId: org!.id, name: 'Core', key: `U${slug.slice(-4)}` })
    .returning({ id: schema.team.id });
  const [session] = await db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: owner!.id,
      contextOrganizationId: org!.id,
      trigger: 'delegation',
      status: 'pending',
      initiatorId: initiatorActor!.id,
    })
    .returning({ id: schema.agentSession.id });
  await db.insert(schema.sessionActivity).values({
    sessionId: session!.id,
    organizationId: null,
    type: 'response',
    body: { text: 'Create the task.' },
  });
  return {
    ownerUserId: owner!.id,
    ownerActorId: ownerActor!.id,
    initiatorActorId: initiatorActor!.id,
    roleId: role!.id,
    orgId: org!.id,
    teamId: team!.id,
    sessionId: session!.id,
  };
}

function scriptedCreate(seed: Seed): LoopDeps {
  return {
    turnRuntime: new runtime.MockAgentTurnRuntime({
      script: [
        {
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_personal_create',
                name: 'create_task',
                input: { orgId: seed.orgId, teamId: seed.teamId, title: 'Owned by Ada' },
              },
            ],
          },
          stopReason: 'tool_use',
        },
        {
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Finished.' }],
          },
          stopReason: 'end_turn',
        },
      ],
    }),
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function blockingTurnRuntime(entered: Deferred<number>, release: Promise<void>): LoopDeps {
  let enteredCount = 0;
  const turnRuntime: AgentRuntimeModule.AgentTurnRuntime = {
    async *streamTurn(): AsyncIterable<AgentRuntimeModule.TurnEvent> {
      enteredCount += 1;
      entered.resolve(enteredCount);
      await release;
      yield {
        type: 'turn_end',
        stopReason: 'end_turn',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Finished.' }] },
      };
    },
  };
  return { turnRuntime };
}

describe('user-owned Athena loop', () => {
  it('acts as the persisted owner and audits the current human Actor with Athena origin', async () => {
    const seed = await seedAthenaSession('routine_autonomy');

    const settled = await driveSession(seed.orgId, seed.sessionId, scriptedCreate(seed));

    expect(settled.status).toBe('completed');
    const tasks = await db
      .select({ title: schema.task.title, createdBy: schema.task.createdBy })
      .from(schema.task)
      .where(eq(schema.task.organizationId, seed.orgId));
    expect(tasks).toEqual([{ title: 'Owned by Ada', createdBy: seed.ownerActorId }]);
    expect(tasks[0]?.createdBy).not.toBe(seed.initiatorActorId);

    const audits = await db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.organizationId, seed.orgId),
          eq(schema.auditEvent.subjectId, seed.sessionId),
        ),
      );
    const execution = audits.find((entry) => entry.metadata['tool'] === 'create_task');
    expect(execution?.actorId).toBe(seed.ownerActorId);
    expect(execution?.metadata).toMatchObject({
      executionOrigin: 'athena',
      athenaSessionId: seed.sessionId,
      requestedByUserId: seed.ownerUserId,
    });
    expect(await db.select().from(schema.agent)).toHaveLength(0);
    expect(await db.select().from(schema.actor).where(eq(schema.actor.kind, 'agent'))).toHaveLength(
      0,
    );
  });

  it('re-authorizes an approved tool call after the owner loses access', async () => {
    const seed = await seedAthenaSession('ask_before_acting');
    const deps = scriptedCreate(seed);
    const paused = await driveSession(seed.orgId, seed.sessionId, deps);
    expect(paused.status).toBe('awaiting_approval');
    const [action] = await db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, seed.sessionId),
          eq(schema.sessionActivity.type, 'action'),
        ),
      )
      .orderBy(asc(schema.sessionActivity.createdAt));

    await db
      .delete(schema.grant)
      .where(
        and(
          eq(schema.grant.organizationId, seed.orgId),
          eq(schema.grant.subjectKind, 'role'),
          eq(schema.grant.subjectId, seed.roleId),
        ),
      );

    const settled = await approveAndResume(
      seed.orgId,
      seed.ownerActorId,
      seed.sessionId,
      action!.id,
      { decision: 'approve' },
      deps,
    );
    expect(settled.status).toBe('completed');
    expect(
      await db.select().from(schema.task).where(eq(schema.task.organizationId, seed.orgId)),
    ).toHaveLength(0);
    const [applied] = await db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, action!.id));
    expect(applied?.approvalStatus).toBe('applied');
    expect(applied?.body.action?.result?.isError).toBe(true);
  });

  it('executes and audits a concurrently approved action at most once', async () => {
    const seed = await seedAthenaSession('ask_before_acting');
    const deps = scriptedCreate(seed);
    await driveSession(seed.orgId, seed.sessionId, deps);
    const [action] = await db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, seed.sessionId),
          eq(schema.sessionActivity.type, 'action'),
        ),
      );

    const outcomes = await Promise.allSettled([
      approveAndResume(
        seed.orgId,
        seed.ownerActorId,
        seed.sessionId,
        action!.id,
        { decision: 'approve' },
        deps,
      ),
      approveAndResume(
        seed.orgId,
        seed.ownerActorId,
        seed.sessionId,
        action!.id,
        { decision: 'approve' },
        deps,
      ),
    ]);

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(
      await db.select().from(schema.task).where(eq(schema.task.organizationId, seed.orgId)),
    ).toHaveLength(1);
    const approvals = await db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.subjectId, seed.sessionId),
          eq(schema.auditEvent.type, 'approved'),
        ),
      );
    expect(approvals).toHaveLength(1);
  });

  it('allows only one concurrent approve-or-reject decision and audit', async () => {
    const seed = await seedAthenaSession('ask_before_acting');
    const deps = scriptedCreate(seed);
    await driveSession(seed.orgId, seed.sessionId, deps);
    const [action] = await db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, seed.sessionId),
          eq(schema.sessionActivity.type, 'action'),
        ),
      );

    const outcomes = await Promise.allSettled([
      approveAndResume(
        seed.orgId,
        seed.ownerActorId,
        seed.sessionId,
        action!.id,
        { decision: 'approve' },
        deps,
      ),
      approveAndResume(
        seed.orgId,
        seed.ownerActorId,
        seed.sessionId,
        action!.id,
        { decision: 'reject' },
        deps,
      ),
    ]);

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const [decided] = await db
      .select({ status: schema.sessionActivity.approvalStatus })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, action!.id));
    expect(['applied', 'rejected']).toContain(decided?.status);
    const audits = await db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.subjectId, seed.sessionId),
          or(eq(schema.auditEvent.type, 'approved'), eq(schema.auditEvent.type, 'rejected')),
        ),
      );
    expect(audits).toHaveLength(1);
  });

  it('applies the owner admission ceiling again before approval execution resumes', async () => {
    const seed = await seedAthenaSession('ask_before_acting');
    const deps = scriptedCreate(seed);
    await driveSession(seed.orgId, seed.sessionId, deps);
    const [action] = await db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, seed.sessionId),
          eq(schema.sessionActivity.type, 'action'),
        ),
      );
    const activeSessions = await db
      .insert(schema.agentSession)
      .values(
        Array.from({ length: 8 }, () => ({
          executorKind: 'athena' as const,
          ownerUserId: seed.ownerUserId,
          contextOrganizationId: seed.orgId,
          trigger: 'delegation' as const,
          status: 'running' as const,
        })),
      )
      .returning({ id: schema.agentSession.id });
    await db.insert(schema.agentSessionRun).values(
      activeSessions.map(({ id }) => ({
        sessionId: id,
        ownerUserId: seed.ownerUserId,
        generation: 1,
        workflowInstanceId: `${id}:1`,
        status: 'running' as const,
        attempt: 1,
        leaseToken: `approval-slot-${id}`,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      })),
    );

    await expect(
      approveAndResume(
        seed.orgId,
        seed.ownerActorId,
        seed.sessionId,
        action!.id,
        { decision: 'approve' },
        deps,
      ),
    ).rejects.toThrow(/concurrent/i);

    const [approved] = await db
      .select({ status: schema.sessionActivity.approvalStatus })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, action!.id));
    expect(approved?.status).toBe('approved');
    expect(
      await db.select().from(schema.task).where(eq(schema.task.organizationId, seed.orgId)),
    ).toHaveLength(0);
  });

  it('does not automatically repeat a previously claimed action after recovery', async () => {
    const seed = await seedAthenaSession('ask_before_acting');
    const deps = scriptedCreate(seed);
    await driveSession(seed.orgId, seed.sessionId, deps);
    const [action] = await db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, seed.sessionId),
          eq(schema.sessionActivity.type, 'action'),
        ),
      );
    await db
      .update(schema.sessionActivity)
      .set({ approvalStatus: 'executing' })
      .where(eq(schema.sessionActivity.id, action!.id));
    await db
      .update(schema.agentSession)
      .set({ status: 'running' })
      .where(eq(schema.agentSession.id, seed.sessionId));

    const turnRuntime: AgentRuntimeModule.AgentTurnRuntime = {
      streamTurn(): AsyncIterable<AgentRuntimeModule.TurnEvent> {
        throw new Error('provider must not run while an action needs attention');
      },
    };
    const settled = await driveSession(seed.orgId, seed.sessionId, { turnRuntime });

    expect(settled.status).toBe('awaiting_approval');
    expect(
      await db.select().from(schema.task).where(eq(schema.task.organizationId, seed.orgId)),
    ).toHaveLength(0);
    const [stillClaimed] = await db
      .select({ status: schema.sessionActivity.approvalStatus })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, action!.id));
    expect(stillClaimed?.status).toBe('executing');
  });

  it('does not persist a stale tool result after the generation lease is fenced', async () => {
    const seed = await seedAthenaSession('routine_autonomy');
    await db
      .update(schema.agentSession)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(schema.agentSession.id, seed.sessionId));
    const leaseToken = 'original-worker';
    const [run] = await db
      .insert(schema.agentSessionRun)
      .values({
        sessionId: seed.sessionId,
        ownerUserId: seed.ownerUserId,
        generation: 1,
        workflowInstanceId: `${seed.sessionId}:1`,
        status: 'running',
        attempt: 1,
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      })
      .returning({ id: schema.agentSessionRun.id });
    const [action] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: seed.sessionId,
        organizationId: seed.orgId,
        type: 'action',
        approvalStatus: 'approved',
        body: {
          action: {
            kind: 'create_task',
            summary: 'Create a task',
            mode: 'proposal',
            toolCall: {
              connection: 'docket',
              tool: 'create_task',
              input: { orgId: seed.orgId, teamId: seed.teamId, title: 'Do not persist' },
              toolUseId: 'toolu_fenced_result',
            },
          },
        },
      })
      .returning({ id: schema.sessionActivity.id });
    const toolbox = vi.spyOn(toolboxModule, 'openToolbox').mockResolvedValue({
      tools: [],
      annotations: () => undefined,
      resolve: (name) => ({ connection: 'docket', rawName: name }),
      callTool: async () => {
        await db
          .update(schema.agentSessionRun)
          .set({ leaseToken: 'recovered-worker' })
          .where(eq(schema.agentSessionRun.id, run!.id));
        return { content: 'stale success', isError: false };
      },
      close: async () => undefined,
    });

    try {
      await expect(
        executeApprovedActions(seed.orgId, seed.sessionId, {
          runId: run!.id,
          sessionId: seed.sessionId,
          generation: 1,
          leaseToken,
          leaseDurationMs: 60_000,
        }),
      ).rejects.toThrow(/lease was lost/i);
    } finally {
      toolbox.mockRestore();
    }

    const [claimed] = await db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, action!.id));
    expect(claimed?.approvalStatus).toBe('executing');
    expect(claimed?.body.action?.result).toBeUndefined();
  });

  it('does not persist streamed activity after the generation lease is fenced', async () => {
    const seed = await seedAthenaSession('routine_autonomy');
    const turnRuntime: AgentRuntimeModule.AgentTurnRuntime = {
      async *streamTurn(): AsyncIterable<AgentRuntimeModule.TurnEvent> {
        await db
          .update(schema.agentSessionRun)
          .set({ leaseToken: 'recovered-stream-worker' })
          .where(eq(schema.agentSessionRun.sessionId, seed.sessionId));
        yield { type: 'thinking', text: 'stale provider event' };
        yield {
          type: 'turn_end',
          stopReason: 'end_turn',
          message: { role: 'assistant', content: [{ type: 'text', text: 'stale response' }] },
        };
      },
    };

    await expect(driveSession(seed.orgId, seed.sessionId, { turnRuntime })).rejects.toThrow(
      /lease was lost/i,
    );

    const stale = await db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, seed.sessionId),
          eq(schema.sessionActivity.type, 'thought'),
        ),
      );
    expect(stale).toHaveLength(0);
  });

  it('admits at most eight concurrent runs for one Athena owner by default', async () => {
    const seed = await seedAthenaSession('routine_autonomy');
    const activeSessions = await db
      .insert(schema.agentSession)
      .values(
        Array.from({ length: 8 }, () => ({
          executorKind: 'athena' as const,
          ownerUserId: seed.ownerUserId,
          contextOrganizationId: seed.orgId,
          trigger: 'delegation' as const,
          status: 'running' as const,
        })),
      )
      .returning({ id: schema.agentSession.id });
    await db.insert(schema.agentSessionRun).values(
      activeSessions.map(({ id }) => ({
        sessionId: id,
        ownerUserId: seed.ownerUserId,
        generation: 1,
        workflowInstanceId: `${id}:1`,
        status: 'running' as const,
        attempt: 1,
        leaseToken: `active-${id}`,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      })),
    );

    await expect(driveSession(seed.orgId, seed.sessionId, scriptedCreate(seed))).rejects.toThrow(
      /concurrent/i,
    );
    const [pending] = await db
      .select({ status: schema.agentSession.status })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, seed.sessionId));
    expect(pending?.status).toBe('pending');
  });

  it('serializes concurrent admission for distinct pending sessions owned by one user', async () => {
    const seed = await seedAthenaSession('routine_autonomy');
    const activeSessions = await db
      .insert(schema.agentSession)
      .values(
        Array.from({ length: 7 }, () => ({
          executorKind: 'athena' as const,
          ownerUserId: seed.ownerUserId,
          contextOrganizationId: seed.orgId,
          trigger: 'delegation' as const,
          status: 'running' as const,
        })),
      )
      .returning({ id: schema.agentSession.id });
    await db.insert(schema.agentSessionRun).values(
      activeSessions.map(({ id }) => ({
        sessionId: id,
        ownerUserId: seed.ownerUserId,
        generation: 1,
        workflowInstanceId: `${id}:1`,
        status: 'running' as const,
        attempt: 1,
        leaseToken: `active-${id}`,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      })),
    );
    const [second] = await db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: seed.ownerUserId,
        contextOrganizationId: seed.orgId,
        trigger: 'delegation',
        status: 'pending',
        initiatorId: seed.initiatorActorId,
      })
      .returning({ id: schema.agentSession.id });
    await db.insert(schema.sessionActivity).values({
      sessionId: second!.id,
      organizationId: null,
      type: 'response',
      body: { text: 'Create another task.' },
    });

    const entered = deferred<number>();
    const release = deferred<undefined>();
    const deps = blockingTurnRuntime(entered, release.promise);
    const firstRun = driveSession(seed.orgId, seed.sessionId, deps).then(
      (session) => ({ kind: 'fulfilled' as const, session }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    );
    const secondRun = driveSession(seed.orgId, second!.id, deps).then(
      (session) => ({ kind: 'fulfilled' as const, session }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    );

    await entered.promise;
    await Promise.race([firstRun, secondRun, new Promise((resolve) => setTimeout(resolve, 25))]);
    const admitted = await db
      .select({ status: schema.agentSession.status })
      .from(schema.agentSession)
      .where(
        or(eq(schema.agentSession.id, seed.sessionId), eq(schema.agentSession.id, second!.id)),
      );
    release.resolve(undefined);
    const outcomes = await Promise.all([firstRun, secondRun]);

    expect(admitted.map(({ status }) => status).sort()).toEqual(['pending', 'running']);
    expect(outcomes.filter(({ kind }) => kind === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find(({ kind }) => kind === 'rejected');
    expect(rejected).toMatchObject({ kind: 'rejected' });
    if (rejected?.kind === 'rejected') {
      expect(rejected.error).toMatchObject({ message: expect.stringMatching(/concurrent/i) });
    }
  });

  it('serializes duplicate run calls for the same session with one durable generation', async () => {
    const seed = await seedAthenaSession('routine_autonomy');
    const entered = deferred<number>();
    const release = deferred<undefined>();
    const deps = blockingTurnRuntime(entered, release.promise);

    const first = driveSession(seed.orgId, seed.sessionId, deps);
    await entered.promise;
    await expect(driveSession(seed.orgId, seed.sessionId, deps)).rejects.toThrow(
      /already running/i,
    );
    release.resolve(undefined);
    await expect(first).resolves.toMatchObject({ status: 'completed' });

    const runs = await db
      .select()
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.sessionId, seed.sessionId));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      generation: 1,
      workflowInstanceId: `${seed.sessionId}:1`,
      status: 'completed',
      attempt: 1,
    });
  });

  it('recovers an expired generation with a new fenced attempt instead of duplicating it', async () => {
    const seed = await seedAthenaSession('routine_autonomy');
    await db
      .update(schema.agentSession)
      .set({ status: 'running', startedAt: new Date(Date.now() - 120_000) })
      .where(eq(schema.agentSession.id, seed.sessionId));
    const [abandoned] = await db
      .insert(schema.agentSessionRun)
      .values({
        sessionId: seed.sessionId,
        ownerUserId: seed.ownerUserId,
        generation: 1,
        workflowInstanceId: `${seed.sessionId}:1`,
        status: 'running',
        attempt: 1,
        leaseToken: 'abandoned-worker',
        leaseExpiresAt: new Date(Date.now() - 1_000),
        startedAt: new Date(Date.now() - 120_000),
      })
      .returning({ id: schema.agentSessionRun.id });

    await driveSession(seed.orgId, seed.sessionId, {
      turnRuntime: new runtime.MockAgentTurnRuntime({
        script: [
          {
            message: { role: 'assistant', content: [{ type: 'text', text: 'Recovered.' }] },
            stopReason: 'end_turn',
          },
        ],
      }),
    });

    const runs = await db
      .select()
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.sessionId, seed.sessionId));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: abandoned!.id,
      generation: 1,
      attempt: 2,
      status: 'completed',
    });
    expect(runs[0]?.leaseToken).not.toBe('abandoned-worker');
  });

  it('renews a healthy generation lease while a provider turn remains in flight', async () => {
    const seed = await seedAthenaSession('routine_autonomy');
    const entered = deferred<number>();
    const release = deferred<undefined>();
    const running = driveSession(seed.orgId, seed.sessionId, {
      ...blockingTurnRuntime(entered, release.promise),
      leaseDurationMs: 5_000,
      heartbeatIntervalMs: 25,
    });
    try {
      await entered.promise;
      const [before] = await db
        .select({ expiresAt: schema.agentSessionRun.leaseExpiresAt })
        .from(schema.agentSessionRun)
        .where(eq(schema.agentSessionRun.sessionId, seed.sessionId));
      await new Promise((resolve) => setTimeout(resolve, 100));
      const [after] = await db
        .select({ expiresAt: schema.agentSessionRun.leaseExpiresAt })
        .from(schema.agentSessionRun)
        .where(eq(schema.agentSessionRun.sessionId, seed.sessionId));

      expect(after?.expiresAt?.getTime()).toBeGreaterThan(before?.expiresAt?.getTime() ?? 0);
    } finally {
      release.resolve(undefined);
    }
    await running;
  });

  it('settles the claimed generation when the provider fails unexpectedly', async () => {
    const seed = await seedAthenaSession('routine_autonomy');
    const turnRuntime: AgentRuntimeModule.AgentTurnRuntime = {
      async *streamTurn(): AsyncIterable<AgentRuntimeModule.TurnEvent> {
        yield await Promise.reject<AgentRuntimeModule.TurnEvent>(new Error('provider exploded'));
      },
    };

    await expect(driveSession(seed.orgId, seed.sessionId, { turnRuntime })).rejects.toThrow(
      'provider exploded',
    );

    const [session] = await db
      .select({ status: schema.agentSession.status })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, seed.sessionId));
    const [run] = await db
      .select({
        status: schema.agentSessionRun.status,
        lastError: schema.agentSessionRun.lastError,
      })
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.sessionId, seed.sessionId));
    expect(session?.status).toBe('failed');
    expect(run).toMatchObject({ status: 'failed', lastError: 'provider exploded' });
  });

  it('checkpoints personal work across generations instead of treating the turn quantum as a cap', async () => {
    const seed = await seedAthenaSession('routine_autonomy');
    const script: AgentRuntimeModule.ScriptedTurn[] = Array.from({ length: 5 }, (_, index) => ({
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: `toolu_generation_${index}`,
            name: 'search',
            input: { orgId: seed.orgId, query: `checkpoint ${index}` },
          },
        ],
      },
      stopReason: 'tool_use',
    }));
    script.push({
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'All generations finished.' }],
      },
      stopReason: 'end_turn',
    });

    const settled = await driveSession(seed.orgId, seed.sessionId, {
      turnRuntime: new runtime.MockAgentTurnRuntime({ script }),
      generationTurnQuantum: 2,
    });

    expect(settled.status).toBe('completed');
    const runs = await db
      .select()
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.sessionId, seed.sessionId))
      .orderBy(asc(schema.agentSessionRun.generation));
    expect(runs.map(({ generation, status }) => ({ generation, status }))).toEqual([
      { generation: 1, status: 'completed' },
      { generation: 2, status: 'completed' },
      { generation: 3, status: 'completed' },
    ]);
  });
});
