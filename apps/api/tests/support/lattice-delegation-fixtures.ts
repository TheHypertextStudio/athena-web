import { eq } from 'drizzle-orm';
import { vi } from 'vitest';
import type * as DbModule from '@docket/db';
import type { LatticeDelegationDependencies } from '../../src/agent/lattice-delegations';
import { getDb, one, seedStatuses } from './routes-harness';

const ENABLED_SWEEP = { pollingEnabled: true, submissionsEnabled: true } as const;

/** Owner-matched work and device used by durable delegation behavior tests. */
export interface LatticeFixture {
  owner: { id: string };
  ownerActor: { id: string };
  organization: { id: string };
  project: { id: string };
  targetTask: { id: string };
  connection: typeof DbModule.latticeConnection.$inferSelect;
  assignment: typeof DbModule.athenaAssignment.$inferSelect;
}

/** Seed authorized work and an enabled owner-matched Lattice connection. */
export async function seed(): Promise<LatticeFixture> {
  const schema = await getDb();
  const db = schema.db;
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
  const work = await seedWork({
    organizationId: organization.id,
    ownerId: owner.id,
    ownerActorId: ownerActor.id,
    statusId,
    suffix,
  });
  return { owner, ownerActor, organization, ...work };
}

async function seedWork({
  organizationId,
  ownerId,
  ownerActorId,
  statusId,
  suffix,
}: {
  organizationId: string;
  ownerId: string;
  ownerActorId: string;
  statusId: Awaited<ReturnType<typeof seedStatuses>>;
  suffix: string;
}) {
  const schema = await getDb();
  const db = schema.db;
  const team = one(
    await db
      .insert(schema.team)
      .values({ organizationId: organizationId, name: 'Core', key: `D${suffix.slice(0, 4)}` })
      .returning({ id: schema.team.id }),
  );
  const project = one(
    await db
      .insert(schema.project)
      .values({
        organizationId: organizationId,
        name: 'Lattice proof',
        status: 'active',
        statusId: statusId('project', 'active'),
        teamId: team.id,
        leadId: ownerActorId,
        createdBy: ownerActorId,
      })
      .returning({ id: schema.project.id }),
  );
  const targetTask = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: organizationId,
        teamId: team.id,
        projectId: project.id,
        title: 'Prove the round trip',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        assigneeId: ownerActorId,
        createdBy: ownerActorId,
      })
      .returning({ id: schema.task.id }),
  );
  const connection = one(
    await db
      .insert(schema.latticeConnection)
      .values({
        ownerUserId: ownerId,
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
        ownerUserId: ownerId,
        organizationId: organizationId,
        entityType: 'task',
        entityId: targetTask.id,
        objective: 'Analyze the task and return one useful recommendation.',
      })
      .returning(),
  );
  return { project, targetTask, connection, assignment };
}

/** Build a controllable relay boundary without replacing Docket persistence. */
export function dependencies(): LatticeDelegationDependencies & {
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
    generateReplyKey: vi.fn(async (keyId: string) => ({
      keyId,
      publicKey: 'reply-public',
      privateKey: 'reply-private',
    })),
    buildAgentTaskCommand: vi.fn(
      (input: Parameters<LatticeDelegationDependencies['buildAgentTaskCommand']>[0]) => ({
        kind: 'agent_runtime_command',
        schemaVersion: 2,
        ...input,
      }),
    ),
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
            // This shared fixture also serves tests that submit at the real clock time.
            // Expired-key behavior uses an explicit short-lived key below.
            notAfter: '2100-01-01T00:00:00.000Z',
          },
        ],
      },
    ]),
    submitWork: vi.fn(
      async (
        _connection: unknown,
        input: Parameters<LatticeDelegationDependencies['submitWork']>[1],
      ) => {
        submitted.push({ ...input });
        return { workId: input.workId, state: 'queued' as const };
      },
    ),
    pollEvents: vi.fn(async (_connection: unknown, workId: string) => ({ ...pollResult, workId })),
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

/** Submit and collect a completed relay result through the production scheduler. */
export async function prepareProposedResult(
  fixture: Awaited<ReturnType<typeof seed>>,
  deps: ReturnType<typeof dependencies>,
  preparedAt: Date,
): Promise<{
  activity: typeof DbModule.sessionActivity.$inferSelect;
  delegation: typeof DbModule.agentDelegation.$inferSelect;
  sessionId: string;
}> {
  const schema = await getDb();
  const db = schema.db;
  const { prepareLatticeAssignmentRun, sweepLatticeDelegations } =
    await import('../../src/agent/lattice-delegations');
  const sessionId = await prepareLatticeAssignmentRun(
    fixture.assignment,
    fixture.ownerActor.id,
    fixture.assignment.objective,
    `athena-assignment:${fixture.assignment.id}:proposal-lifecycle`,
    fixture.connection,
    preparedAt,
    deps,
  );
  await sweepLatticeDelegations(preparedAt, deps, ENABLED_SWEEP);
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
  await sweepLatticeDelegations(new Date(preparedAt.getTime() + 5_001), deps, ENABLED_SWEEP);
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
