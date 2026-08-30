import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
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
    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 6_002), deps);

    const settled = one(
      await db
        .select()
        .from(schema.agentDelegation)
        .where(eq(schema.agentDelegation.id, prepared.id)),
    );
    expect(settled).toMatchObject({
      status: 'proposed',
      workState: 'completed',
      relayCursor: 'cursor_final',
      replyKeyCiphertext: null,
      returnedActivityId: expect.any(String),
      terminalOutcome: {
        outcome: 'completed',
        payload: {
          model: 'poolside/laguna-s-2.1',
          outputText: 'Use the existing task history to narrow the next milestone.',
        },
      },
      resultAcknowledgedAt: expect.any(Date),
    });
    expect(deps.acknowledgeResult).toHaveBeenCalledTimes(1);
    expect(deps.acknowledgeResult).toHaveBeenCalledWith(fixture.connection, prepared.workId);
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
      id: settled.returnedActivityId,
      approvalStatus: 'proposed',
      organizationId: fixture.organization.id,
      body: {
        lattice: {
          delegationId: settled.id,
          logicalSubmissionId: settled.logicalSubmissionId,
          workId: settled.workId,
          runtimeId: 'lat_mac_studio',
          runtimeName: 'Mac Studio',
          outcome: 'completed',
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
    if (proposal.body.action == null) {
      throw new Error('Expected a proposed comment action');
    }
    const proposedAction = proposal.body.action;
    await db
      .update(schema.sessionActivity)
      .set({
        approvalStatus: 'applied',
        body: {
          ...proposal.body,
          action: {
            ...proposedAction,
            result: { content: 'Comment created', isError: false },
          },
        },
      })
      .where(eq(schema.sessionActivity.id, proposal.id));
    await sweepLatticeDelegations(new Date(preparedAt.getTime() + 7_003), deps, {
      pollingEnabled: false,
      submissionsEnabled: false,
    });
    expect(
      one(
        await db
          .select()
          .from(schema.agentDelegation)
          .where(eq(schema.agentDelegation.id, prepared.id)),
      ),
    ).toMatchObject({ status: 'completed', failureCode: null });
    expect(
      one(await db.select().from(schema.agentSession).where(eq(schema.agentSession.id, sessionId))),
    ).toMatchObject({
      status: 'completed',
      endedAt: expect.any(Date),
      currentStep: 'The Lattice result was added to the assigned task',
    });
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

  it('keeps failed proposal activity history without leaving a result reference', async () => {
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
          outcome: 'completed',
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
      terminalOutcome: { outcome: 'expired', payload: terminal },
      resultAcknowledgedAt: expect.any(Date),
    });
  });

  it('acknowledges an opened completed result after access is lost before task proposal', async () => {
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
      terminalOutcome: { outcome: 'completed', payload },
      resultAcknowledgedAt: expect.any(Date),
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
