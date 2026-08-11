import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['DATABASE_URL'] = 'pglite://memory://';
  process.env['APP_MODE'] = 'test';
  process.env['NODE_ENV'] = 'test';
  process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
  process.env['CRON_SECRET'] = 'test-cron-secret';
  process.env['SKIP_ENV_VALIDATION'] = '1';
  process.env['AGENT_MAX_TURNS'] = '8';
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = Buffer.from('0'.repeat(32)).toString('base64');
});

const getSession = vi.fn(async () => null);
vi.mock('@docket/auth', () => ({ auth: { api: { getSession } } }));

import type * as DbModule from '@docket/db';
import {
  DelegationUnavailableError,
  type DelegationPoll,
  type DelegationPort,
  type DelegationRequest,
  type DelegationSubmission,
} from '@docket/integrations';

import type { approveAndResume as ApproveAndResume } from '../../src/agent/loop';
import type { sweepAgentDelegations as SweepAgentDelegations } from '../../src/agent/delegation';
import type { getContainer as GetContainer } from '../../src/container';
import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let sweepAgentDelegations!: typeof SweepAgentDelegations;
let approveAndResume!: typeof ApproveAndResume;
let getContainer!: typeof GetContainer;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  ({ sweepAgentDelegations } = await import('../../src/agent/delegation'));
  ({ approveAndResume } = await import('../../src/agent/loop'));
  ({ getContainer } = await import('../../src/container'));
});

/**
 * A delegation surface under the test's control.
 *
 * @remarks
 * Scripted rather than recorded: each test says what the far side does, and then asserts on what
 * Docket persisted. The counters exist to prove "submitted once", never to stand in for the
 * assertion — every test below checks database rows.
 */
class FakeDelegation implements DelegationPort {
  readonly submissions: DelegationRequest[] = [];
  readonly polledWorkIds: string[] = [];
  private counter = 0;

  constructor(
    private readonly script: {
      readonly onSubmit?: (request: DelegationRequest) => void;
      readonly polls: readonly DelegationPoll[];
      readonly onPoll?: (workId: string) => void;
    },
  ) {}

  async submit(request: DelegationRequest): Promise<DelegationSubmission> {
    await Promise.resolve();
    this.script.onSubmit?.(request);
    this.submissions.push(request);
    return {
      workId: `work-${(this.counter += 1)}`,
      state: 'queued',
      runtimeId: 'lat_studio',
      runtimeName: 'Willie’s Mac Studio',
      deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }

  async poll(workId: string): Promise<DelegationPoll> {
    await Promise.resolve();
    this.script.onPoll?.(workId);
    this.polledWorkIds.push(workId);
    const next =
      this.script.polls[Math.min(this.polledWorkIds.length - 1, this.script.polls.length - 1)];
    /* v8 ignore next -- @preserve defensive: every test scripts at least one poll */
    if (!next) throw new Error('FakeDelegation ran out of scripted polls');
    return next;
  }
}

/** A poll that reports finished work with a written report. */
function completedPoll(outputText: string): DelegationPoll {
  return {
    state: 'completed',
    nextPollAfterMs: 0,
    result: {
      outcome: 'completed',
      payload: { outputText },
      openedAt: new Date().toISOString(),
    },
  };
}

function useDelegation(client: DelegationPort | null): void {
  vi.spyOn(getContainer(), 'delegation', 'get').mockReturnValue(client);
}

interface Seed {
  readonly userId: string;
  readonly orgId: string;
  readonly humanActorId: string;
  readonly agentActorId: string;
  readonly teamId: string;
  readonly taskId: string;
}

/**
 * Seed one person who has authorized their own machine, and one task delegated to an agent.
 *
 * @remarks
 * `delegate_id` pointing at an Actor with `kind = 'agent'` is what "agent-assigned" means in this
 * data model, and the enabled `lattice_connection` is what makes that person's backlog eligible
 * to drain. Both are the real columns the sweep reads; nothing here is a test-only affordance.
 */
async function seed(options: { readonly latticeEnabled?: boolean } = {}): Promise<Seed> {
  const slug = `dl-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const [role] = await db
    .insert(schema.role)
    .values({
      organizationId: org!.id,
      key: `member-${slug}`,
      name: 'Member',
      capabilities: ['view', 'contribute', 'comment'],
    })
    .returning({ id: schema.role.id });
  const [owner] = await db
    .insert(schema.user)
    .values({ name: 'Willie', email: `${slug}@example.com` })
    .returning({ id: schema.user.id });
  const [humanActor] = await db
    .insert(schema.actor)
    .values({
      organizationId: org!.id,
      kind: 'human',
      displayName: 'Willie',
      userId: owner!.id,
      roleId: role!.id,
    })
    .returning({ id: schema.actor.id });
  const [agentActor] = await db
    .insert(schema.actor)
    .values({ organizationId: org!.id, kind: 'agent', displayName: 'Athena' })
    .returning({ id: schema.actor.id });
  await db.insert(schema.grant).values({
    organizationId: org!.id,
    subjectKind: 'role',
    subjectId: role!.id,
    resourceKind: 'organization',
    resourceId: org!.id,
    capabilities: ['view', 'contribute', 'comment'],
    effect: 'allow',
  });
  const [team] = await db
    .insert(schema.team)
    .values({ organizationId: org!.id, name: 'Core', key: `D${slug.slice(-4)}` })
    .returning({ id: schema.team.id });
  const [taskRow] = await db
    .insert(schema.task)
    .values({
      organizationId: org!.id,
      teamId: team!.id,
      title: 'Fix the flaky migration test',
      description: 'It fails on a cold database.',
      state: 'todo',
      assigneeId: humanActor!.id,
      delegateId: agentActor!.id,
      createdBy: humanActor!.id,
    })
    .returning({ id: schema.task.id });
  if (options.latticeEnabled !== false) {
    await db.insert(schema.latticeConnection).values({
      ownerUserId: owner!.id,
      status: 'connected',
      enabled: true,
      deviceId: 'lat_studio',
      deviceName: 'Willie’s Mac Studio',
    });
  }
  return {
    userId: owner!.id,
    orgId: org!.id,
    humanActorId: humanActor!.id,
    agentActorId: agentActor!.id,
    teamId: team!.id,
    taskId: taskRow!.id,
  };
}

async function delegationsFor(taskId: string) {
  return db.select().from(schema.agentDelegation).where(eq(schema.agentDelegation.taskId, taskId));
}

async function commentsOn(taskId: string) {
  return db
    .select()
    .from(schema.comment)
    .where(and(eq(schema.comment.subjectType, 'task'), eq(schema.comment.subjectId, taskId)));
}

async function proposalsFor(sessionId: string) {
  return db
    .select()
    .from(schema.sessionActivity)
    .where(
      and(
        eq(schema.sessionActivity.sessionId, sessionId),
        eq(schema.sessionActivity.type, 'action'),
      ),
    );
}

beforeEach(async () => {
  vi.restoreAllMocks();
  // The drain is global by design — it looks at every eligible person, not at one test's seed —
  // so each test has to start from an empty eligible set for its counts to mean anything.
  await db.delete(schema.agentDelegation);
  await db.delete(schema.latticeConnection);
  await db.update(schema.task).set({ delegateId: null });
});

describe('standing delegation drain', () => {
  it('carries an agent-assigned task out and lands its result on the task through the proposal path', async () => {
    const seeded = await seed();
    const client = new FakeDelegation({
      polls: [
        { state: 'in_flight', nextPollAfterMs: 500, result: null },
        completedPoll('Pinned the migration order; the suite is green on a cold database.'),
      ],
    });
    useDelegation(client);

    // Pass one hands the task out.
    const first = await sweepAgentDelegations(new Date());
    expect(first).toMatchObject({ submitted: 1, polled: 0, posted: 0, failed: 0 });
    const [afterSubmit] = await delegationsFor(seeded.taskId);
    expect(afterSubmit).toMatchObject({
      status: 'submitted',
      surface: 'lattice',
      externalWorkId: 'work-1',
      runtimeId: 'lat_studio',
      workState: 'queued',
      resultActivityId: null,
    });
    expect(afterSubmit?.sessionId).toBeTruthy();
    // The instruction is the task itself, and the far side gets an idempotency key it can dedupe
    // on that is the delegation record, not a fresh value per attempt.
    expect(client.submissions[0]?.instruction).toContain('Fix the flaky migration test');
    expect(client.submissions[0]?.logicalSubmissionId).toBe(afterSubmit?.id);

    // Pass two sees work still running: nothing is posted, nothing is re-submitted.
    const second = await sweepAgentDelegations(new Date());
    expect(second).toMatchObject({ submitted: 0, polled: 1, posted: 0, failed: 0 });
    expect((await delegationsFor(seeded.taskId))[0]?.status).toBe('submitted');

    // Pass three polls the finished result back and posts it as a gated proposal.
    const third = await sweepAgentDelegations(new Date());
    expect(third).toMatchObject({ submitted: 0, polled: 1, posted: 1, failed: 0 });
    const [settled] = await delegationsFor(seeded.taskId);
    expect(settled).toMatchObject({
      status: 'completed',
      outcome: 'completed',
      workState: 'completed',
    });
    expect(settled?.resultActivityId).toBeTruthy();
    expect(settled?.completedAt).not.toBeNull();

    // Nothing has touched the task yet — the result is a proposal awaiting a human.
    expect(await commentsOn(seeded.taskId)).toHaveLength(0);
    const sessionId = settled!.sessionId!;
    const proposals = await proposalsFor(sessionId);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.approvalStatus).toBe('proposed');
    expect(proposals[0]?.body.action?.toolCall).toMatchObject({
      connection: 'docket',
      tool: 'comment',
      input: { orgId: seeded.orgId, subjectType: 'task', subjectId: seeded.taskId },
    });
    const [session] = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, sessionId));
    expect(session).toMatchObject({
      executorKind: 'athena',
      ownerUserId: seeded.userId,
      contextOrganizationId: seeded.orgId,
      taskId: seeded.taskId,
      trigger: 'delegation',
      status: 'awaiting_approval',
    });

    // Approving through the real approval path is what writes to the task.
    await approveAndResume(seeded.orgId, seeded.humanActorId, sessionId, proposals[0]!.id, {
      decision: 'approve',
    });

    const comments = await commentsOn(seeded.taskId);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain(
      'Pinned the migration order; the suite is green on a cold database.',
    );
    // Provenance a reviewer can act on: which machine ran it, and which record it came from.
    expect(comments[0]?.body).toContain('Willie’s Mac Studio');
    expect(comments[0]?.body).toContain(settled!.id);
    expect(comments[0]?.authorId).toBe(seeded.humanActorId);
    const [applied] = await db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, proposals[0]!.id));
    expect(applied?.approvalStatus).toBe('applied');

    // A delegation session carries one proposal and no conversation, so the approval path has
    // nothing to resume and leaves it running. The next pass closes it rather than leaving the
    // person looking at work that is over.
    const afterClose = await sweepAgentDelegations(new Date());
    expect(afterClose.closed).toBe(1);
    const [finished] = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, sessionId));
    expect(finished?.status).toBe('completed');
    expect(finished?.endedAt).not.toBeNull();
  });

  it('submits each task once and posts each result once, however often the drain runs', async () => {
    const seeded = await seed();
    const client = new FakeDelegation({
      polls: [completedPoll('Done in one pass.')],
    });
    useDelegation(client);

    await sweepAgentDelegations(new Date());
    expect(client.submissions).toHaveLength(1);

    // Second pass: the finished result is polled back and posted.
    await sweepAgentDelegations(new Date());
    const afterPost = await delegationsFor(seeded.taskId);
    expect(afterPost).toHaveLength(1);
    const sessionId = afterPost[0]!.sessionId!;
    const activityId = afterPost[0]!.resultActivityId;
    expect(activityId).toBeTruthy();

    // Third and fourth passes must be no-ops: the task is not handed out again (it is settled but
    // its result is already delivered), and no second proposal appears.
    const third = await sweepAgentDelegations(new Date());
    const fourth = await sweepAgentDelegations(new Date());
    expect(third).toMatchObject({ submitted: 0, posted: 0 });
    expect(fourth).toMatchObject({ submitted: 0, posted: 0 });

    expect(client.submissions).toHaveLength(1);
    expect(await delegationsFor(seeded.taskId)).toHaveLength(1);
    expect((await delegationsFor(seeded.taskId))[0]?.resultActivityId).toBe(activityId);
    expect(await proposalsFor(sessionId)).toHaveLength(1);

    // And after approval, still exactly one comment on the task.
    await approveAndResume(seeded.orgId, seeded.humanActorId, sessionId, activityId!, {
      decision: 'approve',
    });
    expect(await commentsOn(seeded.taskId)).toHaveLength(1);
    await sweepAgentDelegations(new Date());
    expect(await commentsOn(seeded.taskId)).toHaveLength(1);
  });

  it('records a failed submission and leaves the task delegatable again', async () => {
    const seeded = await seed();
    const failing = new FakeDelegation({
      onSubmit: () => {
        throw new DelegationUnavailableError('runtime_unreachable');
      },
      polls: [],
    });
    useDelegation(failing);

    const result = await sweepAgentDelegations(new Date());
    expect(result).toMatchObject({ submitted: 0, failed: 1, posted: 0 });

    const [settled] = await delegationsFor(seeded.taskId);
    expect(settled).toMatchObject({
      status: 'failed',
      lastFailureReason: 'runtime_unreachable',
      outcome: null,
    });
    // Not swallowed: the reason is a stable code and the detail is kept for whoever looks.
    expect(settled?.lastFailureDetail).toBeTruthy();
    const [errored] = await db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, settled!.sessionId!),
          eq(schema.sessionActivity.type, 'error'),
        ),
      );
    expect(errored?.body.text).toBe('delegation_failed:runtime_unreachable');
    expect(await commentsOn(seeded.taskId)).toHaveLength(0);

    // Held back inside the retry cooldown, so a failure never becomes a hot loop.
    expect(await sweepAgentDelegations(new Date())).toMatchObject({ submitted: 0 });
    expect(await delegationsFor(seeded.taskId)).toHaveLength(1);

    // Recoverable: once the cooldown has passed, the same task is handed out again — to a
    // surface that now works.
    const working = new FakeDelegation({ polls: [completedPoll('Second attempt succeeded.')] });
    useDelegation(working);
    const later = new Date(Date.now() + 30 * 60_000);
    const retried = await sweepAgentDelegations(later);
    expect(retried).toMatchObject({ submitted: 1 });
    expect(working.submissions).toHaveLength(1);
    expect(await delegationsFor(seeded.taskId)).toHaveLength(2);
  });

  it('records a run that came back failed and leaves the task delegatable again', async () => {
    const seeded = await seed();
    useDelegation(
      new FakeDelegation({
        polls: [
          {
            state: 'failed',
            nextPollAfterMs: 0,
            result: {
              outcome: 'failed',
              payload: { outputText: 'The build never finished.' },
              openedAt: new Date().toISOString(),
            },
          },
        ],
      }),
    );

    await sweepAgentDelegations(new Date());
    const failedPass = await sweepAgentDelegations(new Date());
    expect(failedPass).toMatchObject({ posted: 0, failed: 1 });

    const [settled] = await delegationsFor(seeded.taskId);
    expect(settled).toMatchObject({
      status: 'failed',
      outcome: 'failed',
      workState: 'failed',
      lastFailureReason: 'delegation_failed',
    });
    expect(settled?.resultActivityId).toBeNull();
    expect(await proposalsFor(settled!.sessionId!)).toHaveLength(0);
    expect(await commentsOn(seeded.taskId)).toHaveLength(0);
    const [session] = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, settled!.sessionId!));
    expect(session?.status).toBe('failed');
  });

  it('keeps a delegation outstanding when the surface is only temporarily unreachable', async () => {
    const seeded = await seed();
    let polls = 0;
    const client = new FakeDelegation({
      onPoll: () => {
        polls += 1;
        if (polls === 1) throw new DelegationUnavailableError('runtime_unreachable');
      },
      polls: [completedPoll('Recovered.')],
    });
    useDelegation(client);

    await sweepAgentDelegations(new Date());
    const flaky = await sweepAgentDelegations(new Date());
    expect(flaky).toMatchObject({ polled: 1, posted: 0, failed: 0 });
    const [held] = await delegationsFor(seeded.taskId);
    expect(held).toMatchObject({ status: 'submitted', lastFailureReason: 'runtime_unreachable' });

    const recovered = await sweepAgentDelegations(new Date());
    expect(recovered).toMatchObject({ posted: 1, failed: 0 });
    expect((await delegationsFor(seeded.taskId))[0]?.status).toBe('completed');
  });

  it('does nothing at all when no delegation surface is configured', async () => {
    const seeded = await seed();
    useDelegation(null);

    expect(await sweepAgentDelegations(new Date())).toEqual({
      submitted: 0,
      polled: 0,
      posted: 0,
      failed: 0,
      closed: 0,
      deferred: 0,
    });
    expect(await delegationsFor(seeded.taskId)).toHaveLength(0);
  });

  it('leaves a person who has not authorized their own machine alone', async () => {
    const seeded = await seed({ latticeEnabled: false });
    const client = new FakeDelegation({ polls: [] });
    useDelegation(client);

    expect(await sweepAgentDelegations(new Date())).toMatchObject({ submitted: 0 });
    expect(client.submissions).toHaveLength(0);
    expect(await delegationsFor(seeded.taskId)).toHaveLength(0);
  });

  it('ignores work that is not assigned to an agent', async () => {
    const seeded = await seed();
    await db.update(schema.task).set({ delegateId: null }).where(eq(schema.task.id, seeded.taskId));
    const client = new FakeDelegation({ polls: [] });
    useDelegation(client);

    expect(await sweepAgentDelegations(new Date())).toMatchObject({ submitted: 0 });
    expect(await delegationsFor(seeded.taskId)).toHaveLength(0);
  });
});
