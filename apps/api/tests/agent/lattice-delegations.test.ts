import * as authzModule from '@docket/authz';
import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { LatticeUnavailableError } from '@docket/integrations';
import { RelayControllerError } from '@lovelace-ai/lattice-relay-client';

vi.hoisted(() => {
  process.env['DATABASE_URL'] = 'pglite://memory://';
  process.env['APP_MODE'] = 'test';
  process.env['NODE_ENV'] = 'test';
  process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
  process.env['CRON_SECRET'] = 'test-cron-secret';
  process.env['SKIP_ENV_VALIDATION'] = '1';
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = Buffer.from('0'.repeat(32)).toString('base64');
});

import type * as DbModule from '@docket/db';

import type {
  cancelLatticeDelegation as CancelLatticeDelegation,
  LatticeDelegationDependencies,
  prepareLatticeAssignmentRun as PrepareLatticeAssignmentRun,
  sweepLatticeDelegations as SweepLatticeDelegations,
} from '../../src/agent/lattice-delegations';
import type { startAssignmentRun as StartAssignmentRun } from '../../src/agent/assignments';
import type { decideActivity as DecideActivity } from '../../src/routes/agent-session-approval';
import { getDb, one, seedStatuses } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let prepareLatticeAssignmentRun!: typeof PrepareLatticeAssignmentRun;
let sweepLatticeDelegationsImpl!: typeof SweepLatticeDelegations;
let cancelLatticeDelegation!: typeof CancelLatticeDelegation;
let startAssignmentRun!: typeof StartAssignmentRun;
let decideActivity!: typeof DecideActivity;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  ({
    cancelLatticeDelegation,
    prepareLatticeAssignmentRun,
    sweepLatticeDelegations: sweepLatticeDelegationsImpl,
  } = await import('../../src/agent/lattice-delegations'));
  ({ startAssignmentRun } = await import('../../src/agent/assignments'));
  ({ decideActivity } = await import('../../src/routes/agent-session-approval'));
});

const ENABLED_SWEEP = { pollingEnabled: true, submissionsEnabled: true } as const;

function sweepLatticeDelegations(
  now: Parameters<typeof SweepLatticeDelegations>[0],
  deps: Parameters<typeof SweepLatticeDelegations>[1],
  options: Parameters<typeof SweepLatticeDelegations>[2] = ENABLED_SWEEP,
) {
  return sweepLatticeDelegationsImpl(now, deps, options);
}

async function seed() {
  const suffix = Math.random().toString(36).slice(2, 10);
  const organization = one(
    await db
      .insert(schema.organization)
      .values({
        name: `Delegation ${suffix}`,
        slug: `delegation-${suffix}`,
        lifecycleState: 'active',
      })
      .returning({ id: schema.organization.id }),
  );
  const statusId = await seedStatuses(db, schema, organization.id);
  const role = one(
    await db
      .insert(schema.role)
      .values({
        organizationId: organization.id,
        key: `member-${suffix}`,
        name: 'Member',
        capabilities: ['view', 'contribute'],
      })
      .returning({ id: schema.role.id }),
  );
  const owner = one(
    await db
      .insert(schema.user)
      .values({ name: 'Owner', email: `owner-${suffix}@example.com` })
      .returning({ id: schema.user.id }),
  );
  const ownerActor = one(
    await db
      .insert(schema.actor)
      .values({
        organizationId: organization.id,
        kind: 'human',
        displayName: 'Owner',
        userId: owner.id,
        roleId: role.id,
      })
      .returning({ id: schema.actor.id }),
  );
  await db.insert(schema.grant).values({
    organizationId: organization.id,
    subjectKind: 'role',
    subjectId: role.id,
    resourceKind: 'organization',
    resourceId: organization.id,
    capabilities: ['view', 'contribute'],
  });
  const team = one(
    await db
      .insert(schema.team)
      .values({ organizationId: organization.id, name: 'Core', key: `D${suffix.slice(0, 4)}` })
      .returning({ id: schema.team.id }),
  );
  const project = one(
    await db
      .insert(schema.project)
      .values({
        organizationId: organization.id,
        name: 'Lattice proof',
        status: 'active',
        statusId: statusId('project', 'active'),
        teamId: team.id,
        leadId: ownerActor.id,
        createdBy: ownerActor.id,
      })
      .returning({ id: schema.project.id }),
  );
  const targetTask = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: organization.id,
        teamId: team.id,
        projectId: project.id,
        title: 'Prove the round trip',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        assigneeId: ownerActor.id,
        createdBy: ownerActor.id,
      })
      .returning({ id: schema.task.id }),
  );
  const connection = one(
    await db
      .insert(schema.latticeConnection)
      .values({
        ownerUserId: owner.id,
        status: 'connected',
        enabled: true,
        deviceId: 'lat_mac_studio',
        deviceName: 'Mac Studio',
        deviceStatus: 'reachable',
        accountId: 'acct_owner',
      })
      .returning(),
  );
  const assignment = one(
    await db
      .insert(schema.athenaAssignment)
      .values({
        ownerUserId: owner.id,
        organizationId: organization.id,
        entityType: 'task',
        entityId: targetTask.id,
        objective: 'Analyze the task and return one useful recommendation.',
      })
      .returning(),
  );
  return {
    owner,
    ownerActor,
    organization,
    project,
    targetTask,
    connection,
    assignment,
  };
}

function dependencies(): LatticeDelegationDependencies & {
  readonly submitted: Record<string, unknown>[];
  pollResult: Awaited<ReturnType<LatticeDelegationDependencies['pollEvents']>>;
} {
  const submitted: Record<string, unknown>[] = [];
  let pollResult: Awaited<ReturnType<LatticeDelegationDependencies['pollEvents']>> = {
    workId: 'work_unset',
    state: 'queued',
    events: [],
    nextPollAfterMs: 1_000,
  };
  const deps: LatticeDelegationDependencies & {
    readonly submitted: Record<string, unknown>[];
    pollResult: Awaited<ReturnType<LatticeDelegationDependencies['pollEvents']>>;
  } = {
    submitted,
    get pollResult() {
      return pollResult;
    },
    set pollResult(value) {
      pollResult = value;
    },
    generateReplyKey: vi.fn(async (keyId) => ({
      keyId,
      publicKey: 'reply-public',
      privateKey: 'reply-private',
    })),
    buildAgentTaskCommand: vi.fn((input) => ({
      kind: 'agent_runtime_command',
      schemaVersion: 2,
      ...input,
    })),
    listRuntimes: vi.fn(async () => [
      {
        latticeId: 'lat_mac_studio',
        accountId: 'acct_owner',
        displayName: 'Mac Studio',
        reachability: 'reachable' as const,
        protocolVersion: 1,
        capabilities: { agentRuntime: true, streamingProgress: true, cancellation: true },
        workKeys: [
          {
            keyId: 'work-key-1',
            publicKey: 'runtime-public',
            notBefore: '2026-08-01T00:00:00.000Z',
            notAfter: '2026-09-30T00:00:00.000Z',
          },
        ],
      },
    ]),
    submitWork: vi.fn(async (_connection, input) => {
      submitted.push(input);
      return { workId: input.workId, state: 'queued' as const };
    }),
    pollEvents: vi.fn(async (_connection, workId) => ({ ...pollResult, workId })),
    openWork: vi.fn(async () => ({
      providerId: 'agent-runtime',
      model: 'poolside/laguna-s-2.1',
      outputText: 'Use the existing task history to narrow the next milestone.',
    })),
    cancelWork: vi.fn(async () => ({ state: 'cancelled' as const })),
    acknowledgeResult: vi.fn(async () => ({
      state: 'completed' as const,
      acknowledgedAt: '2026-08-29T18:00:06.002Z',
    })),
  };
  return deps;
}

async function prepareProposedResult(
  fixture: Awaited<ReturnType<typeof seed>>,
  deps: ReturnType<typeof dependencies>,
  preparedAt: Date,
) {
  const sessionId = await prepareLatticeAssignmentRun(
    fixture.assignment,
    fixture.ownerActor.id,
    fixture.assignment.objective,
    `athena-assignment:${fixture.assignment.id}:proposal-lifecycle`,
    fixture.connection,
    preparedAt,
    deps,
  );
  await sweepLatticeDelegations(preparedAt, deps);
  const submitted = one(
    await db
      .select()
      .from(schema.agentDelegation)
      .where(eq(schema.agentDelegation.sessionId, sessionId)),
  );
  deps.pollResult = {
    workId: submitted.workId,
    state: 'completed',
    events: [
      {
        cursor: 'cursor_final',
        kind: 'result',
        outcome: 'completed',
        sealed: {
          version: 'relay-v1',
          ephemeralPublicKey: 'ephemeral',
          salt: 'salt',
          iv: 'iv',
          ciphertext: 'ciphertext',
        },
      },
    ],
    nextPollAfterMs: 0,
  };
  await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps);
  const delegation = one(
    await db
      .select()
      .from(schema.agentDelegation)
      .where(eq(schema.agentDelegation.id, submitted.id)),
  );
  if (!delegation.returnedActivityId) throw new Error('Expected a returned proposal activity');
  const activity = one(
    await db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, delegation.returnedActivityId)),
  );
  return { activity, delegation, sessionId };
}

async function invalidateConnection(connectionId: string): Promise<void> {
  await db
    .update(schema.latticeConnection)
    .set({
      status: 'disconnected',
      enabled: true,
      accountId: 'acct_relinked',
      deviceId: 'lat_relinked',
    })
    .where(eq(schema.latticeConnection.id, connectionId));
}

describe('durable Lattice assignment delegations', () => {
  it('routes an enabled assignment to Lattice without admitting Docket generation', async () => {
    const fixture = await seed();
    const deps = dependencies();
    vi.mocked(deps.submitWork).mockImplementation(async (_connection, input) => ({
      workId: input.workId,
      state: 'offline_queued',
      queuePosition: 4,
      lastSeenAt: '2026-08-29T17:59:00.000Z',
    }));

    const sessionId = await startAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:initial`,
      deps,
    );
    const retriedSessionId = await startAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:retry`,
      deps,
    );
    expect(retriedSessionId).toBe(sessionId);

    const session = one(
      await db.select().from(schema.agentSession).where(eq(schema.agentSession.id, sessionId)),
    );
    expect(session).toMatchObject({ executionSurface: 'lattice', status: 'pending' });
    expect(
      await db
        .select()
        .from(schema.agentSessionRun)
        .where(eq(schema.agentSessionRun.sessionId, sessionId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.agentSession)
        .where(
          and(
            eq(schema.agentSession.ownerUserId, fixture.owner.id),
            eq(schema.agentSession.trigger, 'assignment'),
          ),
        ),
    ).toHaveLength(1);
    const submittedAt = new Date(Date.now() + 1_000);
    await sweepLatticeDelegations(submittedAt, deps);
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({
      status: 'submitted',
      workState: 'offline_queued',
      runtimeName: 'Mac Studio',
      runtimeReachability: 'reachable',
      runtimeLastSeenAt: new Date('2026-08-29T17:59:00.000Z'),
      relayQueuePosition: 4,
    });
    expect(
      one(await db.select().from(schema.agentSession).where(eq(schema.agentSession.id, sessionId))),
    ).toMatchObject({
      status: 'running',
      currentStep: 'Queued until the selected Lattice runtime comes online',
    });
    expect(
      await db
        .select()
        .from(schema.agentSessionRun)
        .where(eq(schema.agentSessionRun.sessionId, sessionId)),
    ).toHaveLength(0);
    await cancelLatticeDelegation(fixture.owner.id, sessionId, submittedAt, deps);
  });

  it('stores stable work identity and the reply key before submission, then proposes one task comment', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T18:00:00.000Z');

    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:initial`,
      fixture.connection,
      preparedAt,
      deps,
    );
    const prepared = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    expect(prepared).toMatchObject({
      status: 'prepared',
      runtimeId: 'lat_mac_studio',
      connectionId: fixture.connection.id,
      replyKeyCiphertext: expect.any(String),
    });
    expect(prepared.workId).toMatch(/^work_/u);
    expect(prepared.logicalSubmissionId).toBe(`athena:${prepared.id}`);
    expect(deps.submitWork).not.toHaveBeenCalled();

    await sweepLatticeDelegations(preparedAt, deps);
    await sweepLatticeDelegations(preparedAt, deps);
    expect(deps.submitWork).toHaveBeenCalledTimes(1);
    expect(deps.submitted[0]).toMatchObject({
      workId: prepared.workId,
      logicalSubmissionId: prepared.logicalSubmissionId,
      latticeId: 'lat_mac_studio',
    });
    expect(deps.buildAgentTaskCommand).toHaveBeenCalledWith({
      instruction: fixture.assignment.objective,
      logicalSubmissionId: prepared.logicalSubmissionId,
      replyPublicKey: 'reply-public',
      deadlineAt: prepared.deadlineAt,
      toolPolicy: [],
      executionMode: 'standard',
      input: {
        organizationId: fixture.organization.id,
        taskId: fixture.targetTask.id,
        assignmentId: fixture.assignment.id,
      },
      metadata: {
        docketDelegationId: prepared.id,
        docketSessionId: sessionId,
        docketTaskId: fixture.targetTask.id,
        docketAssignmentId: fixture.assignment.id,
      },
      model: 'poolside/laguna-s-2.1',
    });

    deps.pollResult = {
      workId: prepared.workId,
      state: 'completed',
      events: [
        {
          cursor: 'cursor_final',
          kind: 'result',
          outcome: 'completed' as const,
          sealed: {
            version: 'relay-v1',
            ephemeralPublicKey: 'ephemeral',
            salt: 'salt',
            iv: 'iv',
            ciphertext: 'ciphertext',
          },
        },
      ],
      nextPollAfterMs: 0,
    };
    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps);

    const proposedDelegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.id, prepared.id)),
    );
    expect(proposedDelegation).toMatchObject({
      status: 'proposed',
      workState: 'completed',
      relayCursor: 'cursor_final',
      replyKeyCiphertext: expect.any(String),
      returnedActivityId: expect.any(String),
      terminalOutcome: {
        outcome: 'completed',
        payload: {
          model: 'poolside/laguna-s-2.1',
          outputText: 'Use the existing task history to narrow the next milestone.',
        },
      },
      resultAcknowledgedAt: null,
    });
    expect(deps.acknowledgeResult).not.toHaveBeenCalled();
    const proposals = await db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, sessionId),
          eq(schema.sessionActivity.type, 'action'),
        ),
      );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      id: proposedDelegation.returnedActivityId,
      approvalStatus: 'proposed',
      organizationId: fixture.organization.id,
      body: {
        lattice: {
          delegationId: proposedDelegation.id,
          logicalSubmissionId: proposedDelegation.logicalSubmissionId,
          workId: proposedDelegation.workId,
          runtimeId: 'lat_mac_studio',
          runtimeName: 'Mac Studio',
          outcome: 'completed' as const,
        },
        action: {
          kind: 'comment',
          mode: 'proposal',
          toolCall: {
            connection: 'docket',
            tool: 'comment',
            input: {
              orgId: fixture.organization.id,
              subjectType: 'task',
              subjectId: fixture.targetTask.id,
              body: 'Use the existing task history to narrow the next milestone.',
            },
          },
        },
      },
    });
    expect(
      one(await db.select().from(schema.agentSession).where(eq(schema.agentSession.id, sessionId))),
    ).toMatchObject({ executionSurface: 'lattice', status: 'awaiting_approval' });

    const proposal = one(proposals);
    await decideActivity(fixture.organization.id, fixture.ownerActor.id, sessionId, proposal.id, {
      decision: 'approve',
    });

    const settled = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.id, prepared.id)),
    );
    expect(settled).toMatchObject({
      status: 'completed',
      failureCode: null,
      replyKeyCiphertext: null,
      resultAcknowledgedAt: null,
    });
    expect(
      one(
        await db
          .select()
          .from(schema.sessionActivity)
          .where(eq(schema.sessionActivity.id, proposal.id)),
      ),
    ).toMatchObject({
      approvalStatus: 'applied',
      body: { action: { result: { isError: false } } },
    });
    expect(
      await db
        .select()
        .from(schema.comment)
        .where(
          and(
            eq(schema.comment.subjectType, 'task'),
            eq(schema.comment.subjectId, fixture.targetTask.id),
          ),
        ),
    ).toHaveLength(1);
    expect(
      one(await db.select().from(schema.agentSession).where(eq(schema.agentSession.id, sessionId))),
    ).toMatchObject({
      status: 'completed',
      endedAt: expect.any(Date),
      currentStep: 'The Lattice result was added to the assigned task',
    });

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 7_003), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, prepared.id)),
      ),
    ).toMatchObject({ status: 'completed', resultAcknowledgedAt: expect.any(Date) });
    expect(deps.acknowledgeResult).toHaveBeenCalledWith(fixture.connection, prepared.workId);
  });

  it('settles a rejected result with its parent session before scheduler reconciliation', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const decidedAt = new Date('2026-08-29T18:10:00.000Z');
    const proposed = await prepareProposedResult(fixture, deps, decidedAt);

    await decideActivity(
      fixture.organization.id,
      fixture.ownerActor.id,
      proposed.sessionId,
      proposed.activity.id,
      { decision: 'reject' },
    );

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, proposed.delegation.id)),
      ),
    ).toMatchObject({
      status: 'canceled',
      replyKeyCiphertext: null,
      resultAcknowledgedAt: null,
    });
    expect(
      one(
        await db
          .select()
          .from(schema.agentSession)
          .where(eq(schema.agentSession.id, proposed.sessionId)),
      ),
    ).toMatchObject({ status: 'canceled', endedAt: expect.any(Date) });
    expect(
      await db
        .select()
        .from(schema.comment)
        .where(eq(schema.comment.subjectId, fixture.targetTask.id)),
    ).toHaveLength(0);
    expect(deps.acknowledgeResult).not.toHaveBeenCalled();
  });

  it('settles an invalid approved result as task_comment_failed in the decision transaction', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const proposed = await prepareProposedResult(
      fixture,
      deps,
      new Date('2026-08-29T18:11:00.000Z'),
    );
    const action = proposed.activity.body.action;
    if (!action?.toolCall || typeof action.toolCall.input !== 'object') {
      throw new Error('Expected a proposed Lattice comment');
    }
    await db
      .update(schema.sessionActivity)
      .set({
        body: {
          ...proposed.activity.body,
          action: {
            ...action,
            toolCall: {
              ...action.toolCall,
              input: { ...(action.toolCall.input as Record<string, unknown>), body: '' },
            },
          },
        },
      })
      .where(eq(schema.sessionActivity.id, proposed.activity.id));

    await decideActivity(
      fixture.organization.id,
      fixture.ownerActor.id,
      proposed.sessionId,
      proposed.activity.id,
      { decision: 'approve' },
    );

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, proposed.delegation.id)),
      ),
    ).toMatchObject({
      status: 'failed',
      failureCode: 'task_comment_failed',
      replyKeyCiphertext: null,
    });
    expect(
      one(
        await db
          .select()
          .from(schema.agentSession)
          .where(eq(schema.agentSession.id, proposed.sessionId)),
      ),
    ).toMatchObject({ status: 'failed', endedAt: expect.any(Date) });
    expect(
      one(
        await db
          .select()
          .from(schema.sessionActivity)
          .where(eq(schema.sessionActivity.id, proposed.activity.id)),
      ),
    ).toMatchObject({ approvalStatus: 'applied', body: { action: { result: { isError: true } } } });
    expect(
      await db
        .select()
        .from(schema.comment)
        .where(eq(schema.comment.subjectId, fixture.targetTask.id)),
    ).toHaveLength(0);
  });

  it('settles an actual comment insert error without rolling back the decision', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const proposed = await prepareProposedResult(
      fixture,
      deps,
      new Date('2026-08-29T18:11:30.000Z'),
    );
    const constraintName = `comment_lattice_insert_failure_${Math.random().toString(36).slice(2)}`;
    await db.execute(
      sql.raw(
        `ALTER TABLE "comment" ADD CONSTRAINT "${constraintName}" CHECK (` +
          `"body" <> 'Use the existing task history to narrow the next milestone.') NOT VALID`,
      ),
    );

    try {
      await expect(
        decideActivity(
          fixture.organization.id,
          fixture.ownerActor.id,
          proposed.sessionId,
          proposed.activity.id,
          { decision: 'approve' },
        ),
      ).resolves.toMatchObject({
        approvalStatus: 'applied',
        body: { action: { result: { isError: true } } },
      });
    } finally {
      await db.execute(sql.raw(`ALTER TABLE "comment" DROP CONSTRAINT "${constraintName}"`));
    }

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, proposed.delegation.id)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'task_comment_failed' });
    expect(
      one(
        await db
          .select()
          .from(schema.agentSession)
          .where(eq(schema.agentSession.id, proposed.sessionId)),
      ),
    ).toMatchObject({ status: 'failed', endedAt: expect.any(Date) });
    expect(
      await db
        .select()
        .from(schema.comment)
        .where(eq(schema.comment.subjectId, fixture.targetTask.id)),
    ).toHaveLength(0);
  });

  it('settles access loss inside result approval without writing a task comment', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const proposed = await prepareProposedResult(
      fixture,
      deps,
      new Date('2026-08-29T18:12:00.000Z'),
    );
    await db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(eq(schema.actor.id, fixture.ownerActor.id));

    await decideActivity(
      fixture.organization.id,
      fixture.ownerActor.id,
      proposed.sessionId,
      proposed.activity.id,
      { decision: 'approve' },
    );

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, proposed.delegation.id)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'access_lost' });
    expect(
      await db
        .select()
        .from(schema.comment)
        .where(eq(schema.comment.subjectId, fixture.targetTask.id)),
    ).toHaveLength(0);
  });

  it.each([
    { condition: 'disabled', update: { enabled: false } },
    { condition: 'disconnected', update: { status: 'disconnected' as const } },
    { condition: 'retargeted', update: { deviceId: 'lat_retargeted' } },
  ])(
    'settles when the Lattice connection is $condition inside result approval',
    async ({ update }) => {
      const fixture = await seed();
      const deps = dependencies();
      const proposed = await prepareProposedResult(
        fixture,
        deps,
        new Date('2026-08-29T18:12:30.000Z'),
      );
      const realCanActor = authzModule.canActor;
      const canActor = vi.spyOn(authzModule, 'canActor').mockImplementation(async (...args) => {
        const result = await realCanActor(...args);
        const handle = args[3];
        await handle
          .update(schema.latticeConnection)
          .set(update)
          .where(eq(schema.latticeConnection.id, fixture.connection.id));
        return result;
      });

      try {
        await decideActivity(
          fixture.organization.id,
          fixture.ownerActor.id,
          proposed.sessionId,
          proposed.activity.id,
          { decision: 'approve' },
        );
      } finally {
        canActor.mockRestore();
      }

      expect(
        one(
          await db
            .select()
            .from(schema.agentDelegation)
            .where(eq(schema.agentDelegation.id, proposed.delegation.id)),
        ),
      ).toMatchObject({ status: 'failed', failureCode: 'oauth_invalid' });
      expect(
        one(
          await db
            .select()
            .from(schema.agentSession)
            .where(eq(schema.agentSession.id, proposed.sessionId)),
        ),
      ).toMatchObject({ status: 'failed', endedAt: expect.any(Date) });
      expect(
        one(
          await db
            .select()
            .from(schema.sessionActivity)
            .where(eq(schema.sessionActivity.id, proposed.activity.id)),
        ),
      ).toMatchObject({
        approvalStatus: 'applied',
        body: { action: { result: { isError: true } } },
      });
      expect(
        await db
          .select()
          .from(schema.comment)
          .where(eq(schema.comment.subjectId, fixture.targetTask.id)),
      ).toHaveLength(0);
    },
  );

  it('does not reconcile decided proposals while polling is disabled', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const proposed = await prepareProposedResult(
      fixture,
      deps,
      new Date('2026-08-29T18:13:00.000Z'),
    );
    await db
      .update(schema.sessionActivity)
      .set({ approvalStatus: 'rejected' })
      .where(eq(schema.sessionActivity.id, proposed.activity.id));

    await sweepLatticeDelegations(new Date('2026-08-29T18:13:10.000Z'), deps, {
      pollingEnabled: false,
      submissionsEnabled: false,
    });

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, proposed.delegation.id)),
      ),
    ).toMatchObject({ status: 'proposed', resultAcknowledgedAt: null });
    expect(deps.acknowledgeResult).not.toHaveBeenCalled();
  });

  it('stops submission and polling independently without changing delegation state', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T18:15:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:rollback-controls`,
      fixture.connection,
      preparedAt,
      deps,
    );

    await sweepLatticeDelegations(preparedAt, deps, {
      pollingEnabled: false,
      submissionsEnabled: false,
    });
    expect(deps.submitWork).not.toHaveBeenCalled();
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ).status,
    ).toBe('prepared');

    await sweepLatticeDelegations(preparedAt, deps, {
      pollingEnabled: false,
      submissionsEnabled: true,
    });
    const submitted = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    expect(submitted.status).toBe('submitted');
    deps.pollResult = {
      workId: submitted.workId,
      state: 'completed',
      events: [
        {
          cursor: 'cursor_final',
          kind: 'result',
          outcome: 'completed' as const,
          sealed: {
            version: 'relay-v1',
            ephemeralPublicKey: 'ephemeral',
            salt: 'salt',
            iv: 'iv',
            ciphertext: 'ciphertext',
          },
        },
      ],
      nextPollAfterMs: 0,
    };

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps, {
      pollingEnabled: false,
      submissionsEnabled: true,
    });
    expect(deps.pollEvents).not.toHaveBeenCalled();
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, submitted.id)),
      ).status,
    ).toBe('submitted');

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 6_002), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });
    expect(deps.pollEvents).toHaveBeenCalledTimes(1);
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, submitted.id)),
      ).status,
    ).toBe('proposed');
  });

  it('requires both emergency controls at the scheduler boundary', async () => {
    const deps = dependencies();

    await expect(
      sweepLatticeDelegationsImpl(new Date('2026-08-29T18:40:00.000Z'), deps, undefined as never),
    ).rejects.toThrow('Lattice scheduler controls are required');
  });

  it('claims a prepared delegation before a concurrent scheduler can submit it', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T18:42:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:concurrent-sweep`,
      fixture.connection,
      preparedAt,
      deps,
    );
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    let releaseFirst!: () => void;
    let markFirstEntered!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      markFirstEntered = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let targetCalls = 0;
    vi.mocked(deps.submitWork).mockImplementation(async (_connection, input) => {
      if (input.workId === delegation.workId) {
        targetCalls += 1;
        if (targetCalls === 1) {
          markFirstEntered();
          await firstRelease;
        }
      }
      return { workId: input.workId, state: 'queued' };
    });
    const controls = { pollingEnabled: false, submissionsEnabled: true } as const;

    const firstSweep = sweepLatticeDelegations(preparedAt, deps, controls);
    await firstEntered;
    await sweepLatticeDelegations(preparedAt, deps, controls);
    releaseFirst();
    await firstSweep;

    expect(targetCalls).toBe(1);
  });

  it('keeps the submission fence through the controller deadline after thirty seconds', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T18:43:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:deadline-fence`,
      fixture.connection,
      preparedAt,
      deps,
    );
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    let releaseFirst!: () => void;
    let markFirstEntered!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      markFirstEntered = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let targetCalls = 0;
    vi.mocked(deps.submitWork).mockImplementation(async (_connection, input) => {
      if (input.workId === delegation.workId) {
        targetCalls += 1;
        if (targetCalls === 1) {
          markFirstEntered();
          await firstRelease;
        }
      }
      return { workId: input.workId, state: 'queued' };
    });
    const controls = { pollingEnabled: false, submissionsEnabled: true } as const;

    const firstSweep = sweepLatticeDelegations(preparedAt, deps, controls);
    await firstEntered;
    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 30_001), deps, controls);
    releaseFirst();
    await firstSweep;

    expect(targetCalls).toBe(1);
  });

  it('does not let a stale controller failure overwrite deadline settlement', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T18:43:30.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:stale-controller-failure`,
      fixture.connection,
      preparedAt,
      deps,
    );
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    if (!delegation.deadlineAt) throw new Error('Expected a controller deadline');
    let releaseFirst!: () => void;
    let markFirstEntered!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      markFirstEntered = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let targetCalls = 0;
    vi.mocked(deps.submitWork).mockImplementation(async (_connection, input) => {
      if (input.workId === delegation.workId) {
        targetCalls += 1;
        markFirstEntered();
        await firstRelease;
        throw new Error('stale controller timeout');
      }
      return { workId: input.workId, state: 'queued' };
    });
    const controls = { pollingEnabled: false, submissionsEnabled: true } as const;

    const firstSweep = sweepLatticeDelegations(preparedAt, deps, controls);
    await firstEntered;
    await sweepLatticeDelegations(
      new Date(delegation.deadlineAt.getTime() + 5_001),
      deps,
      controls,
    );
    releaseFirst();
    await firstSweep;

    expect(targetCalls).toBe(1);
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'work_expired', nextPollAt: null });
    expect(
      one(await db.select().from(schema.agentSession).where(eq(schema.agentSession.id, sessionId))),
    ).toMatchObject({
      status: 'failed',
      currentStep: 'Athena did not receive the Lattice result before it expired.',
    });
  });

  it('uses controller retry pacing and preserves the selected runtime metadata', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T18:44:00.000Z');
    vi.mocked(deps.listRuntimes).mockResolvedValue([
      {
        latticeId: 'lat_mac_studio',
        accountId: 'acct_owner',
        displayName: 'Mac Studio',
        reachability: 'unreachable',
        lastSeenAt: '2026-08-29T18:43:00.000Z',
        protocolVersion: 1,
        capabilities: { agentRuntime: true, streamingProgress: true, cancellation: true },
        workKeys: [
          {
            keyId: 'work-key-1',
            publicKey: 'runtime-public',
            notBefore: '2026-08-01T00:00:00.000Z',
            notAfter: '2026-09-30T00:00:00.000Z',
          },
        ],
      },
    ]);
    vi.mocked(deps.submitWork).mockResolvedValue({
      workId: '',
      state: 'rate_limited',
      retryAfterMs: 13_750,
    });
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:controller-pacing`,
      fixture.connection,
      preparedAt,
      deps,
    );

    await sweepLatticeDelegations(preparedAt, deps, {
      pollingEnabled: false,
      submissionsEnabled: true,
    });

    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    expect(delegation).toMatchObject({
      status: 'prepared',
      workState: 'rate_limited',
      nextPollAt: new Date(preparedAt.getTime() + 13_750),
      runtimeName: 'Mac Studio',
      runtimeReachability: 'unreachable',
      runtimeLastSeenAt: new Date('2026-08-29T18:43:00.000Z'),
      relayQueuePosition: null,
    });
  });

  it('rejects a proposed result without deleting its activity history', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const proposed = await prepareProposedResult(
      fixture,
      deps,
      new Date('2026-08-29T18:45:00.000Z'),
    );

    await decideActivity(
      fixture.organization.id,
      fixture.ownerActor.id,
      proposed.sessionId,
      proposed.activity.id,
      { decision: 'reject' },
    );
    await sweepLatticeDelegations(new Date('2026-08-29T18:45:07.000Z'), deps, {
      pollingEnabled: false,
      submissionsEnabled: false,
    });

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, proposed.delegation.id)),
      ),
    ).toMatchObject({ status: 'canceled', returnedActivityId: null });
    expect(
      one(
        await db
          .select()
          .from(schema.sessionActivity)
          .where(eq(schema.sessionActivity.id, proposed.activity.id)),
      ),
    ).toMatchObject({ approvalStatus: 'rejected' });
    expect(
      one(
        await db
          .select()
          .from(schema.agentSession)
          .where(eq(schema.agentSession.id, proposed.sessionId)),
      ),
    ).toMatchObject({
      status: 'canceled',
      endedAt: expect.any(Date),
      currentStep: 'The Lattice result was rejected',
    });
  });

  it('completes a Lattice delegation once its task comment is applied', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const proposed = await prepareProposedResult(
      fixture,
      deps,
      new Date('2026-08-29T18:49:00.000Z'),
    );
    const action = proposed.activity.body.action;
    if (!action) throw new Error('Expected a proposed action');
    await db
      .update(schema.sessionActivity)
      .set({
        approvalStatus: 'applied',
        body: {
          ...proposed.activity.body,
          action: { ...action, result: { content: 'Comment created', isError: false } },
        },
      })
      .where(eq(schema.sessionActivity.id, proposed.activity.id));

    await sweepLatticeDelegations(new Date('2026-08-29T18:49:07.000Z'), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, proposed.delegation.id)),
      ),
    ).toMatchObject({
      status: 'completed',
      failureCode: null,
      replyKeyCiphertext: null,
      settledAt: expect.any(Date),
    });
    expect(
      one(
        await db
          .select()
          .from(schema.agentSession)
          .where(eq(schema.agentSession.id, proposed.sessionId)),
      ),
    ).toMatchObject({ status: 'completed', endedAt: expect.any(Date) });
  });

  it('completes an approved delegation whose activity records no action result', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const proposed = await prepareProposedResult(
      fixture,
      deps,
      new Date('2026-08-29T18:48:00.000Z'),
    );
    await db
      .update(schema.sessionActivity)
      .set({ approvalStatus: 'applied', body: { text: 'applied elsewhere' } })
      .where(eq(schema.sessionActivity.id, proposed.activity.id));

    await sweepLatticeDelegations(new Date('2026-08-29T18:48:07.000Z'), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, proposed.delegation.id)),
      ),
    ).toMatchObject({ status: 'completed', failureCode: null });
  });

  it('writes nothing when the submission lease changes hands mid-call', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:56:40.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:lease-changed-mid-submit`,
      fixture.connection,
      preparedAt,
      deps,
    );
    vi.mocked(deps.submitWork).mockImplementation(async (_connection, input) => {
      await db
        .update(schema.agentDelegation)
        .set({
          submissionLeaseToken: 'a-newer-lease',
          submissionLeaseExpiresAt: new Date(preparedAt.getTime() + 60_000),
        })
        .where(eq(schema.agentDelegation.sessionId, sessionId));
      return { workId: input.workId, state: 'queued' };
    });

    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'prepared', submissionLeaseToken: 'a-newer-lease' });
  });

  it('reconciles failed proposal activity history without leaving a result reference', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const proposed = await prepareProposedResult(
      fixture,
      deps,
      new Date('2026-08-29T18:50:00.000Z'),
    );
    const action = proposed.activity.body.action;
    if (!action) throw new Error('Expected a proposed action');
    await db
      .update(schema.sessionActivity)
      .set({
        approvalStatus: 'applied',
        body: {
          ...proposed.activity.body,
          action: { ...action, result: { content: 'Comment failed', isError: true } },
        },
      })
      .where(eq(schema.sessionActivity.id, proposed.activity.id));

    await sweepLatticeDelegations(new Date('2026-08-29T18:50:07.000Z'), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, proposed.delegation.id)),
      ),
    ).toMatchObject({
      status: 'failed',
      failureCode: 'task_comment_failed',
      returnedActivityId: null,
    });
    expect(
      await db
        .select()
        .from(schema.sessionActivity)
        .where(eq(schema.sessionActivity.id, proposed.activity.id)),
    ).toHaveLength(1);
    expect(
      one(
        await db
          .select()
          .from(schema.agentSession)
          .where(eq(schema.agentSession.id, proposed.sessionId)),
      ),
    ).toMatchObject({
      status: 'failed',
      endedAt: expect.any(Date),
      currentStep: 'Athena could not add the Lattice result to the assigned task.',
    });
  });

  it('records each opened progress cursor once and cancels the submitted relay work', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:00:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:progress`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps);
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    deps.pollResult = {
      workId: delegation.workId,
      state: 'in_flight',
      events: [
        {
          cursor: 'cursor_1',
          kind: 'progress',
          sealed: {
            version: 'relay-v1',
            ephemeralPublicKey: 'ephemeral',
            salt: 'salt',
            iv: 'iv',
            ciphertext: 'ciphertext',
          },
        },
      ],
      nextPollAfterMs: 1_000,
    };
    vi.mocked(deps.openWork).mockResolvedValue({ step: 'Reading the task history' });

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps);
    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 7_001), deps);

    const progress = await db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, sessionId),
          eq(schema.sessionActivity.type, 'thought'),
        ),
      );
    expect(progress).toHaveLength(1);
    expect(progress[0]?.body).toMatchObject({
      text: 'Reading the task history',
      relayCursor: 'cursor_1',
      source: 'lattice',
    });

    expect(
      await cancelLatticeDelegation(
        fixture.owner.id,
        sessionId,
        new Date(preparedAt.getTime() + 8_001),
        deps,
      ),
    ).toBe(true);
    expect(deps.cancelWork).toHaveBeenCalledWith(fixture.connection, delegation.workId);
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({ status: 'canceled', replyKeyCiphertext: null });
  });

  it('holds an owner cancellation open until the relay confirms revoked submitted work is gone', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:40:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:revoked-cancellation`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps);
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    await db
      .update(schema.latticeConnection)
      .set({ status: 'disconnected' })
      .where(eq(schema.latticeConnection.id, fixture.connection.id));
    vi.mocked(deps.cancelWork).mockRejectedValueOnce(
      new RelayControllerError(401, 'controller_token_expired'),
    );

    await expect(
      cancelLatticeDelegation(
        fixture.owner.id,
        sessionId,
        new Date(preparedAt.getTime() + 5_000),
        deps,
      ),
    ).resolves.toBe(true);

    expect(deps.cancelWork).toHaveBeenCalledWith(
      expect.objectContaining({ id: fixture.connection.id, ownerUserId: fixture.owner.id }),
      delegation.workId,
    );
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({
      status: 'submitted',
      failureCode: null,
      cancellationRequestedAt: expect.any(Date),
      replyKeyCiphertext: expect.any(String),
      settledAt: null,
    });

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 10_001), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });

    expect(deps.cancelWork).toHaveBeenCalledTimes(2);
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({
      status: 'canceled',
      failureCode: null,
      workState: 'cancelled',
      cancellationRequestedAt: null,
      replyKeyCiphertext: null,
      settledAt: expect.any(Date),
    });
    expect(
      one(await db.select().from(schema.agentSession).where(eq(schema.agentSession.id, sessionId))),
    ).toMatchObject({ status: 'canceled', endedAt: expect.any(Date) });
  });

  it('keeps a leased prepared delegation cancelable until its in-flight submit is canceled', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:42:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:cancel-during-submit`,
      fixture.connection,
      preparedAt,
      deps,
    );
    let releaseSubmit!: () => void;
    let markSubmitEntered!: () => void;
    const submitEntered = new Promise<void>((resolve) => {
      markSubmitEntered = resolve;
    });
    const submitRelease = new Promise<void>((resolve) => {
      releaseSubmit = resolve;
    });
    vi.mocked(deps.submitWork).mockImplementation(async (_connection, input) => {
      markSubmitEntered();
      await submitRelease;
      return { workId: input.workId, state: 'queued' };
    });

    const sweep = sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
    await submitEntered;
    await expect(
      cancelLatticeDelegation(
        fixture.owner.id,
        sessionId,
        new Date(preparedAt.getTime() + 1_000),
        deps,
      ),
    ).resolves.toBe(true);

    const pending = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    expect(pending).toMatchObject({
      status: 'prepared',
      replyKeyCiphertext: expect.any(String),
      submissionLeaseToken: expect.any(String),
    });

    releaseSubmit();
    await sweep;

    expect(deps.cancelWork).toHaveBeenCalledWith(fixture.connection, pending.workId);
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, pending.id)),
      ),
    ).toMatchObject({ status: 'canceled', workState: 'cancelled', replyKeyCiphertext: null });
  });

  it('cancels a leased delegation before submission when the owner acts during runtime discovery', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:42:30.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:cancel-before-submit`,
      fixture.connection,
      preparedAt,
      deps,
    );
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    const runtimes = await deps.listRuntimes(fixture.connection);
    vi.mocked(deps.listRuntimes).mockImplementation(async () => {
      await cancelLatticeDelegation(
        fixture.owner.id,
        sessionId,
        new Date(preparedAt.getTime() + 500),
        deps,
      );
      return runtimes;
    });

    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);

    expect(
      vi.mocked(deps.submitWork).mock.calls.some(([, input]) => input.workId === delegation.workId),
    ).toBe(false);
    expect(deps.cancelWork).not.toHaveBeenCalled();
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({
      status: 'canceled',
      failureCode: null,
      workState: null,
      cancellationRequestedAt: null,
      replyKeyCiphertext: null,
      submissionLeaseToken: null,
      settledAt: expect.any(Date),
    });
    expect(
      one(await db.select().from(schema.agentSession).where(eq(schema.agentSession.id, sessionId))),
    ).toMatchObject({ status: 'canceled', endedAt: expect.any(Date) });
  });

  it('accepts the unknown-work answer as proof the relay holds nothing to cancel', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:41:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:unknown-work-cancellation`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    vi.mocked(deps.cancelWork).mockRejectedValueOnce(new RelayControllerError(404, 'unknown_work'));

    await expect(
      cancelLatticeDelegation(
        fixture.owner.id,
        sessionId,
        new Date(preparedAt.getTime() + 2_000),
        deps,
      ),
    ).resolves.toBe(true);

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({
      status: 'canceled',
      failureCode: null,
      workState: delegation.workState,
      replyKeyCiphertext: null,
      settledAt: expect.any(Date),
    });
  });

  it('retries an owner cancellation the relay refused until it confirms the work is gone', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:42:45.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:cancel-retry-after-refusal`,
      fixture.connection,
      preparedAt,
      deps,
    );
    let releaseSubmit!: () => void;
    let markSubmitEntered!: () => void;
    const submitEntered = new Promise<void>((resolve) => {
      markSubmitEntered = resolve;
    });
    const submitRelease = new Promise<void>((resolve) => {
      releaseSubmit = resolve;
    });
    vi.mocked(deps.submitWork).mockImplementation(async (_connection, input) => {
      markSubmitEntered();
      await submitRelease;
      return { workId: input.workId, state: 'queued' };
    });
    vi.mocked(deps.cancelWork)
      .mockResolvedValueOnce({ state: 'in_flight' })
      .mockResolvedValueOnce({ state: 'cancelled' });

    const sweep = sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
    await submitEntered;
    await expect(
      cancelLatticeDelegation(
        fixture.owner.id,
        sessionId,
        new Date(preparedAt.getTime() + 1_000),
        deps,
      ),
    ).resolves.toBe(true);
    releaseSubmit();
    await sweep;

    const pending = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    expect(pending).toMatchObject({
      status: 'submitted',
      failureCode: null,
      workState: 'queued',
      cancellationRequestedAt: expect.any(Date),
      replyKeyCiphertext: expect.any(String),
      nextPollAt: expect.any(Date),
    });

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 6_001), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });

    expect(deps.cancelWork).toHaveBeenCalledTimes(2);
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, pending.id)),
      ),
    ).toMatchObject({
      status: 'canceled',
      failureCode: null,
      workState: 'cancelled',
      cancellationRequestedAt: null,
      replyKeyCiphertext: null,
      settledAt: expect.any(Date),
    });
  });

  it('keeps an owner cancellation intact when the submit call fails ambiguously', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:43:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:cancel-during-ambiguous-submit`,
      fixture.connection,
      preparedAt,
      deps,
    );
    vi.mocked(deps.submitWork).mockImplementation(async () => {
      await cancelLatticeDelegation(
        fixture.owner.id,
        sessionId,
        new Date(preparedAt.getTime() + 1_000),
        deps,
      );
      throw new Error('ambiguous submit timeout');
    });

    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);

    const settled = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    expect(deps.cancelWork).toHaveBeenCalledWith(
      expect.objectContaining({ id: fixture.connection.id }),
      settled.workId,
    );
    expect(settled).toMatchObject({
      status: 'canceled',
      failureCode: null,
      workState: 'cancelled',
      cancellationRequestedAt: null,
      replyKeyCiphertext: null,
      submissionLeaseToken: null,
      settledAt: expect.any(Date),
    });
    expect(
      one(await db.select().from(schema.agentSession).where(eq(schema.agentSession.id, sessionId))),
    ).toMatchObject({ status: 'canceled', endedAt: expect.any(Date) });
  });

  it('stops asking Lattice once the delegation deadline has passed', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:44:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:cancel-deadline-exhausted`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    vi.mocked(deps.cancelWork).mockResolvedValue({ state: 'in_flight' });

    await expect(
      cancelLatticeDelegation(
        fixture.owner.id,
        sessionId,
        new Date(preparedAt.getTime() + 1_000),
        deps,
      ),
    ).resolves.toBe(true);
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({ status: 'submitted', cancellationRequestedAt: expect.any(Date) });

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 130_000), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({
      status: 'canceled',
      failureCode: null,
      cancellationRequestedAt: null,
      replyKeyCiphertext: null,
      settledAt: expect.any(Date),
    });
  });

  it('cancels the relay work behind a prepared delegation whose submit ended ambiguously', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:44:30.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:ambiguous-then-cancel`,
      fixture.connection,
      preparedAt,
      deps,
    );
    vi.mocked(deps.submitWork).mockRejectedValueOnce(new Error('ambiguous submit timeout'));

    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);

    const pending = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    expect(pending).toMatchObject({
      status: 'prepared',
      failureCode: 'relay_unavailable',
      submissionLeaseToken: null,
    });

    await expect(
      cancelLatticeDelegation(
        fixture.owner.id,
        sessionId,
        new Date(preparedAt.getTime() + 1_000),
        deps,
      ),
    ).resolves.toBe(true);

    expect(deps.cancelWork).toHaveBeenCalledWith(
      expect.objectContaining({ id: fixture.connection.id }),
      pending.workId,
    );
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, pending.id)),
      ),
    ).toMatchObject({
      status: 'canceled',
      replyKeyCiphertext: null,
      settledAt: expect.any(Date),
    });
  });

  it.each([
    [
      'scope_missing',
      (deps: ReturnType<typeof dependencies>) => {
        vi.mocked(deps.listRuntimes).mockRejectedValue(
          new LatticeUnavailableError('insufficient_scopes'),
        );
      },
    ],
    [
      'runtime_not_found',
      (deps: ReturnType<typeof dependencies>) => {
        vi.mocked(deps.listRuntimes).mockResolvedValue([]);
      },
    ],
    [
      'runtime_key_expired',
      (deps: ReturnType<typeof dependencies>) => {
        vi.mocked(deps.listRuntimes).mockResolvedValue([
          {
            latticeId: 'lat_mac_studio',
            accountId: 'acct_owner',
            displayName: 'Mac Studio',
            reachability: 'reachable' as const,
            protocolVersion: 1,
            capabilities: { agentRuntime: true, streamingProgress: true, cancellation: true },
            workKeys: [
              {
                keyId: 'work-key-expired',
                publicKey: 'runtime-public',
                notBefore: '2026-01-01T00:00:00.000Z',
                notAfter: '2026-02-01T00:00:00.000Z',
              },
            ],
          },
        ]);
      },
    ],
    [
      'submission_rejected',
      (deps: ReturnType<typeof dependencies>) => {
        vi.mocked(deps.submitWork).mockRejectedValue(
          new RelayControllerError(400, 'submission_rejected'),
        );
      },
    ],
  ])('settles a %s submission with Docket-owned copy', async (failureCode, arrange) => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:46:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:${failureCode}`,
      fixture.connection,
      preparedAt,
      deps,
    );
    arrange(deps);

    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'failed', failureCode, replyKeyCiphertext: null });
    const errors = await db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, sessionId),
          eq(schema.sessionActivity.type, 'error'),
        ),
      );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.body).toMatchObject({ code: failureCode, source: 'lattice' });
  });

  it('settles a delegation whose stored reply key can no longer be opened', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:46:30.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:reply-key-unreadable`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await db
      .update(schema.agentDelegation)
      .set({ replyKeyCiphertext: 'not-a-sealed-credential' })
      .where(eq(schema.agentDelegation.sessionId, sessionId));

    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);

    expect(vi.mocked(deps.submitWork).mock.calls.length).toBe(0);
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'result_key_invalid' });
  });

  it('refuses to prepare a run on a connection with no selected runtime', async () => {
    const fixture = await seed();
    const deps = dependencies();
    await expect(
      prepareLatticeAssignmentRun(
        fixture.assignment,
        fixture.ownerActor.id,
        fixture.assignment.objective,
        `athena-assignment:${fixture.assignment.id}:no-runtime`,
        { ...fixture.connection, deviceId: null },
        new Date('2026-08-29T19:47:30.000Z'),
        deps,
      ),
    ).rejects.toThrow();
    await expect(
      prepareLatticeAssignmentRun(
        fixture.assignment,
        fixture.ownerActor.id,
        fixture.assignment.objective,
        `athena-assignment:${fixture.assignment.id}:disabled`,
        { ...fixture.connection, enabled: false },
        new Date('2026-08-29T19:47:31.000Z'),
        deps,
      ),
    ).rejects.toThrow();
  });

  it('treats a revoked runtime work key as no usable key', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:47:40.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:revoked-work-key`,
      fixture.connection,
      preparedAt,
      deps,
    );
    vi.mocked(deps.listRuntimes).mockResolvedValue([
      {
        latticeId: 'lat_mac_studio',
        accountId: 'acct_owner',
        displayName: 'Mac Studio',
        protocolVersion: 1,
        capabilities: { agentRuntime: true, streamingProgress: true, cancellation: true },
        workKeys: [
          {
            keyId: 'work-key-revoked',
            publicKey: 'runtime-public',
            notBefore: '2026-08-01T00:00:00.000Z',
            notAfter: '2026-09-30T00:00:00.000Z',
            revokedAt: '2026-08-15T00:00:00.000Z',
          },
        ],
      },
    ]);

    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'runtime_key_expired' });
  });

  it.each([
    ['oauth_invalid', new LatticeUnavailableError('not_connected')],
    ['oauth_invalid', new LatticeUnavailableError('authorization_expired')],
    ['scope_missing', new RelayControllerError(403, 'forbidden')],
    ['submission_rejected', new RelayControllerError(409, 'conflict')],
    ['submission_rejected', new RelayControllerError(404, 'missing')],
  ])('maps a %s submission refusal from the relay boundary', async (failureCode, cause) => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:47:50.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:${failureCode}-${(cause as Error).message}`,
      fixture.connection,
      preparedAt,
      deps,
    );
    vi.mocked(deps.submitWork).mockRejectedValue(cause);

    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'failed', failureCode });
  });

  it('settles a relay answer that carries a different work id', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:48:10.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:work-id-mismatch`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
    vi.mocked(deps.pollEvents).mockResolvedValue({
      workId: 'work_someone_else',
      state: 'in_flight',
      events: [],
      nextPollAfterMs: 1_000,
    });

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'unknown_work' });
  });

  it('advances the relay cursor for a progress event that carries no readable text', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:48:20.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:textless-progress`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    deps.pollResult = {
      workId: delegation.workId,
      state: 'in_flight',
      events: [
        {
          cursor: 'cursor_textless',
          kind: 'progress',
          sealed: {
            version: 'relay-v1',
            ephemeralPublicKey: 'ephemeral',
            salt: 'salt',
            iv: 'iv',
            ciphertext: 'ciphertext',
          },
        },
      ],
      nextPollAfterMs: 1_000,
    };
    vi.mocked(deps.openWork).mockResolvedValue({ unrelated: true });

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({ relayCursor: 'cursor_textless', status: 'submitted' });
    expect(
      await db
        .select()
        .from(schema.sessionActivity)
        .where(
          and(
            eq(schema.sessionActivity.sessionId, sessionId),
            eq(schema.sessionActivity.type, 'thought'),
          ),
        ),
    ).toHaveLength(0);
  });

  it('settles an expired runtime work key reported in a terminal relay result', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:48:30.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:terminal-key-expired`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    deps.pollResult = {
      workId: delegation.workId,
      state: 'failed',
      events: [
        {
          cursor: 'cursor_final',
          kind: 'result',
          outcome: 'work_key_expired' as const,
          sealed: {
            version: 'relay-v1',
            ephemeralPublicKey: 'ephemeral',
            salt: 'salt',
            iv: 'iv',
            ciphertext: 'ciphertext',
          },
        },
      ],
      nextPollAfterMs: 0,
    };

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'runtime_key_expired' });
  });

  it('reports no cancellation for a session that owns no open delegation', async () => {
    const fixture = await seed();
    const deps = dependencies();
    await expect(
      cancelLatticeDelegation(
        fixture.owner.id,
        'session_that_does_not_exist',
        new Date('2026-08-29T19:48:40.000Z'),
        deps,
      ),
    ).resolves.toBe(false);
  });

  it('abandons a submission whose row another pass already settled', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:50:10.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:claim-settled`,
      fixture.connection,
      preparedAt,
      deps,
    );
    vi.mocked(deps.submitWork).mockImplementation(async (_connection, input) => {
      await db
        .update(schema.agentDelegation)
        .set({
          status: 'canceled',
          replyKeyCiphertext: null,
          returnedActivityId: null,
          submissionLeaseToken: null,
          submissionLeaseExpiresAt: null,
          cancellationRequestedAt: null,
          settledAt: preparedAt,
        })
        .where(eq(schema.agentDelegation.sessionId, sessionId));
      return { workId: input.workId, state: 'queued' };
    });

    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);

    expect(deps.cancelWork).toHaveBeenCalled();
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'canceled' });
  });

  it('leaves a submission alone once another pass has taken its lease', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:50:20.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:claim-reassigned`,
      fixture.connection,
      preparedAt,
      deps,
    );
    const runtimes = await deps.listRuntimes(fixture.connection);
    vi.mocked(deps.listRuntimes).mockImplementation(async () => {
      await db
        .update(schema.agentDelegation)
        .set({
          submissionLeaseToken: 'someone-elses-lease',
          submissionLeaseExpiresAt: new Date(preparedAt.getTime() + 60_000),
        })
        .where(eq(schema.agentDelegation.sessionId, sessionId));
      return runtimes;
    });

    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);

    expect(deps.submitWork).not.toHaveBeenCalled();
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'prepared', submissionLeaseToken: 'someone-elses-lease' });
  });

  it('refuses a relay answer that renames the caller-minted work id', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:50:30.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:renamed-work-id`,
      fixture.connection,
      preparedAt,
      deps,
    );
    vi.mocked(deps.submitWork).mockResolvedValue({ workId: 'work_relay_renamed', state: 'queued' });

    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'prepared', failureCode: 'relay_unavailable' });
  });

  it('waits for runtime queue space without a relay retry hint', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:50:40.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:queue-full`,
      fixture.connection,
      preparedAt,
      deps,
    );
    vi.mocked(deps.submitWork).mockResolvedValue({ workId: '', state: 'queue_full' });

    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'prepared', workState: 'queue_full' });
    expect(
      one(await db.select().from(schema.agentSession).where(eq(schema.agentSession.id, sessionId))),
    ).toMatchObject({ currentStep: expect.any(String) });
  });

  it('cancels a proposed delegation and withdraws its pending task write', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const { delegation, sessionId } = await prepareProposedResult(
      fixture,
      deps,
      new Date('2026-08-29T19:51:00.000Z'),
    );

    await expect(
      cancelLatticeDelegation(
        fixture.owner.id,
        sessionId,
        new Date('2026-08-29T19:51:30.000Z'),
        deps,
      ),
    ).resolves.toBe(true);

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({ status: 'canceled', returnedActivityId: null });
  });

  it('addresses cancellation by runtime when a delegation predates account binding', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:51:20.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:legacy-account-binding`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
    await db
      .update(schema.agentDelegation)
      .set({ latticeAccountId: null })
      .where(eq(schema.agentDelegation.sessionId, sessionId));

    await expect(
      cancelLatticeDelegation(
        fixture.owner.id,
        sessionId,
        new Date(preparedAt.getTime() + 2_000),
        deps,
      ),
    ).resolves.toBe(true);

    expect(deps.cancelWork).toHaveBeenCalled();
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'canceled' });
  });

  it('keeps asking a relay that has not answered when no deadline bounds the work', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:51:40.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:no-deadline-retry`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
    await db
      .update(schema.agentDelegation)
      .set({ deadlineAt: null })
      .where(eq(schema.agentDelegation.sessionId, sessionId));
    vi.mocked(deps.cancelWork).mockResolvedValue({ state: 'in_flight' });

    await expect(
      cancelLatticeDelegation(
        fixture.owner.id,
        sessionId,
        new Date(preparedAt.getTime() + 1_000),
        deps,
      ),
    ).resolves.toBe(true);

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 200_000), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'submitted', cancellationRequestedAt: expect.any(Date) });
  });

  it('ignores relay payloads that are not readable objects', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:52:10.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:unreadable-payload`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    deps.pollResult = {
      workId: delegation.workId,
      state: 'completed',
      events: [
        {
          cursor: 'cursor_final',
          kind: 'result',
          outcome: 'completed' as const,
          sealed: {
            version: 'relay-v1',
            ephemeralPublicKey: 'ephemeral',
            salt: 'salt',
            iv: 'iv',
            ciphertext: 'ciphertext',
          },
        },
      ],
      nextPollAfterMs: 0,
    };
    vi.mocked(deps.openWork).mockResolvedValue('not-an-object');

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'result_invalid' });
  });

  it('refuses a prepared delegation that lost its controller deadline', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:53:10.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:no-deadline-submit`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await db
      .update(schema.agentDelegation)
      .set({ deadlineAt: null })
      .where(eq(schema.agentDelegation.sessionId, sessionId));

    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);

    expect(deps.submitWork).not.toHaveBeenCalled();
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'result_key_invalid' });
  });

  it('names the runtime by its lattice id when the connection carries no device name', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:53:20.000Z');
    await db
      .update(schema.latticeConnection)
      .set({ deviceName: null })
      .where(eq(schema.latticeConnection.id, fixture.connection.id));
    const { delegation } = await prepareProposedResult(
      { ...fixture, connection: { ...fixture.connection, deviceName: null } },
      deps,
      preparedAt,
    );
    const activity = one(
      await db
        .select()
        .from(schema.sessionActivity)
        .where(eq(schema.sessionActivity.id, delegation.returnedActivityId ?? '')),
    );
    expect(activity.body).toMatchObject({
      lattice: { runtimeName: delegation.runtimeId },
    });
  });

  it('retries acknowledgement when the relay reports an unreadable time', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:53:30.000Z');
    const { delegation, sessionId } = await prepareProposedResult(fixture, deps, preparedAt);
    await db
      .update(schema.sessionActivity)
      .set({ approvalStatus: 'applied' })
      .where(eq(schema.sessionActivity.id, delegation.returnedActivityId ?? ''));
    vi.mocked(deps.acknowledgeResult).mockResolvedValue({
      state: 'completed',
      acknowledgedAt: 'not-a-time',
    });

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 10_001), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ).resultAcknowledgedAt,
    ).toBeNull();
  });

  it('settles a delegation whose owner lost the capability to contribute', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:53:40.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:capability-removed`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await db
      .update(schema.grant)
      .set({ capabilities: ['view'] })
      .where(eq(schema.grant.organizationId, fixture.organization.id));

    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);

    expect(deps.submitWork).not.toHaveBeenCalled();
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'access_lost' });
  });

  it('settles an owner cancellation the relinked account can no longer reach', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:53:50.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:relinked-cancel`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
    await invalidateConnection(fixture.connection.id);

    await expect(
      cancelLatticeDelegation(
        fixture.owner.id,
        sessionId,
        new Date(preparedAt.getTime() + 2_000),
        deps,
      ),
    ).resolves.toBe(true);

    expect(deps.cancelWork).not.toHaveBeenCalled();
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'canceled', failureCode: 'oauth_invalid' });
    expect(
      one(await db.select().from(schema.agentSession).where(eq(schema.agentSession.id, sessionId))),
    ).toMatchObject({ status: 'canceled' });
  });

  it('leaves an unmapped Lattice outage as a retryable relay failure', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:54:10.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:unmapped-outage`,
      fixture.connection,
      preparedAt,
      deps,
    );
    vi.mocked(deps.listRuntimes).mockRejectedValue(
      new LatticeUnavailableError('gateway_unreachable'),
    );

    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'prepared', failureCode: 'relay_unavailable' });
  });

  it('takes the durable path when the relay refuses an owner mid-poll', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:55:10.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:poll-401`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
    vi.mocked(deps.pollEvents).mockRejectedValue(
      new RelayControllerError(401, 'controller_token_expired'),
    );

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });

    expect(deps.cancelWork).toHaveBeenCalled();
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'oauth_invalid', workState: 'cancelled' });
  });

  it('keeps a progress event whose payload is not an object out of the session', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:55:20.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:scalar-progress`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    deps.pollResult = {
      workId: delegation.workId,
      state: 'in_flight',
      events: [
        {
          cursor: 'cursor_scalar',
          kind: 'progress',
          sealed: {
            version: 'relay-v1',
            ephemeralPublicKey: 'ephemeral',
            salt: 'salt',
            iv: 'iv',
            ciphertext: 'ciphertext',
          },
        },
      ],
      nextPollAfterMs: 1_000,
    };
    vi.mocked(deps.openWork).mockResolvedValue('a scalar payload');

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });

    expect(
      await db
        .select()
        .from(schema.sessionActivity)
        .where(
          and(
            eq(schema.sessionActivity.sessionId, sessionId),
            eq(schema.sessionActivity.type, 'thought'),
          ),
        ),
    ).toHaveLength(0);
  });

  it('refuses to submit a prepared delegation whose instruction went missing', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:55:30.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:missing-instruction`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await db
      .update(schema.sessionActivity)
      .set({ body: { text: '   ', author: 'user' } })
      .where(
        and(
          eq(schema.sessionActivity.sessionId, sessionId),
          eq(schema.sessionActivity.type, 'response'),
        ),
      );

    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);

    expect(deps.submitWork).not.toHaveBeenCalled();
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'prepared', failureCode: 'relay_unavailable' });
  });

  it('records the selected runtime with no reported reachability', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:55:50.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:no-reachability`,
      fixture.connection,
      preparedAt,
      deps,
    );
    vi.mocked(deps.listRuntimes).mockResolvedValue([
      {
        latticeId: 'lat_mac_studio',
        accountId: 'acct_owner',
        displayName: 'Mac Studio',
        protocolVersion: 1,
        capabilities: { agentRuntime: true, streamingProgress: true, cancellation: true },
        workKeys: [
          {
            keyId: 'work-key-1',
            publicKey: 'runtime-public',
            notBefore: '2026-08-01T00:00:00.000Z',
            notAfter: '2026-09-30T00:00:00.000Z',
          },
        ],
      },
    ]);

    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'submitted', runtimeReachability: null });
  });

  it('delegates an assignment scoped to a project rather than a task', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:56:10.000Z');
    const projectAssignment = one(
      await db
        .insert(schema.athenaAssignment)
        .values({
          ownerUserId: fixture.owner.id,
          organizationId: fixture.organization.id,
          entityType: 'project',
          entityId: fixture.project.id,
          objective: 'Summarize where this project stands.',
        })
        .returning(),
    );

    const sessionId = await prepareLatticeAssignmentRun(
      projectAssignment,
      fixture.ownerActor.id,
      projectAssignment.objective,
      `athena-assignment:${projectAssignment.id}:project-scope`,
      fixture.connection,
      preparedAt,
      deps,
    );

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'prepared', taskId: null });
    expect(
      one(await db.select().from(schema.agentSession).where(eq(schema.agentSession.id, sessionId))),
    ).toMatchObject({ taskId: null });
  });

  it('settles access loss before submission without contacting the relay', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:45:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:pre-submit-access-loss`,
      fixture.connection,
      preparedAt,
      deps,
    );
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    await db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(eq(schema.actor.id, fixture.ownerActor.id));

    await sweepLatticeDelegations(preparedAt, deps, {
      pollingEnabled: true,
      submissionsEnabled: true,
    });

    expect(
      vi.mocked(deps.submitWork).mock.calls.some(([, input]) => input.workId === delegation.workId),
    ).toBe(false);
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'access_lost' });
    expect(
      await db
        .select()
        .from(schema.sessionActivity)
        .where(
          and(
            eq(schema.sessionActivity.sessionId, sessionId),
            eq(schema.sessionActivity.type, 'action'),
          ),
        ),
    ).toHaveLength(0);
  });

  it('reauthorizes after runtime discovery and before the submit network call', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:47:00.000Z');
    const runtimes = await deps.listRuntimes(fixture.connection);
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:submit-race-access-loss`,
      fixture.connection,
      preparedAt,
      deps,
    );
    vi.mocked(deps.listRuntimes).mockImplementation(async () => {
      await db
        .update(schema.actor)
        .set({ status: 'suspended' })
        .where(eq(schema.actor.id, fixture.ownerActor.id));
      return runtimes;
    });

    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);

    expect(deps.submitWork).not.toHaveBeenCalled();
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'access_lost' });
  });

  it('rechecks connection account and runtime identity before submission', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:48:00.000Z');
    const runtimes = await deps.listRuntimes(fixture.connection);
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:submit-connection-race`,
      fixture.connection,
      preparedAt,
      deps,
    );
    vi.mocked(deps.listRuntimes).mockImplementation(async () => {
      await invalidateConnection(fixture.connection.id);
      return runtimes;
    });
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );

    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);

    expect(
      vi.mocked(deps.submitWork).mock.calls.some(([, input]) => input.workId === delegation.workId),
    ).toBe(false);
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'oauth_invalid' });
  });

  it('cancels work accepted during submit access loss without writing queue progress', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:49:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:post-submit-access-loss`,
      fixture.connection,
      preparedAt,
      deps,
    );
    vi.mocked(deps.submitWork).mockImplementation(async (_connection, input) => {
      await db
        .update(schema.actor)
        .set({ status: 'suspended' })
        .where(eq(schema.actor.id, fixture.ownerActor.id));
      return {
        workId: input.workId,
        state: 'offline_queued',
        queuePosition: 3,
        lastSeenAt: '2026-08-29T19:48:00.000Z',
      };
    });

    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);

    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    expect(deps.cancelWork).toHaveBeenCalledWith(fixture.connection, delegation.workId);
    expect(delegation).toMatchObject({
      status: 'failed',
      failureCode: 'access_lost',
      workState: 'cancelled',
      runtimeName: null,
      relayQueuePosition: null,
    });
    expect(
      one(await db.select().from(schema.agentSession).where(eq(schema.agentSession.id, sessionId))),
    ).toMatchObject({ status: 'failed', endedAt: expect.any(Date) });
  });

  it('retries cancellation after submit access loss until the relay confirms it', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:49:15.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:post-submit-cancel-retry`,
      fixture.connection,
      preparedAt,
      deps,
    );
    vi.mocked(deps.submitWork).mockImplementation(async (_connection, input) => {
      await db
        .update(schema.actor)
        .set({ status: 'suspended' })
        .where(eq(schema.actor.id, fixture.ownerActor.id));
      return { workId: input.workId, state: 'offline_queued', queuePosition: 2 };
    });
    vi.mocked(deps.cancelWork)
      .mockRejectedValueOnce(new Error('relay unavailable during compensation'))
      .mockResolvedValueOnce({ state: 'cancelled' });

    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);

    const pending = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    expect(pending).toMatchObject({
      status: 'submitted',
      failureCode: 'access_lost',
      workState: 'offline_queued',
      replyKeyCiphertext: expect.any(String),
      nextPollAt: expect.any(Date),
    });

    await db
      .update(schema.actor)
      .set({ status: 'active' })
      .where(eq(schema.actor.id, fixture.ownerActor.id));
    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });

    expect(deps.cancelWork).toHaveBeenCalledTimes(2);
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, pending.id)),
      ),
    ).toMatchObject({
      status: 'failed',
      failureCode: 'access_lost',
      workState: 'cancelled',
      replyKeyCiphertext: null,
      settledAt: expect.any(Date),
    });
  });

  it('reauthorizes transient submit failure writes inside their transaction', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:49:20.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:submit-error-write-fence`,
      fixture.connection,
      preparedAt,
      deps,
    );
    vi.mocked(deps.submitWork).mockRejectedValue(new Error('ambiguous submit timeout'));
    const realCanActor = authzModule.canActor;
    let authorizationChecks = 0;
    const canActor = vi.spyOn(authzModule, 'canActor').mockImplementation(async (...args) => {
      const result = await realCanActor(...args);
      if (args[2].id !== fixture.targetTask.id) return result;
      authorizationChecks += 1;
      if (authorizationChecks === 3) {
        await args[3]
          .update(schema.latticeConnection)
          .set({ status: 'disconnected' })
          .where(eq(schema.latticeConnection.id, fixture.connection.id));
      }
      return result;
    });

    try {
      await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
    } finally {
      canActor.mockRestore();
    }

    expect(authorizationChecks).toBeGreaterThanOrEqual(3);
    expect(deps.cancelWork).toHaveBeenCalled();
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'oauth_invalid', workState: 'cancelled' });
  });

  it.each(['offline_queued', 'rate_limited'] as const)(
    'rechecks authorization inside the %s submission progress transaction',
    async (acceptedState) => {
      const fixture = await seed();
      const deps = dependencies();
      const preparedAt = new Date('2026-08-29T19:49:30.000Z');
      const sessionId = await prepareLatticeAssignmentRun(
        fixture.assignment,
        fixture.ownerActor.id,
        fixture.assignment.objective,
        `athena-assignment:${fixture.assignment.id}:${acceptedState}-write-fence`,
        fixture.connection,
        preparedAt,
        deps,
      );
      vi.mocked(deps.submitWork).mockImplementation(async (_connection, input) =>
        acceptedState === 'rate_limited'
          ? { workId: '', state: acceptedState, retryAfterMs: 1_000 }
          : { workId: input.workId, state: acceptedState, queuePosition: 3 },
      );
      const realCanActor = authzModule.canActor;
      let authorizationChecks = 0;
      const canActor = vi.spyOn(authzModule, 'canActor').mockImplementation(async (...args) => {
        const result = await realCanActor(...args);
        if (args[2].id !== fixture.targetTask.id) return result;
        authorizationChecks += 1;
        if (authorizationChecks === 4) {
          const handle = args[3];
          await handle
            .update(schema.latticeConnection)
            .set({ status: 'disconnected' })
            .where(eq(schema.latticeConnection.id, fixture.connection.id));
        }
        return result;
      });

      try {
        await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
      } finally {
        canActor.mockRestore();
      }

      expect(authorizationChecks).toBeGreaterThanOrEqual(4);
      if (acceptedState === 'offline_queued') {
        expect(deps.cancelWork).toHaveBeenCalled();
      } else {
        expect(deps.cancelWork).not.toHaveBeenCalled();
      }
      expect(
        one(
          await db
            .select()
            .from(schema.agentDelegation)
            .where(eq(schema.agentDelegation.sessionId, sessionId)),
        ),
      ).toMatchObject({
        status: 'failed',
        failureCode: 'oauth_invalid',
        workState: acceptedState === 'offline_queued' ? 'cancelled' : null,
        runtimeName: null,
        relayQueuePosition: null,
        nextPollAt: null,
      });
      expect(
        one(
          await db.select().from(schema.agentSession).where(eq(schema.agentSession.id, sessionId)),
        ),
      ).toMatchObject({ status: 'failed', endedAt: expect.any(Date) });
    },
  );

  it('settles access loss before polling without opening or persisting relay progress', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:50:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:pre-poll-access-loss`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps, {
      pollingEnabled: true,
      submissionsEnabled: true,
    });
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    deps.pollResult = {
      workId: delegation.workId,
      state: 'in_flight',
      events: [
        {
          cursor: 'cursor_unauthorized_progress',
          kind: 'progress',
          sealed: {
            version: 'relay-v1',
            ephemeralPublicKey: 'ephemeral',
            salt: 'salt',
            iv: 'iv',
            ciphertext: 'ciphertext',
          },
        },
      ],
      nextPollAfterMs: 1_000,
    };
    await db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(eq(schema.actor.id, fixture.ownerActor.id));

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps, {
      pollingEnabled: true,
      submissionsEnabled: true,
    });

    expect(
      vi.mocked(deps.pollEvents).mock.calls.some(([, workId]) => workId === delegation.workId),
    ).toBe(false);
    expect(deps.cancelWork).toHaveBeenCalledWith(
      expect.objectContaining({ id: fixture.connection.id }),
      delegation.workId,
    );
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'access_lost', workState: 'cancelled' });
    expect(
      await db
        .select()
        .from(schema.sessionActivity)
        .where(
          and(
            eq(schema.sessionActivity.sessionId, sessionId),
            eq(schema.sessionActivity.type, 'thought'),
          ),
        ),
    ).toHaveLength(0);
  });

  it('refuses to poll after the connection account or selected runtime changes', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:52:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:poll-connection-change`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    await invalidateConnection(fixture.connection.id);

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });

    expect(
      vi.mocked(deps.pollEvents).mock.calls.some(([, workId]) => workId === delegation.workId),
    ).toBe(false);
    expect(deps.cancelWork).not.toHaveBeenCalled();
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'oauth_invalid' });
  });

  it('cancels remote work when access is lost during the poll network call', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:53:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:post-poll-access-loss`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    vi.mocked(deps.pollEvents).mockImplementation(async (_connection, workId) => {
      await db
        .update(schema.actor)
        .set({ status: 'suspended' })
        .where(eq(schema.actor.id, fixture.ownerActor.id));
      return { workId, state: 'in_flight', events: [], nextPollAfterMs: 1_000 };
    });

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });

    expect(deps.cancelWork).toHaveBeenCalledWith(fixture.connection, delegation.workId);
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'access_lost', workState: 'cancelled' });
    expect(
      await db
        .select()
        .from(schema.sessionActivity)
        .where(
          and(
            eq(schema.sessionActivity.sessionId, sessionId),
            eq(schema.sessionActivity.type, 'thought'),
          ),
        ),
    ).toHaveLength(0);
  });

  it('reauthorizes non-terminal poll writes inside their transaction', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:54:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:poll-state-write-fence`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    deps.pollResult = {
      workId: delegation.workId,
      state: 'in_flight',
      events: [],
      nextPollAfterMs: 1_000,
    };
    const realCanActor = authzModule.canActor;
    let authorizationChecks = 0;
    const canActor = vi.spyOn(authzModule, 'canActor').mockImplementation(async (...args) => {
      const result = await realCanActor(...args);
      if (args[2].id !== fixture.targetTask.id) return result;
      authorizationChecks += 1;
      if (authorizationChecks === 4) {
        await args[3]
          .update(schema.latticeConnection)
          .set({ status: 'disconnected' })
          .where(eq(schema.latticeConnection.id, fixture.connection.id));
      }
      return result;
    });

    try {
      await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps, {
        pollingEnabled: true,
        submissionsEnabled: false,
      });
    } finally {
      canActor.mockRestore();
    }

    expect(authorizationChecks).toBeGreaterThanOrEqual(4);
    expect(deps.cancelWork).toHaveBeenCalled();
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'oauth_invalid', workState: 'cancelled' });
  });

  it('reauthorizes transient poll failure writes inside their transaction', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:54:30.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:poll-error-write-fence`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    vi.mocked(deps.pollEvents).mockRejectedValue(new Error('poll timeout'));
    const realCanActor = authzModule.canActor;
    let authorizationChecks = 0;
    const canActor = vi.spyOn(authzModule, 'canActor').mockImplementation(async (...args) => {
      const result = await realCanActor(...args);
      if (args[2].id !== fixture.targetTask.id) return result;
      authorizationChecks += 1;
      if (authorizationChecks === 3) {
        await args[3]
          .update(schema.latticeConnection)
          .set({ status: 'disconnected' })
          .where(eq(schema.latticeConnection.id, fixture.connection.id));
      }
      return result;
    });

    try {
      await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps, {
        pollingEnabled: true,
        submissionsEnabled: false,
      });
    } finally {
      canActor.mockRestore();
    }

    expect(authorizationChecks).toBeGreaterThanOrEqual(3);
    expect(deps.cancelWork).toHaveBeenCalled();
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'oauth_invalid', workState: 'cancelled' });
  });

  it('reauthorizes inside the progress transaction before writing activity', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:55:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:progress-race-access-loss`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    deps.pollResult = {
      workId: delegation.workId,
      state: 'in_flight',
      events: [
        {
          cursor: 'cursor_access_lost_after_open',
          kind: 'progress',
          sealed: {
            version: 'relay-v1',
            ephemeralPublicKey: 'ephemeral',
            salt: 'salt',
            iv: 'iv',
            ciphertext: 'ciphertext',
          },
        },
      ],
      nextPollAfterMs: 1_000,
    };
    vi.mocked(deps.openWork).mockImplementation(async () => {
      await db
        .update(schema.actor)
        .set({ status: 'suspended' })
        .where(eq(schema.actor.id, fixture.ownerActor.id));
      return { text: 'This progress must not persist' };
    });

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'access_lost' });
    expect(
      await db
        .select()
        .from(schema.sessionActivity)
        .where(
          and(
            eq(schema.sessionActivity.sessionId, sessionId),
            eq(schema.sessionActivity.type, 'thought'),
          ),
        ),
    ).toHaveLength(0);
  });

  it('rechecks connection identity inside the progress transaction', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T19:57:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:progress-connection-race`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    deps.pollResult = {
      workId: delegation.workId,
      state: 'in_flight',
      events: [
        {
          cursor: 'cursor_connection_changed_after_open',
          kind: 'progress',
          sealed: {
            version: 'relay-v1',
            ephemeralPublicKey: 'ephemeral',
            salt: 'salt',
            iv: 'iv',
            ciphertext: 'ciphertext',
          },
        },
      ],
      nextPollAfterMs: 1_000,
    };
    vi.mocked(deps.openWork).mockImplementation(async () => {
      await invalidateConnection(fixture.connection.id);
      return { text: 'This progress must not persist' };
    });

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({ status: 'failed', failureCode: 'oauth_invalid' });
    expect(
      await db
        .select()
        .from(schema.sessionActivity)
        .where(
          and(
            eq(schema.sessionActivity.sessionId, sessionId),
            eq(schema.sessionActivity.type, 'thought'),
          ),
        ),
    ).toHaveLength(0);
  });

  it('settles access loss without proposing a task write', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T20:00:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:access-loss`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps);
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    await db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(eq(schema.actor.id, fixture.ownerActor.id));
    deps.pollResult = {
      workId: delegation.workId,
      state: 'completed',
      events: [
        {
          cursor: 'cursor_final',
          kind: 'result',
          outcome: 'completed' as const,
          sealed: {
            version: 'relay-v1',
            ephemeralPublicKey: 'ephemeral',
            salt: 'salt',
            iv: 'iv',
            ciphertext: 'ciphertext',
          },
        },
      ],
      nextPollAfterMs: 0,
    };

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps);

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({
      status: 'failed',
      failureCode: 'access_lost',
      replyKeyCiphertext: null,
    });
    expect(
      await db
        .select()
        .from(schema.sessionActivity)
        .where(
          and(
            eq(schema.sessionActivity.sessionId, sessionId),
            eq(schema.sessionActivity.type, 'action'),
          ),
        ),
    ).toHaveLength(0);
  });

  it('rechecks assignment and connection access inside the terminal proposal transaction', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T20:02:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:terminal-transaction-fence`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    const terminalCursor = 'cursor_final';
    deps.pollResult = {
      workId: delegation.workId,
      state: 'completed',
      events: [
        {
          cursor: terminalCursor,
          kind: 'result',
          outcome: 'completed' as const,
          sealed: {
            version: 'relay-v1',
            ephemeralPublicKey: 'ephemeral',
            salt: 'salt',
            iv: 'iv',
            ciphertext: 'ciphertext',
          },
        },
      ],
      nextPollAfterMs: 0,
    };
    const realCanActor = authzModule.canActor;
    let authorizationChecks = 0;
    const canActor = vi.spyOn(authzModule, 'canActor').mockImplementation(async (...args) => {
      const result = await realCanActor(...args);
      authorizationChecks += 1;
      if (authorizationChecks === 3) {
        const handle = args[3];
        await handle
          .update(schema.latticeConnection)
          .set({
            status: 'disconnected',
            enabled: true,
            accountId: 'acct_relinked',
            deviceId: 'lat_relinked',
          })
          .where(eq(schema.latticeConnection.id, fixture.connection.id));
      }
      return result;
    });

    try {
      await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps, {
        pollingEnabled: true,
        submissionsEnabled: false,
      });
    } finally {
      canActor.mockRestore();
    }

    expect(authorizationChecks).toBeGreaterThanOrEqual(3);
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({
      status: 'failed',
      failureCode: 'oauth_invalid',
      relayCursor: terminalCursor,
    });
    expect(
      await db
        .select()
        .from(schema.sessionActivity)
        .where(
          and(
            eq(schema.sessionActivity.sessionId, sessionId),
            eq(schema.sessionActivity.type, 'action'),
          ),
        ),
    ).toHaveLength(0);
  });

  it('settles invalid result ciphertext with a stable Docket error', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T21:00:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:invalid-ciphertext`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps);
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    deps.pollResult = {
      workId: delegation.workId,
      state: 'completed',
      events: [
        {
          cursor: 'cursor_final',
          kind: 'result',
          outcome: 'completed' as const,
          sealed: {
            version: 'relay-v1',
            ephemeralPublicKey: 'ephemeral',
            salt: 'salt',
            iv: 'iv',
            ciphertext: 'invalid',
          },
        },
      ],
      nextPollAfterMs: 0,
    };
    vi.mocked(deps.openWork).mockRejectedValue(new Error('bad envelope'));

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps);

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({
      status: 'failed',
      failureCode: 'result_decryption_failed',
      relayCursor: 'cursor_final',
      replyKeyCiphertext: expect.any(String),
    });
    expect(
      vi
        .mocked(deps.acknowledgeResult)
        .mock.calls.some(([, workId]) => workId === delegation.workId),
    ).toBe(false);
  });

  it.each([
    { outcome: 'failed' as const, expectedStatus: 'failed', failureCode: 'execution_failed' },
    { outcome: 'cancelled' as const, expectedStatus: 'canceled', failureCode: null },
  ])(
    'persists and acknowledges a terminal $outcome relay delivery',
    async ({ outcome, expectedStatus, failureCode }) => {
      const fixture = await seed();
      const deps = dependencies();
      const preparedAt = new Date(`2026-08-29T21:${outcome === 'failed' ? '05' : '10'}:00.000Z`);
      const sessionId = await prepareLatticeAssignmentRun(
        fixture.assignment,
        fixture.ownerActor.id,
        fixture.assignment.objective,
        `athena-assignment:${fixture.assignment.id}:${outcome}-terminal`,
        fixture.connection,
        preparedAt,
        deps,
      );
      await sweepLatticeDelegations(preparedAt, deps, {
        pollingEnabled: true,
        submissionsEnabled: true,
      });
      const delegation = one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      );
      const payload = { errorCode: `${outcome}_by_runtime`, detail: 'terminal proof' };
      deps.pollResult = {
        workId: delegation.workId,
        state: outcome,
        events: [
          {
            cursor: 'cursor_final',
            kind: 'result',
            outcome,
            sealed: {
              version: 'relay-v1',
              ephemeralPublicKey: 'ephemeral',
              salt: 'salt',
              iv: 'iv',
              ciphertext: 'ciphertext',
            },
          },
        ],
        nextPollAfterMs: 0,
      };
      vi.mocked(deps.openWork).mockResolvedValue(payload);

      await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps, {
        pollingEnabled: true,
        submissionsEnabled: false,
      });

      expect(
        one(
          await db
            .select()
            .from(schema.agentDelegation)
            .where(eq(schema.agentDelegation.id, delegation.id)),
        ),
      ).toMatchObject({
        status: expectedStatus,
        failureCode,
        relayCursor: 'cursor_final',
        terminalOutcome: { outcome, payload },
        resultAcknowledgedAt: expect.any(Date),
      });
      expect(deps.acknowledgeResult).toHaveBeenCalledWith(fixture.connection, delegation.workId);
    },
  );

  it('persists and acknowledges an opened result that has no usable report', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T21:12:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:invalid-result`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps);
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    const payload = { outputText: '' };
    deps.pollResult = {
      workId: delegation.workId,
      state: 'completed',
      events: [
        {
          cursor: 'cursor_final',
          kind: 'result',
          outcome: 'completed' as const,
          sealed: {
            version: 'relay-v1',
            ephemeralPublicKey: 'ephemeral',
            salt: 'salt',
            iv: 'iv',
            ciphertext: 'ciphertext',
          },
        },
      ],
      nextPollAfterMs: 0,
    };
    vi.mocked(deps.openWork).mockResolvedValue(payload);

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps);

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({
      status: 'failed',
      failureCode: 'result_invalid',
      relayCursor: 'cursor_final',
      terminalOutcome: { outcome: 'completed', payload },
      resultAcknowledgedAt: expect.any(Date),
    });
  });

  it('persists and acknowledges a relay expiry event after local settlement', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T21:13:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:expired-result`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps);
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    const terminal = {
      cursor: 'cursor_final' as const,
      kind: 'expiry' as const,
      reason: 'deadline_expired' as const,
      expiredAt: '2026-08-29T21:15:00.000Z',
    };
    deps.pollResult = {
      workId: delegation.workId,
      state: 'expired',
      events: [terminal],
      nextPollAfterMs: 0,
    };

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps);

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({
      status: 'failed',
      failureCode: 'work_expired',
      relayCursor: 'cursor_final',
      terminalOutcome: { outcome: 'expired', payload: terminal },
      resultAcknowledgedAt: expect.any(Date),
    });
  });

  it('does not acknowledge an opened completed result after access is lost', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T21:15:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:opened-access-loss`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps, {
      pollingEnabled: true,
      submissionsEnabled: true,
    });
    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    const payload = { outputText: 'Do not write this after access is lost.' };
    deps.pollResult = {
      workId: delegation.workId,
      state: 'completed',
      events: [
        {
          cursor: 'cursor_final',
          kind: 'result',
          outcome: 'completed' as const,
          sealed: {
            version: 'relay-v1',
            ephemeralPublicKey: 'ephemeral',
            salt: 'salt',
            iv: 'iv',
            ciphertext: 'ciphertext',
          },
        },
      ],
      nextPollAfterMs: 0,
    };
    vi.mocked(deps.openWork).mockImplementation(async () => {
      await db
        .update(schema.actor)
        .set({ status: 'suspended' })
        .where(eq(schema.actor.id, fixture.ownerActor.id));
      return payload;
    });

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, delegation.id)),
      ),
    ).toMatchObject({
      status: 'failed',
      failureCode: 'access_lost',
      relayCursor: 'cursor_final',
      terminalOutcome: { outcome: 'completed', payload },
      resultAcknowledgedAt: null,
    });
    expect(
      vi
        .mocked(deps.acknowledgeResult)
        .mock.calls.some(([, workId]) => workId === delegation.workId),
    ).toBe(false);
    expect(
      await db
        .select()
        .from(schema.sessionActivity)
        .where(
          and(
            eq(schema.sessionActivity.sessionId, sessionId),
            eq(schema.sessionActivity.type, 'action'),
          ),
        ),
    ).toHaveLength(0);
  });

  it('rechecks connection account and runtime identity before acknowledgement', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const settledAt = new Date('2026-08-29T21:20:00.000Z');
    const proposed = await prepareProposedResult(fixture, deps, settledAt);
    await decideActivity(
      fixture.organization.id,
      fixture.ownerActor.id,
      proposed.sessionId,
      proposed.activity.id,
      { decision: 'approve' },
    );
    await invalidateConnection(fixture.connection.id);

    await sweepLatticeDelegations(new Date(settledAt.getTime() + 7_000), deps, {
      pollingEnabled: true,
      submissionsEnabled: false,
    });

    expect(
      vi
        .mocked(deps.acknowledgeResult)
        .mock.calls.some(([, workId]) => workId === proposed.delegation.workId),
    ).toBe(false);
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, proposed.delegation.id)),
      ).resultAcknowledgedAt,
    ).toBeNull();
  });

  it('settles an unknown relay work id with Docket-owned copy', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T21:30:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:unknown-work`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps);
    vi.mocked(deps.pollEvents).mockRejectedValue(
      new RelayControllerError(404, 'unknown_work_item'),
    );

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps);

    const delegation = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.sessionId, sessionId)),
    );
    expect(delegation).toMatchObject({
      status: 'failed',
      failureCode: 'unknown_work',
      replyKeyCiphertext: null,
    });
    const [error] = await db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, sessionId),
          eq(schema.sessionActivity.type, 'error'),
        ),
      );
    expect(error?.body).toEqual({
      text: 'Athena stopped because Lattice no longer recognizes this assignment.',
      code: 'unknown_work',
      source: 'lattice',
    });
  });

  it('keeps relay outages retryable and clears the visible failure after recovery', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T21:45:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:relay-recovery`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps);
    vi.mocked(deps.pollEvents).mockRejectedValueOnce(
      new RelayControllerError(503, 'personal_lattice_relay_unavailable'),
    );

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps);
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'submitted', failureCode: 'relay_unavailable' });
    expect(
      one(await db.select().from(schema.agentSession).where(eq(schema.agentSession.id, sessionId))),
    ).toMatchObject({
      status: 'running',
      currentStep: 'Athena is waiting for the Lovelace Lattice relay to respond.',
    });

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 10_002), deps);
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({ status: 'submitted', failureCode: null });
  });

  it('settles a revoked connection without retrying or falling back', async () => {
    const fixture = await seed();
    const deps = dependencies();
    const preparedAt = new Date('2026-08-29T22:00:00.000Z');
    const sessionId = await prepareLatticeAssignmentRun(
      fixture.assignment,
      fixture.ownerActor.id,
      fixture.assignment.objective,
      `athena-assignment:${fixture.assignment.id}:revoked`,
      fixture.connection,
      preparedAt,
      deps,
    );
    await sweepLatticeDelegations(preparedAt, deps);
    await db
      .update(schema.latticeConnection)
      .set({ enabled: false, status: 'error' })
      .where(eq(schema.latticeConnection.id, fixture.connection.id));

    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps);

    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.sessionId, sessionId)),
      ),
    ).toMatchObject({
      status: 'failed',
      failureCode: 'oauth_invalid',
      replyKeyCiphertext: null,
    });
    expect(
      await db
        .select()
        .from(schema.agentSessionRun)
        .where(eq(schema.agentSessionRun.sessionId, sessionId)),
    ).toHaveLength(0);
  });
});
