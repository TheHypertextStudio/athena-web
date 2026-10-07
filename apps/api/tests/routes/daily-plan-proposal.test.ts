import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type * as DbModule from '@docket/db';
import type dailyPlanRouter from '../../src/routes/daily-plan';
import {
  appWithSession,
  fakeSession,
  getDb,
  seedBaseOrg,
  seedStatuses,
  seedUserWithHub,
} from '../support/routes-harness';

let schema: typeof DbModule;
let router: typeof dailyPlanRouter;
beforeAll(async () => {
  schema = await getDb();
  router = (await import('../../src/routes/daily-plan')).default;
});
const date = '2027-01-05';
const headers = { 'content-type': 'application/json' };
const at = (hour: number): string => `2027-01-05T${String(hour).padStart(2, '0')}:00:00.000Z`;
function required<T>(row: T | undefined): T {
  if (!row) throw new Error('Expected seeded row');
  return row;
}

async function assignedWork(userId: string, title: string, estimateMinutes: number | null) {
  const { orgId, teamId } = await seedBaseOrg(schema.db, schema);
  const [actor] = await schema.db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Planner', userId })
    .returning();
  const statusId = await seedStatuses(schema.db, schema, orgId);
  const [task] = await schema.db
    .insert(schema.task)
    .values({
      organizationId: orgId,
      teamId,
      title,
      assigneeId: required(actor).id,
      state: 'todo',
      statusId: statusId('task', 'todo'),
      visibility: 'public',
      estimate: 100,
      estimateMinutes,
      dueDate: new Date(at(17)),
    })
    .returning();
  return { task: required(task), orgId, teamId, statusId };
}

interface ProposalBody {
  draft: {
    tasks: { taskId: string; plannedMinutes: number; durationSource: string }[];
    sessions: {
      startsAt: string;
      endsAt: string;
      allocations: { taskId: string; plannedMinutes: number }[];
    }[];
  };
  tasks: { taskId: string; organizationId: string; title: string }[];
  unplaced: { taskId: string; reason: string }[];
  revision: number;
  workScheduleMissing: boolean;
  fixedIntervals: { id: string; title: string; kind: string }[];
}

async function proposal(userId: string, body: object = {}): Promise<ProposalBody> {
  const app = appWithSession(router, fakeSession(userId));
  const response = await app.request(`/day/${date}/proposal`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<ProposalBody>;
}

describe('daily proposal visible work and duration evidence', () => {
  it('selects assigned tasks across workspaces and never converts point estimates', async () => {
    const userId = await seedUserWithHub(schema.db, schema, 'ProposalCrossOrg');
    const first = await assignedWork(userId, 'Minute estimate', 90);
    const second = await assignedWork(userId, 'Points only', null);
    const result = await proposal(userId);
    expect(result.tasks.map((entry) => entry.organizationId)).toEqual(
      expect.arrayContaining([first.orgId, second.orgId]),
    );
    expect(result.draft.tasks.find((entry) => entry.taskId === first.task.id)).toMatchObject({
      plannedMinutes: 90,
      durationSource: 'estimate',
    });
    expect(result.draft.tasks.find((entry) => entry.taskId === second.task.id)).toMatchObject({
      plannedMinutes: 45,
      durationSource: 'default',
    });
    expect(result.draft.sessions.length).toBeGreaterThan(0);
  });

  it('keeps edited duration and exclusions without modifying the task estimate', async () => {
    const userId = await seedUserWithHub(schema.db, schema, 'ProposalEdited');
    const first = await assignedWork(userId, 'Edited work', 120);
    const second = await assignedWork(userId, 'Excluded work', 45);
    const result = await proposal(userId, {
      draft: {
        date,
        finishAt: at(12),
        mainTaskId: first.task.id,
        tasks: [
          { taskId: first.task.id, organizationId: first.orgId, plannedMinutes: 25, sort: 0 },
        ],
        sessions: [],
        settings: {
          startAt: at(10),
          bufferPercent: 0,
          excludedTaskIds: [second.task.id],
          sequenceEdited: true,
        },
      },
    });
    expect(result.draft.tasks).toEqual([
      expect.objectContaining({
        taskId: first.task.id,
        plannedMinutes: 25,
        durationSource: 'edited',
      }),
    ]);
    expect(result.draft.sessions[0]?.startsAt).toBe(at(10));
    const [stored] = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, first.task.id));
    expect(stored?.estimateMinutes).toBe(120);
  });

  it.each([
    { source: 'default', resolved: false, budget: 90, expectedSource: 'estimate' },
    { source: 'default', resolved: true, budget: 45, expectedSource: 'default' },
    { source: 'edited', resolved: false, budget: 45, expectedSource: 'edited' },
  ])(
    'resolves newly added default time and preserves resolved commitments: %j',
    async (scenario) => {
      const userId = await seedUserWithHub(schema.db, schema, 'ProposalDefaultSelection');
      const work = await assignedWork(userId, 'Added existing work', 90);
      const result = await proposal(userId, {
        draft: {
          date,
          finishAt: at(17),
          mainTaskId: null,
          sessions: [],
          tasks: [
            {
              taskId: work.task.id,
              organizationId: work.orgId,
              plannedMinutes: 45,
              sort: 0,
              selectionSource: 'explicit',
              durationSource: scenario.source,
              durationResolved: scenario.resolved,
            },
          ],
        },
      });
      expect(result.draft.tasks[0]).toMatchObject({
        plannedMinutes: scenario.budget,
        durationSource: scenario.expectedSource,
        durationResolved: true,
      });
      const rebuilt = await proposal(userId, { draft: result.draft });
      expect(rebuilt.draft).toEqual(result.draft);
    },
  );

  it('strands work blocked by an unfinished task outside the proposal', async () => {
    const userId = await seedUserWithHub(schema.db, schema, 'ProposalBlocked');
    const work = await assignedWork(userId, 'Cannot start yet', 30);
    const [blocker] = await schema.db
      .insert(schema.task)
      .values({
        organizationId: work.orgId,
        teamId: work.teamId,
        title: 'Unassigned blocker',
        state: 'todo',
        statusId: work.statusId('task', 'todo'),
        visibility: 'public',
      })
      .returning();
    await schema.db.insert(schema.taskDependency).values({
      organizationId: work.orgId,
      blockingTaskId: required(blocker).id,
      blockedTaskId: work.task.id,
    });
    const result = await proposal(userId);
    expect(result.unplaced).toEqual([
      { taskId: work.task.id, remainingMinutes: 30, reason: 'blocked' },
    ]);
    expect(result.draft.sessions).toEqual([]);
  });

  it('does not suggest completed work', async () => {
    const userId = await seedUserWithHub(schema.db, schema, 'ProposalCompleted');
    const work = await assignedWork(userId, 'Done', 30);
    await schema.db
      .update(schema.task)
      .set({ completedAt: new Date() })
      .where(eq(schema.task.id, work.task.id));
    expect((await proposal(userId)).draft.tasks).toEqual([]);
  });

  it.each([
    { estimate: 90, source: 'estimate', budget: 90, future: 60 },
    { estimate: null, source: 'history', budget: 30, future: 0 },
  ])('subtracts recorded work once from the $source budget across rebuilds', async (scenario) => {
    const userId = await seedUserWithHub(schema.db, schema, 'ProposalRecorded');
    const work = await assignedWork(userId, 'Remaining estimate', scenario.estimate);
    const [hub] = await schema.db.select().from(schema.hub).where(eq(schema.hub.userId, userId));
    const startedAt = new Date(at(8));
    const endedAt = new Date('2027-01-05T08:30:00.000Z');
    const [record] = await schema.db
      .insert(schema.timeRecord)
      .values({
        hubId: required(hub).id,
        createdByUserId: userId,
        taskId: work.task.id,
        title: work.task.title,
        status: 'closed',
        startedAt,
        endedAt,
      })
      .returning();
    await schema.db.insert(schema.timeInterval).values({
      timeRecordId: required(record).id,
      hubId: required(hub).id,
      taskId: work.task.id,
      actorKind: 'human',
      userId,
      mode: 'human_active',
      source: 'user_timer',
      startedAt,
      endedAt,
      closedAt: endedAt,
    });
    const result = await proposal(userId);
    expect(result.draft.tasks[0]).toMatchObject({
      plannedMinutes: scenario.budget,
      durationSource: scenario.source,
    });
    const allocated = result.draft.sessions
      .flatMap((session) => session.allocations)
      .reduce((sum, allocation) => sum + allocation.plannedMinutes, 0);
    expect(allocated).toBe(scenario.future);
    const rebuilt = await proposal(userId, { draft: result.draft });
    expect(rebuilt.draft).toEqual(result.draft);
  });

  it('keeps protected windows open and exposes them as calendar context', async () => {
    const userId = await seedUserWithHub(schema.db, schema, 'ProposalProtected');
    await assignedWork(userId, 'Long work', 240);
    const [hub] = await schema.db.select().from(schema.hub).where(eq(schema.hub.userId, userId));
    await schema.db.insert(schema.schedulingPreference).values({
      hubId: required(hub).id,
      timezone: 'UTC',
      windows: [
        { weekday: 2, startMinute: 540, endMinute: 1020, kind: 'desk', label: 'Work' },
        { weekday: 2, startMinute: 600, endMinute: 660, kind: 'personal', label: 'Lunch' },
      ],
    });
    const result = await proposal(userId);
    expect(result.workScheduleMissing).toBe(false);
    expect(result.fixedIntervals).toEqual([
      expect.objectContaining({ title: 'Lunch', kind: 'protected' }),
    ]);
    expect(
      result.draft.sessions.every(
        (session) => session.endsAt <= at(10) || session.startsAt >= at(11),
      ),
    ).toBe(true);
  });
  it('splits remaining work across canonical segments and preserves an explicit day off', async () => {
    const userId = await seedUserWithHub(schema.db, schema, 'ProposalCanonical');
    await assignedWork(userId, 'Two work segments', 90);
    const [hub] = await schema.db.select().from(schema.hub).where(eq(schema.hub.userId, userId));
    const [plan] = await schema.db
      .insert(schema.workSchedulePlan)
      .values({
        hubId: required(hub).id,
        anchorDate: date,
        effectiveFrom: date,
        timezone: 'UTC',
        cycleDays: [
          {
            segments: [
              { startMinute: 540, durationMinutes: 30, location: { type: 'mobile' } },
              { startMinute: 600, durationMinutes: 30, location: { type: 'undecided' } },
            ],
          },
        ],
      })
      .returning();
    const result = await proposal(userId, {
      draft: {
        date,
        finishAt: at(11),
        mainTaskId: null,
        tasks: [],
        sessions: [],
        settings: { startAt: at(9), bufferPercent: 0 },
      },
    });
    expect(result.workScheduleMissing).toBe(false);
    expect(result.draft.sessions).toHaveLength(2);
    expect(result.draft.sessions.map((session) => session.startsAt)).toEqual([at(9), at(10)]);
    expect(result.unplaced).toEqual([
      { taskId: result.draft.tasks[0]?.taskId, remainingMinutes: 30, reason: 'insufficient_time' },
    ]);
    await schema.db
      .insert(schema.workScheduleException)
      .values({ hubId: required(hub).id, planVersionId: required(plan).id, date, segments: [] });
    const dayOff = await proposal(userId);
    expect(dayOff.workScheduleMissing).toBe(false);
    expect(dayOff.draft.sessions).toEqual([]);
    expect(dayOff.unplaced[0]?.reason).toBe('no_availability');
  });

  it('reserves active work without making another future block for that task', async () => {
    const userId = await seedUserWithHub(schema.db, schema, 'ProposalActive');
    const active = await assignedWork(userId, 'Active work', 90);
    const next = await assignedWork(userId, 'Next work', 30);
    const [hub] = await schema.db.select().from(schema.hub).where(eq(schema.hub.userId, userId));
    const startedAt = new Date(at(8));
    const [record] = await schema.db
      .insert(schema.timeRecord)
      .values({
        hubId: required(hub).id,
        createdByUserId: userId,
        taskId: active.task.id,
        title: active.task.title,
        status: 'open',
        startedAt,
      })
      .returning();
    await schema.db.insert(schema.timeInterval).values({
      timeRecordId: required(record).id,
      hubId: required(hub).id,
      taskId: active.task.id,
      actorKind: 'human',
      userId,
      mode: 'human_active',
      source: 'user_timer',
      startedAt,
    });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(at(9)));
    try {
      const result = await proposal(userId);
      expect(result.draft.tasks.map((entry) => entry.taskId)).toEqual([next.task.id]);
      expect(result.draft.sessions[0]?.startsAt).toBe('2027-01-05T09:30:00.000Z');
      const selectedActive = await proposal(userId, {
        draft: {
          date,
          finishAt: at(17),
          mainTaskId: active.task.id,
          tasks: [
            {
              taskId: active.task.id,
              organizationId: active.orgId,
              plannedMinutes: 90,
              sort: 0,
              selectionSource: 'explicit',
            },
          ],
          sessions: [
            {
              id: 'future-active',
              startsAt: at(10),
              endsAt: '2027-01-05T11:30:00.000Z',
              pinned: false,
              placementSource: 'automatic',
              allocations: [{ taskId: active.task.id, plannedMinutes: 90 }],
            },
          ],
        },
      });
      expect(selectedActive.draft.tasks).toContainEqual(
        expect.objectContaining({ taskId: active.task.id, plannedMinutes: 90 }),
      );
      expect(
        selectedActive.draft.sessions
          .flatMap((session) => session.allocations)
          .map((allocation) => allocation.taskId),
      ).not.toContain(active.task.id);

      const app = appWithSession(router, fakeSession(userId));
      const tomorrow = '2027-01-06';
      const future = await app.request(`/day/${tomorrow}/proposal`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
      expect(future.status).toBe(200);
      expect(
        ((await future.json()) as ProposalBody).draft.sessions
          .flatMap((session: { allocations: { taskId: string }[] }) => session.allocations)
          .map((allocation: { taskId: string }) => allocation.taskId),
      ).toContain(active.task.id);
      expect(
        ((await (await app.request(`/day/${tomorrow}`)).json()) as { actual: unknown[] }).actual,
      ).toEqual([]);
      expect(
        (
          await schema.db
            .select()
            .from(schema.timeInterval)
            .where(eq(schema.timeInterval.timeRecordId, required(record).id))
        )[0]?.endedAt,
      ).toBeNull();
    } finally {
      clock.mockRestore();
    }
  });

  it('keeps native weekly blocks fixed and returns their display facts', async () => {
    const userId = await seedUserWithHub(schema.db, schema, 'ProposalNative');
    await assignedWork(userId, 'Work around weekly block', 120);
    const [layer] = await schema.db
      .insert(schema.calendarLayer)
      .values({ userId, sourceKind: 'native_blocks', title: 'Weekly schedule' })
      .returning();
    await schema.db.insert(schema.calendarItem).values({
      userId,
      layerId: required(layer).id,
      kind: 'native_block',
      title: 'Weekly writing',
      startsAt: new Date(at(9)),
      endsAt: new Date(at(10)),
      origin: 'scheduler',
    });
    const result = await proposal(userId);
    expect(result.fixedIntervals).toEqual([
      expect.objectContaining({ title: 'Weekly writing', kind: 'event' }),
    ]);
    expect(result.draft.sessions[0]?.startsAt).toBe(at(10));
  });
  it('preserves a legacy explicit timebox before any day snapshot exists', async () => {
    const userId = await seedUserWithHub(schema.db, schema, 'ProposalLegacyTimebox');
    const work = await assignedWork(userId, 'Legacy placement', 90);
    const [hub] = await schema.db.select().from(schema.hub).where(eq(schema.hub.userId, userId));
    await schema.db.insert(schema.dailyPlanItem).values({
      hubId: required(hub).id,
      date,
      refOrganizationId: work.orgId,
      refTaskId: work.task.id,
      timeboxStartsAt: new Date(at(10)),
      timeboxEndsAt: new Date(at(11)),
    });
    const result = await proposal(userId);
    expect(result.draft.sessions).toEqual([
      expect.objectContaining({ startsAt: at(10), endsAt: at(11), placementSource: 'manual' }),
    ]);
  });
});
