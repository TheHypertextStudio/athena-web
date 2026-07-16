import { and, asc, eq, or } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn(async () => null);
vi.mock('@docket/auth', () => ({ auth: { api: { getSession } } }));

import type * as AgentRuntimeModule from '@docket/agent-runtime';
import type * as DbModule from '@docket/db';

import type {
  approveAndResume as ApproveAndResume,
  driveSession as DriveSession,
  LoopDeps,
} from '../../src/agent/loop';
import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let runtime!: typeof AgentRuntimeModule;
let driveSession!: typeof DriveSession;
let approveAndResume!: typeof ApproveAndResume;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  runtime = await import('@docket/agent-runtime');
  ({ driveSession, approveAndResume } = await import('../../src/agent/loop'));
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

  it('admits at most eight concurrent runs for one Athena owner by default', async () => {
    const seed = await seedAthenaSession('routine_autonomy');
    await db.insert(schema.agentSession).values(
      Array.from({ length: 8 }, () => ({
        executorKind: 'athena' as const,
        ownerUserId: seed.ownerUserId,
        contextOrganizationId: seed.orgId,
        trigger: 'delegation' as const,
        status: 'running' as const,
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
    await db.insert(schema.agentSession).values(
      Array.from({ length: 7 }, () => ({
        executorKind: 'athena' as const,
        ownerUserId: seed.ownerUserId,
        contextOrganizationId: seed.orgId,
        trigger: 'delegation' as const,
        status: 'running' as const,
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
});
