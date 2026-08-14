/**
 * Athena as the single dispatcher: one conversation, spawned agents, task linkage, interruption.
 *
 * @remarks
 * Every case here is written against a persisted outcome — a row, a constraint rejection, a
 * count of writes after a timestamp — rather than against a mock's call log, because the
 * requirements these cover are all of the form "and then nothing else happened", which a call
 * log cannot show.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type {
  collectSpawnTree as CollectSpawnTree,
  countWritesAfter as CountWritesAfter,
  dispatchAthenaWork as DispatchAthenaWork,
  interruptAthenaWork as InterruptAthenaWork,
  loadParentCandidates as LoadParentCandidates,
  ownerActorIn as OwnerActorIn,
  resolveCanonicalConversation as ResolveCanonicalConversation,
  rotateCanonicalConversation as RotateCanonicalConversation,
} from '../../src/routes/agent-dispatch';
import type {
  agentBus as AgentBus,
  reportAgentMilestone as ReportAgentMilestone,
} from '../../src/routes/agent-bus';
import { getMigratedDb } from '../support/db';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let dispatchAthenaWork!: typeof DispatchAthenaWork;
let interruptAthenaWork!: typeof InterruptAthenaWork;
let resolveCanonicalConversation!: typeof ResolveCanonicalConversation;
let rotateCanonicalConversation!: typeof RotateCanonicalConversation;
let collectSpawnTree!: typeof CollectSpawnTree;
let countWritesAfter!: typeof CountWritesAfter;
let loadParentCandidates!: typeof LoadParentCandidates;
let ownerActorIn!: typeof OwnerActorIn;
let agentBus!: typeof AgentBus;
let reportAgentMilestone!: typeof ReportAgentMilestone;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  ({
    dispatchAthenaWork,
    interruptAthenaWork,
    resolveCanonicalConversation,
    rotateCanonicalConversation,
    collectSpawnTree,
    countWritesAfter,
    loadParentCandidates,
    ownerActorIn,
  } = await import('../../src/routes/agent-dispatch'));
  ({ agentBus, reportAgentMilestone } = await import('../../src/routes/agent-bus'));
});

beforeEach(() => {
  agentBus.reset();
});

interface Workspace {
  readonly ownerUserId: string;
  readonly ownerActorId: string;
  readonly orgId: string;
  readonly teamId: string;
  readonly projectNewsletterId: string;
  readonly projectMigrationId: string;
}

/** Seed a workspace with real structure so parent resolution has something to resolve against. */
async function seedWorkspace(): Promise<Workspace> {
  const slug = `disp-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const [role] = await db
    .insert(schema.role)
    .values({
      organizationId: assertDefined(org).id,
      key: `owner-${slug}`,
      name: 'Owner',
      capabilities: ['view', 'contribute'],
    })
    .returning({ id: schema.role.id });
  const [owner] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@example.com` })
    .returning({ id: schema.user.id });
  await db.insert(schema.hub).values({ userId: assertDefined(owner).id, preferences: {} });
  const [ownerActor] = await db
    .insert(schema.actor)
    .values({
      organizationId: assertDefined(org).id,
      kind: 'human',
      displayName: 'Ada',
      userId: assertDefined(owner).id,
      roleId: assertDefined(role).id,
    })
    .returning({ id: schema.actor.id });
  const [team] = await db
    .insert(schema.team)
    .values({ organizationId: assertDefined(org).id, name: 'Core', key: `D${slug.slice(-4)}` })
    .returning({ id: schema.team.id });
  const [newsletter] = await db
    .insert(schema.project)
    .values({
      organizationId: assertDefined(org).id,
      name: 'Weekly newsletter relaunch',
      description: 'Rebuild the newsletter template, cadence and Substack import.',
      status: 'active',
      createdBy: assertDefined(ownerActor).id,
    })
    .returning({ id: schema.project.id });
  const [migration] = await db
    .insert(schema.project)
    .values({
      organizationId: assertDefined(org).id,
      name: 'Postgres upgrade',
      description: 'Move the primary database to Postgres 17 with zero downtime.',
      status: 'active',
      createdBy: assertDefined(ownerActor).id,
    })
    .returning({ id: schema.project.id });
  return {
    ownerUserId: assertDefined(owner).id,
    ownerActorId: assertDefined(ownerActor).id,
    orgId: assertDefined(org).id,
    teamId: assertDefined(team).id,
    projectNewsletterId: assertDefined(newsletter).id,
    projectMigrationId: assertDefined(migration).id,
  };
}

/** Spawn one piece of work beneath a conversation. */
async function spawn(
  workspace: Workspace,
  prompt: string,
  parentSessionId: string,
): Promise<Awaited<ReturnType<typeof DispatchAthenaWork>>> {
  return dispatchAthenaWork({
    ownerUserId: workspace.ownerUserId,
    prompt,
    organizationId: workspace.orgId,
    initiatorActorId: workspace.ownerActorId,
    parentSessionId,
  });
}

describe('one active Athena session', () => {
  it('resolves the same conversation id from every entry point', async () => {
    const workspace = await seedWorkspace();
    const first = await resolveCanonicalConversation(workspace.ownerUserId, workspace.orgId);
    const second = await resolveCanonicalConversation(workspace.ownerUserId, null);
    const third = await resolveCanonicalConversation(workspace.ownerUserId, workspace.orgId);
    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
  });

  it('converges on one open conversation even when extra open rows already exist', async () => {
    const workspace = await seedWorkspace();
    const rows = [];
    for (let index = 0; index < 3; index += 1) {
      const [created] = await db
        .insert(schema.agentSession)
        .values({
          executorKind: 'athena',
          ownerUserId: workspace.ownerUserId,
          kind: 'chat',
          trigger: 'delegation',
          status: 'pending',
          workLinkage: 'conversation',
        })
        .returning({ id: schema.agentSession.id });
      rows.push(assertDefined(created).id);
    }

    const canonical = await resolveCanonicalConversation(workspace.ownerUserId);
    const open = await db
      .select({ id: schema.agentSession.id })
      .from(schema.agentSession)
      .where(
        and(
          eq(schema.agentSession.ownerUserId, workspace.ownerUserId),
          eq(schema.agentSession.kind, 'chat'),
          inArray(schema.agentSession.status, [
            'pending',
            'running',
            'awaiting_input',
            'awaiting_approval',
          ]),
        ),
      );
    expect(open.map((row) => row.id)).toEqual([canonical.id]);
    expect(rows).toContain(canonical.id);
  });

  it('never leaves two conversations open when one is rotated', async () => {
    const workspace = await seedWorkspace();
    const first = await resolveCanonicalConversation(workspace.ownerUserId);
    const second = await rotateCanonicalConversation(workspace.ownerUserId);
    expect(second.id).not.toBe(first.id);

    const open = await db
      .select({ id: schema.agentSession.id })
      .from(schema.agentSession)
      .where(
        and(
          eq(schema.agentSession.ownerUserId, workspace.ownerUserId),
          eq(schema.agentSession.kind, 'chat'),
          inArray(schema.agentSession.status, [
            'pending',
            'running',
            'awaiting_input',
            'awaiting_approval',
          ]),
        ),
      );
    expect(open.map((row) => row.id)).toEqual([second.id]);

    // The predecessor is closed, not deleted: its history is still there to browse.
    const closed = await db
      .select({ status: schema.agentSession.status })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, first.id));
    expect(closed[0]?.status).toBe('completed');
  });

  it('gives spawned work its own session rather than a second conversation', async () => {
    const workspace = await seedWorkspace();
    const conversation = await resolveCanonicalConversation(workspace.ownerUserId, workspace.orgId);
    const dispatched = await spawn(workspace, 'Draft the newsletter template', conversation.id);
    expect(dispatched.session.kind).toBe('job');
    expect(dispatched.session.parentSessionId).toBe(conversation.id);

    const conversations = await db
      .select({ id: schema.agentSession.id })
      .from(schema.agentSession)
      .where(
        and(
          eq(schema.agentSession.ownerUserId, workspace.ownerUserId),
          eq(schema.agentSession.kind, 'chat'),
        ),
      );
    expect(conversations).toHaveLength(1);
  });
});

describe('work linkage', () => {
  it('creates a Docket task for dispatched work and files it under the right project', async () => {
    const workspace = await seedWorkspace();
    const conversation = await resolveCanonicalConversation(workspace.ownerUserId, workspace.orgId);
    const dispatched = await spawn(
      workspace,
      'Import the old Substack archive into the newsletter',
      conversation.id,
    );

    expect(dispatched.taskId).not.toBeNull();
    expect(dispatched.parent?.parent?.id).toBe(workspace.projectNewsletterId);
    expect(dispatched.linkageNote).toContain('Weekly newsletter relaunch');

    const rows = await db
      .select({ projectId: schema.task.projectId, title: schema.task.title })
      .from(schema.task)
      .where(eq(schema.task.id, assertDefined(dispatched.taskId)));
    expect(rows[0]?.projectId).toBe(workspace.projectNewsletterId);
    expect(rows[0]?.title).toBe('Import the old Substack archive into the newsletter');
  });

  it('says out loud when it could not find a parent instead of orphaning silently', async () => {
    const workspace = await seedWorkspace();
    const conversation = await resolveCanonicalConversation(workspace.ownerUserId, workspace.orgId);
    const dispatched = await spawn(workspace, 'Book a dentist appointment', conversation.id);

    expect(dispatched.taskId).not.toBeNull();
    expect(dispatched.parent?.parent).toBeNull();
    expect(dispatched.linkageNote).toContain('Created without a parent');

    const rows = await db
      .select({ projectId: schema.task.projectId })
      .from(schema.task)
      .where(eq(schema.task.id, assertDefined(dispatched.taskId)));
    expect(rows[0]?.projectId).toBeNull();
  });

  it('claims work_linkage = task on every session it tracks work for', async () => {
    const workspace = await seedWorkspace();
    const conversation = await resolveCanonicalConversation(workspace.ownerUserId, workspace.orgId);
    const dispatched = await spawn(workspace, 'Plan the Postgres upgrade', conversation.id);
    const rows = await db
      .select({ workLinkage: schema.agentSession.workLinkage, taskId: schema.agentSession.taskId })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, dispatched.session.id));
    expect(rows[0]?.workLinkage).toBe('task');
    expect(rows[0]?.taskId).toBe(dispatched.taskId);
  });

  it('is the database, not the code, that refuses tracked work with no task', async () => {
    const workspace = await seedWorkspace();
    await expect(
      db.insert(schema.agentSession).values({
        executorKind: 'athena',
        ownerUserId: workspace.ownerUserId,
        kind: 'job',
        trigger: 'delegation',
        status: 'pending',
        workLinkage: 'task',
        taskId: null,
      }),
    ).rejects.toThrow();
  });

  it('is the database that refuses to call a delegated job a conversation', async () => {
    const workspace = await seedWorkspace();
    await expect(
      db.insert(schema.agentSession).values({
        executorKind: 'athena',
        ownerUserId: workspace.ownerUserId,
        kind: 'job',
        trigger: 'delegation',
        status: 'pending',
        workLinkage: 'conversation',
      }),
    ).rejects.toThrow();
  });

  it('leaves zero task-linked sessions with a null task reference', async () => {
    const workspace = await seedWorkspace();
    const conversation = await resolveCanonicalConversation(workspace.ownerUserId, workspace.orgId);
    for (const prompt of [
      'Draft the newsletter template for next week',
      'Plan the zero downtime Postgres upgrade rehearsal',
      'Book a dentist appointment for Thursday morning',
    ]) {
      await spawn(workspace, prompt, conversation.id);
    }
    const orphans = await db
      .select({ id: schema.agentSession.id })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.workLinkage, 'task'));
    const withTask = await db
      .select({ id: schema.agentSession.id })
      .from(schema.agentSession)
      .where(and(eq(schema.agentSession.workLinkage, 'task'), eq(schema.agentSession.kind, 'job')));
    expect(orphans.length).toBe(withTask.length);
    expect(withTask.length).toBeGreaterThanOrEqual(3);
  });

  it('starts unlinked and says so when there is no workspace to create a task in', async () => {
    const workspace = await seedWorkspace();
    const dispatched = await dispatchAthenaWork({
      ownerUserId: workspace.ownerUserId,
      prompt: 'Think about the quarter',
      organizationId: null,
      initiatorActorId: null,
    });
    expect(dispatched.taskId).toBeNull();
    expect(dispatched.session.workLinkage).toBe('unclassified');
    expect(dispatched.linkageNote).toContain('Started without a tracked task');
  });

  it('offers only containers a task can actually reference as parent candidates', async () => {
    const workspace = await seedWorkspace();
    const candidates = await loadParentCandidates(workspace.orgId);
    expect(
      candidates.map((candidate) => candidate.kind).every((kind) => kind !== 'initiative'),
    ).toBe(true);
    expect(candidates.map((candidate) => candidate.id)).toContain(workspace.projectNewsletterId);
  });

  it('resolves the owner’s actor in a workspace, and nothing outside it', async () => {
    const workspace = await seedWorkspace();
    const other = await seedWorkspace();
    expect(await ownerActorIn(workspace.ownerUserId, workspace.orgId)).toBe(workspace.ownerActorId);
    expect(await ownerActorIn(workspace.ownerUserId, other.orgId)).toBeNull();
  });
});

describe('interrupting the dispatcher reaches the work it dispatched', () => {
  it('stops every spawned agent, not just the session that was interrupted', async () => {
    const workspace = await seedWorkspace();
    const conversation = await resolveCanonicalConversation(workspace.ownerUserId, workspace.orgId);
    const first = await spawn(workspace, 'Draft the newsletter template', conversation.id);
    const second = await spawn(workspace, 'Plan the Postgres upgrade', conversation.id);
    const nested = await spawn(workspace, 'Check the index build', second.session.id);

    for (const session of [first.session, second.session, nested.session]) {
      await db
        .update(schema.agentSession)
        .set({ status: 'running' })
        .where(eq(schema.agentSession.id, session.id));
    }

    const result = await interruptAthenaWork(conversation.id, workspace.ownerUserId);
    expect([...result.sessionIds].sort()).toEqual(
      [conversation.id, first.session.id, second.session.id, nested.session.id].sort(),
    );

    const rows = await db
      .select({
        id: schema.agentSession.id,
        status: schema.agentSession.status,
        interruptedAt: schema.agentSession.interruptedAt,
      })
      .from(schema.agentSession)
      .where(inArray(schema.agentSession.id, [...result.sessionIds]));
    expect(rows.every((row) => row.status === 'canceled')).toBe(true);
    expect(rows.every((row) => row.interruptedAt !== null)).toBe(true);
  });

  it('cancels each spawned agent’s live run generation', async () => {
    const workspace = await seedWorkspace();
    const conversation = await resolveCanonicalConversation(workspace.ownerUserId, workspace.orgId);
    const spawned = await spawn(workspace, 'Plan the Postgres upgrade', conversation.id);
    await db.insert(schema.agentSessionRun).values({
      sessionId: spawned.session.id,
      ownerUserId: workspace.ownerUserId,
      generation: 1,
      workflowInstanceId: `${spawned.session.id}:1`,
      status: 'running',
      dispatchOrigin: 'athena_admission',
    });

    await interruptAthenaWork(conversation.id, workspace.ownerUserId);
    const runs = await db
      .select({ status: schema.agentSessionRun.status })
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.sessionId, spawned.session.id));
    expect(runs.map((run) => run.status)).toEqual(['canceled']);
  });

  it('records zero Docket writes from the interrupted agents afterwards', async () => {
    const workspace = await seedWorkspace();
    const conversation = await resolveCanonicalConversation(workspace.ownerUserId, workspace.orgId);
    const first = await spawn(workspace, 'Draft the newsletter template', conversation.id);
    const second = await spawn(workspace, 'Plan the Postgres upgrade', conversation.id);

    const result = await interruptAthenaWork(conversation.id, workspace.ownerUserId);

    // Both agents keep trying to report after the interrupt. Every attempt must be refused.
    for (const sessionId of [first.session.id, second.session.id]) {
      for (const milestone of ['still working', 'nearly done', 'done']) {
        const published = await reportAgentMilestone({
          sessionId,
          ownerUserId: workspace.ownerUserId,
          kind: 'agent_progress',
          milestone,
        });
        expect(published).toBeNull();
      }
    }

    expect(await countWritesAfter(result.sessionIds, result.interruptedAt)).toBe(0);
  });

  it('lets each stopped agent report exactly one final stop, in the merged stream', async () => {
    const workspace = await seedWorkspace();
    const conversation = await resolveCanonicalConversation(workspace.ownerUserId, workspace.orgId);
    const first = await spawn(workspace, 'Draft the newsletter template', conversation.id);
    const second = await spawn(workspace, 'Plan the Postgres upgrade', conversation.id);

    await interruptAthenaWork(conversation.id, workspace.ownerUserId);

    const stops = agentBus
      .history({ ownerUserId: workspace.ownerUserId })
      .filter((update) => update.reasonCode === 'interrupted_by_user');
    expect(stops.map((update) => update.sessionId).sort()).toEqual(
      [conversation.id, first.session.id, second.session.id].sort(),
    );
    expect(stops.every((update) => update.kind === 'agent_failed')).toBe(true);
  });

  it('walks a spawn tree without looping forever on a cycle', async () => {
    const workspace = await seedWorkspace();
    const conversation = await resolveCanonicalConversation(workspace.ownerUserId, workspace.orgId);
    const spawned = await spawn(workspace, 'Draft the newsletter template', conversation.id);
    // A row cannot be its own parent (a CHECK forbids it), but a two-node cycle is only
    // prevented by the walk itself.
    await db
      .update(schema.agentSession)
      .set({ parentSessionId: spawned.session.id })
      .where(eq(schema.agentSession.id, conversation.id));

    const tree = await collectSpawnTree(conversation.id);
    expect([...tree].sort()).toEqual([conversation.id, spawned.session.id].sort());
  });
});

describe('agents report independently through the shared bus', () => {
  it('interleaves three concurrent agents into one ordered stream with overlapping intervals', async () => {
    const workspace = await seedWorkspace();
    const conversation = await resolveCanonicalConversation(workspace.ownerUserId, workspace.orgId);
    const spawned = await Promise.all([
      spawn(workspace, 'Draft the newsletter template', conversation.id),
      spawn(workspace, 'Plan the Postgres upgrade', conversation.id),
      spawn(workspace, 'Summarize the current cycle', conversation.id),
    ]);

    const seen: string[] = [];
    agentBus.subscribe({ ownerUserId: workspace.ownerUserId }, (update) =>
      seen.push(`${update.sessionId}:${update.milestone}`),
    );

    // One agent hangs (never reports again), one throws (reports a failure), the third finishes.
    await reportAgentMilestone({
      sessionId: spawned[0].session.id,
      ownerUserId: workspace.ownerUserId,
      kind: 'agent_started',
      milestone: 'Reading the newsletter archive',
    });
    await reportAgentMilestone({
      sessionId: spawned[1].session.id,
      ownerUserId: workspace.ownerUserId,
      kind: 'agent_failed',
      milestone: 'Could not reach the database',
      reasonCode: 'tool_unavailable',
    });
    await reportAgentMilestone({
      sessionId: spawned[2].session.id,
      ownerUserId: workspace.ownerUserId,
      kind: 'agent_started',
      milestone: 'Reading the cycle',
    });
    await reportAgentMilestone({
      sessionId: spawned[2].session.id,
      ownerUserId: workspace.ownerUserId,
      kind: 'agent_completed',
      milestone: 'Summarized the cycle',
      progress: 100,
    });

    // The third agent completed even though one hung and one failed.
    const third = agentBus.history({ sessionIds: [spawned[2].session.id] });
    expect(third.map((update) => update.kind)).toEqual(['agent_started', 'agent_completed']);
    expect(seen).toHaveLength(4);
    expect(seen[0]).toContain('Reading the newsletter archive');
  });

  it('persists the current step so a reload sees the same words the stream did', async () => {
    const workspace = await seedWorkspace();
    const conversation = await resolveCanonicalConversation(workspace.ownerUserId, workspace.orgId);
    const spawned = await spawn(workspace, 'Plan the Postgres upgrade', conversation.id);

    const steps = ['Reading the migration plan', 'Checking the index build', 'Writing the summary'];
    const observed: (string | null)[] = [];
    for (const step of steps) {
      await reportAgentMilestone({
        sessionId: spawned.session.id,
        ownerUserId: workspace.ownerUserId,
        kind: 'agent_progress',
        milestone: step,
      });
      const rows = await db
        .select({ currentStep: schema.agentSession.currentStep })
        .from(schema.agentSession)
        .where(eq(schema.agentSession.id, spawned.session.id));
      observed.push(rows[0]?.currentStep ?? null);
    }
    expect(observed).toEqual(steps);
    expect(new Set(observed).size).toBe(3);
  });

  it('names a spawned agent after the task it was spawned for, and never as a second assistant', async () => {
    const workspace = await seedWorkspace();
    const conversation = await resolveCanonicalConversation(workspace.ownerUserId, workspace.orgId);
    const spawned = await spawn(workspace, 'Summarize the current cycle', conversation.id);
    const update = await reportAgentMilestone({
      sessionId: spawned.session.id,
      ownerUserId: workspace.ownerUserId,
      kind: 'agent_started',
      milestone: 'Reading the cycle',
    });
    expect(update?.agentName).toBe('Athena · Summarize the current cycle');
    expect(update?.parentSessionId).toBe(conversation.id);
    expect(update?.taskId).toBe(spawned.taskId);
  });

  it('replays what agents said before a consumer attached', async () => {
    const workspace = await seedWorkspace();
    const conversation = await resolveCanonicalConversation(workspace.ownerUserId, workspace.orgId);
    const spawned = await spawn(workspace, 'Draft the newsletter template', conversation.id);
    await reportAgentMilestone({
      sessionId: spawned.session.id,
      ownerUserId: workspace.ownerUserId,
      kind: 'agent_started',
      milestone: 'Started before anyone was watching',
    });

    const seen: string[] = [];
    agentBus.subscribe({ ownerUserId: workspace.ownerUserId }, (update) =>
      seen.push(update.milestone),
    );
    expect(seen).toEqual(['Started before anyone was watching']);
  });

  it('drops a report from a session that no longer exists', async () => {
    const workspace = await seedWorkspace();
    expect(
      await reportAgentMilestone({
        sessionId: 'not-a-session',
        ownerUserId: workspace.ownerUserId,
        kind: 'agent_progress',
        milestone: 'ghost',
      }),
    ).toBeNull();
  });
});

describe('dispatched work keeps its ordering guarantees', () => {
  it('records the spawn label and first step on the session itself', async () => {
    const workspace = await seedWorkspace();
    const conversation = await resolveCanonicalConversation(workspace.ownerUserId, workspace.orgId);
    const spawned = await spawn(workspace, 'Draft the newsletter template', conversation.id);
    const rows = await db
      .select({
        spawnLabel: schema.agentSession.spawnLabel,
        currentStep: schema.agentSession.currentStep,
      })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, spawned.session.id));
    expect(rows[0]?.spawnLabel).toBe('Draft the newsletter template');
    expect(rows[0]?.currentStep).toBe('Getting started');
  });

  it('keeps an existing task rather than creating a second one', async () => {
    const workspace = await seedWorkspace();
    const [existing] = await db
      .insert(schema.task)
      .values({
        organizationId: workspace.orgId,
        title: 'Already tracked',
        teamId: workspace.teamId,
        state: 'backlog',
        source: 'native',
        createdBy: workspace.ownerActorId,
      })
      .returning({ id: schema.task.id });
    const before = await db.select({ id: schema.task.id }).from(schema.task);

    const dispatched = await dispatchAthenaWork({
      ownerUserId: workspace.ownerUserId,
      prompt: 'Keep going on the tracked thing',
      organizationId: workspace.orgId,
      initiatorActorId: workspace.ownerActorId,
      taskId: assertDefined(existing).id,
    });
    const after = await db.select({ id: schema.task.id }).from(schema.task);
    expect(dispatched.taskId).toBe(assertDefined(existing).id);
    expect(after.length).toBe(before.length);
  });

  it('orders spawned work under one conversation for browsing', async () => {
    const workspace = await seedWorkspace();
    const conversation = await resolveCanonicalConversation(workspace.ownerUserId, workspace.orgId);
    await spawn(workspace, 'Draft the newsletter template', conversation.id);
    await spawn(workspace, 'Plan the Postgres upgrade', conversation.id);

    const children = await db
      .select({ label: schema.agentSession.spawnLabel })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.parentSessionId, conversation.id))
      .orderBy(asc(schema.agentSession.createdAt), asc(schema.agentSession.id));
    expect(children.map((row) => row.label)).toEqual([
      'Draft the newsletter template',
      'Plan the Postgres upgrade',
    ]);
  });
});
