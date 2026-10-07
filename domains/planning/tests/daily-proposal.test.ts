import { describe, expect, it } from 'vitest';
import { DailyPlanSnapshot } from '../src/daily-plan-flow';
import { proposeDailyPlan, type ProposalCandidate } from '../src/daily-proposal';

const date = '2026-10-06';
const at = (hour: number, minute = 0): string =>
  new Date(Date.UTC(2026, 9, 6, hour, minute)).toISOString();
const draft = {
  date,
  finishAt: at(17),
  mainTaskId: null,
  tasks: [],
  sessions: [],
  settings: { startAt: at(9), bufferPercent: 0 },
};
const candidate = (taskId: string, minutes = 45): ProposalCandidate => ({
  taskId,
  organizationId: 'org',
  projectId: 'project',
  title: taskId,
  plannedMinutes: minutes,
  durationSource: 'estimate',
  selectionSource: 'suggested',
  blockerIds: [],
});
const input = (candidates: ProposalCandidate[]) => ({
  draft,
  candidates,
  now: Date.parse(at(9)),
  windows: [{ date, kind: 'desk' as const, start: Date.parse(at(9)), end: Date.parse(at(17)) }],
  busy: [],
});

describe('daily proposal', () => {
  it('keeps provenance fields while retaining legacy snapshots', () => {
    const value = {
      ...draft,
      tasks: [
        {
          taskId: 'a',
          organizationId: 'org',
          plannedMinutes: 30,
          sort: 0,
          selectionSource: 'suggested',
          durationSource: 'history',
        },
      ],
    };
    expect(DailyPlanSnapshot.parse(value)).toEqual(value);
    expect(
      DailyPlanSnapshot.parse({
        date,
        finishAt: at(17),
        mainTaskId: null,
        tasks: [],
        sessions: [],
      }),
    ).toMatchObject({ date });
  });
  it('retains selected active intent without creating future automatic work', () => {
    const result = proposeDailyPlan({
      ...input([{ ...candidate('a', 90), active: true }]),
      draft: {
        ...draft,
        mainTaskId: 'a',
        tasks: [
          {
            taskId: 'a',
            organizationId: 'org',
            plannedMinutes: 90,
            sort: 0,
            selectionSource: 'explicit',
          },
        ],
        sessions: [
          {
            id: 'future',
            startsAt: at(10),
            endsAt: at(11, 30),
            pinned: false,
            placementSource: 'automatic',
            allocations: [{ taskId: 'a', plannedMinutes: 90 }],
          },
        ],
      },
    });
    expect(result.draft.tasks).toMatchObject([{ taskId: 'a', plannedMinutes: 90 }]);
    expect(result.draft.mainTaskId).toBe('a');
    expect(result.draft.sessions).toEqual([]);
    expect(result.unplaced).toEqual([]);
  });
  it('groups related short work and splits long work around events', () => {
    const result = proposeDailyPlan({
      ...input([candidate('a', 15), candidate('b', 20), candidate('long', 150)]),
      busy: [{ start: Date.parse(at(10)), end: Date.parse(at(11)) }],
    });
    expect(result.draft.sessions[0]?.allocations).toHaveLength(2);
    expect(
      result.draft.sessions.filter((session) =>
        session.allocations.some((a) => a.taskId === 'long'),
      ).length,
    ).toBeGreaterThan(1);
    expect(
      result.draft.sessions.every(
        (session) =>
          Date.parse(session.endsAt) <= Date.parse(at(10)) ||
          Date.parse(session.startsAt) >= Date.parse(at(11)),
      ),
    ).toBe(true);
    expect(result.unplaced).toEqual([]);
  });
  it('starts in the future and reserves a configurable buffer', () => {
    const result = proposeDailyPlan({
      ...input([candidate('long', 600)]),
      now: Date.parse(at(10, 40)),
      draft: { ...draft, settings: { startAt: at(9) } },
    });
    expect(result.draft.sessions[0]?.startsAt).toBe(at(10, 40));
    expect(result.bufferMinutes).toBe(60);
    expect(result.unplaced).toEqual([
      { taskId: 'long', remainingMinutes: 280, reason: 'insufficient_time' },
    ]);
  });
  it('preserves manual, pinned, and past sessions verbatim', () => {
    const sessions = [
      {
        id: 'manual',
        startsAt: at(11),
        endsAt: at(11, 30),
        allocations: [{ taskId: 'a', plannedMinutes: 30 }],
        pinned: false,
      },
      {
        id: 'pinned',
        startsAt: at(13),
        endsAt: at(13, 30),
        allocations: [{ taskId: 'a', plannedMinutes: 30 }],
        pinned: true,
        placementSource: 'automatic' as const,
      },
      {
        id: 'past',
        startsAt: at(8),
        endsAt: at(8, 30),
        allocations: [{ taskId: 'a', plannedMinutes: 30 }],
        pinned: false,
        placementSource: 'automatic' as const,
      },
    ];
    const result = proposeDailyPlan({
      ...input([candidate('a', 120)]),
      draft: {
        ...draft,
        tasks: [{ taskId: 'a', organizationId: 'org', plannedMinutes: 120, sort: 0 }],
        sessions,
      },
    });
    expect(result.draft.sessions).toEqual(expect.arrayContaining(sessions));
    expect(result.draft.tasks[0]?.plannedMinutes).toBe(120);
  });
  it('never schedules a dependent whose unfinished blocker is absent or unplaced', () => {
    const result = proposeDailyPlan(
      input([
        { ...candidate('a'), blockerIds: ['external'] },
        { ...candidate('b'), blockerIds: ['a'] },
      ]),
    );
    expect(result.draft.sessions).toEqual([]);
    expect(result.unplaced.map((entry) => entry.reason)).toEqual(['blocked', 'blocked']);
  });
  it('schedules the blocker completely before its dependent', () => {
    const result = proposeDailyPlan(
      input([{ ...candidate('dependent', 15), blockerIds: ['blocker'] }, candidate('blocker', 90)]),
    );
    const blocking = result.draft.sessions.filter((session) =>
      session.allocations.some((a) => a.taskId === 'blocker'),
    );
    const dependent = result.draft.sessions.find((session) =>
      session.allocations.some((a) => a.taskId === 'dependent'),
    );
    expect(Date.parse(dependent?.startsAt ?? '')).toBeGreaterThanOrEqual(
      Date.parse(blocking.at(-1)?.endsAt ?? ''),
    );
  });
  it('reports no availability without creating overlapping time', () => {
    const result = proposeDailyPlan({ ...input([candidate('a')]), windows: [] });
    expect(result.draft.sessions).toEqual([]);
    expect(result.unplaced[0]?.reason).toBe('no_availability');
  });
  it('produces the same blocks from the same inputs', () => {
    const value = input([candidate('a'), candidate('b')]);
    expect(proposeDailyPlan(value)).toEqual(proposeDailyPlan(value));
  });
  it('counts actual work beyond the preserved block toward an existing daily commitment', () => {
    const work = { ...candidate('a', 90), recordedMinutes: 60 };
    const result = proposeDailyPlan({
      ...input([work]),
      now: Date.parse(at(10)),
      draft: {
        ...draft,
        tasks: [{ taskId: 'a', organizationId: 'org', plannedMinutes: 90, sort: 0 }],
        sessions: [
          {
            id: 'past',
            startsAt: at(9),
            endsAt: at(9, 30),
            allocations: [{ taskId: 'a', plannedMinutes: 30 }],
            pinned: false,
            placementSource: 'automatic',
          },
        ],
      },
    });
    const future = result.draft.sessions.filter(
      (session) => Date.parse(session.startsAt) >= Date.parse(at(10)),
    );
    expect(
      future
        .flatMap((session) => session.allocations)
        .reduce((sum, allocation) => sum + allocation.plannedMinutes, 0),
    ).toBe(30);
    expect(result.draft.tasks[0]?.plannedMinutes).toBe(90);
  });
  it('counts a future manual continuation separately from recorded past work', () => {
    const result = proposeDailyPlan({
      ...input([{ ...candidate('a', 30), recordedMinutes: 10 }]),
      draft: {
        ...draft,
        tasks: [{ taskId: 'a', organizationId: 'org', plannedMinutes: 30, sort: 0 }],
        sessions: [
          {
            id: 'continuation',
            startsAt: at(9),
            endsAt: at(9, 20),
            allocations: [{ taskId: 'a', plannedMinutes: 20 }],
            pinned: true,
            placementSource: 'manual',
          },
        ],
      },
    });
    expect(result.draft.sessions).toHaveLength(1);
    expect(result.draft.sessions[0]?.id).toBe('continuation');
  });

  it('keeps a timerless continuation committed after its start', () => {
    const continuation = {
      id: 'continuation',
      startsAt: at(9),
      endsAt: at(9, 20),
      allocations: [{ taskId: 'a', plannedMinutes: 20 }],
      pinned: false,
      placementSource: 'manual' as const,
    };
    const result = proposeDailyPlan({
      ...input([{ ...candidate('a', 30), recordedMinutes: 10 }]),
      now: Date.parse(at(9, 1)),
      draft: { ...draft, sessions: [continuation] },
    });
    expect(result.draft.sessions).toEqual([continuation]);
    expect(result.unplaced).toEqual([]);
  });

  it('uses each packed allocation time when counting actual and future commitments', () => {
    const packed = {
      id: 'packed',
      startsAt: at(15),
      endsAt: at(16),
      allocations: [
        { taskId: 'b', plannedMinutes: 30 },
        { taskId: 'a', plannedMinutes: 30 },
      ],
      pinned: false,
      placementSource: 'manual' as const,
    };
    const result = proposeDailyPlan({
      ...input([{ ...candidate('a', 90), recordedMinutes: 60 }]),
      now: Date.parse(at(15, 15)),
      draft: {
        ...draft,
        tasks: [{ taskId: 'b', organizationId: 'org', plannedMinutes: 30, sort: 0 }],
        sessions: [packed],
      },
    });
    expect(result.draft.sessions).toEqual([packed]);
    expect(result.unplaced).toEqual([]);
  });

  it.each([
    { recordedStart: at(9), recordedEnd: at(9, 10), recorded: 10, repeat: false, future: 30 },
    { recordedStart: at(8), recordedEnd: at(8, 10), recorded: 10, repeat: false, future: 20 },
    {
      recordedStart: at(9),
      recordedEnd: '2026-10-06T09:00:30.000Z',
      recorded: 1,
      repeat: false,
      future: 30,
    },
    { recordedStart: at(9), recordedEnd: at(9, 10), recorded: 10, repeat: true, future: 30 },
  ])('counts actual overlap with current reserved work once: %j', (scenario) => {
    const result = proposeDailyPlan({
      ...input([
        {
          ...candidate('a', 60),
          recordedMinutes: scenario.recorded,
          recordedIntervals: Array.from({ length: scenario.repeat ? 2 : 1 }, () => ({
            start: Date.parse(scenario.recordedStart),
            end: Date.parse(scenario.recordedEnd),
          })),
        },
      ]),
      now: Date.parse(at(9, 15)),
      draft: {
        ...draft,
        sessions: [
          {
            id: 'current',
            startsAt: at(9),
            endsAt: at(9, 30),
            pinned: false,
            allocations: [{ taskId: 'a', plannedMinutes: 30 }],
          },
        ],
      },
    });
    const automatic = result.draft.sessions.filter(
      (session) => session.placementSource === 'automatic',
    );
    expect(
      automatic
        .flatMap((session) => session.allocations)
        .reduce((sum, part) => sum + part.plannedMinutes, 0),
    ).toBe(scenario.future);
  });

  it.each([
    { past: 0, recorded: 10, actualEnd: at(9, 15), future: 30 },
    { past: 30, recorded: 10, actualEnd: at(9, 10), future: 0 },
  ])('does not invent capacity from cached or overlapping actuals: %j', (scenario) => {
    const current = {
      id: 'current',
      startsAt: at(9),
      endsAt: at(9, 30),
      pinned: false,
      allocations: [{ taskId: 'a', plannedMinutes: 30 }],
    };
    const past = { ...current, id: 'past', startsAt: at(8), endsAt: at(8, 30) };
    const result = proposeDailyPlan({
      ...input([
        {
          ...candidate('a', 60),
          recordedMinutes: scenario.recorded,
          recordedIntervals: [{ start: Date.parse(at(9)), end: Date.parse(scenario.actualEnd) }],
        },
      ]),
      now: Date.parse(at(9, 15)),
      draft: { ...draft, sessions: scenario.past ? [past, current] : [current] },
    });
    expect(
      result.draft.sessions
        .filter((session) => session.placementSource === 'automatic')
        .flatMap((session) => session.allocations)
        .reduce((sum, part) => sum + part.plannedMinutes, 0),
    ).toBe(scenario.future);
  });

  it.each([
    { projectId: null, organizationId: 'org', blockerIds: [] },
    { projectId: 'other-project', organizationId: 'org', blockerIds: [] },
    { projectId: 'project', organizationId: 'other-org', blockerIds: [] },
    { projectId: 'project', organizationId: 'org', blockerIds: ['a'] },
  ])('keeps unrelated or dependent short work in separate blocks: %j', (context) => {
    const result = proposeDailyPlan(
      input([candidate('a', 15), { ...candidate('b', 15), ...context }]),
    );
    expect(result.draft.sessions).toHaveLength(2);
    expect(result.draft.sessions.map((session) => session.allocations[0]?.taskId)).toEqual([
      'a',
      'b',
    ]);
  });

  it('reports cyclic work as blocked without placing either task', () => {
    const result = proposeDailyPlan(
      input([
        { ...candidate('a'), blockerIds: ['b'] },
        { ...candidate('b'), blockerIds: ['a'] },
      ]),
    );
    expect(result.draft.sessions).toEqual([]);
    expect(result.unplaced.map((entry) => entry.reason)).toEqual(['blocked', 'blocked']);
  });

  it('retains a completed task in a manual block while removing obsolete future intent', () => {
    const manual = {
      id: 'completed-manual',
      startsAt: at(10),
      endsAt: at(10, 15),
      pinned: false,
      allocations: [{ taskId: 'completed', plannedMinutes: 15 }],
    };
    const result = proposeDailyPlan({
      ...input([]),
      draft: {
        ...draft,
        mainTaskId: 'completed',
        tasks: [
          { taskId: 'completed', organizationId: 'org', plannedMinutes: 15, sort: 0 },
          { taskId: 'obsolete', organizationId: 'org', plannedMinutes: 15, sort: 1 },
        ],
        sessions: [manual],
      },
    });
    expect(result.draft.tasks.map((task) => task.taskId)).toEqual(['completed']);
    expect(result.draft.mainTaskId).toBe('completed');
    expect(result.draft.sessions).toEqual([manual]);
    expect(result.changes).toEqual([]);
  });

  it('describes changed and removed automatic blocks using their concrete times', () => {
    const before = proposeDailyPlan(input([candidate('a', 15), candidate('b', 45)])).draft;
    const result = proposeDailyPlan({ ...input([candidate('a', 30)]), draft: before });
    expect(result.changes).toEqual([
      expect.objectContaining({ type: 'moved', previousStartsAt: at(9), startsAt: at(9) }),
      expect.objectContaining({ type: 'removed', previousStartsAt: at(9, 15), startsAt: null }),
    ]);
  });

  it('does not place a dependent before a manual blocker at the workday finish', () => {
    const result = proposeDailyPlan({
      ...input([candidate('a', 15), { ...candidate('b', 15), blockerIds: ['a'] }]),
      draft: {
        ...draft,
        sessions: [
          {
            id: 'late-blocker',
            startsAt: at(16, 45),
            endsAt: at(17),
            pinned: false,
            allocations: [{ taskId: 'a', plannedMinutes: 15 }],
          },
        ],
      },
    });
    expect(result.draft.sessions).toHaveLength(1);
    expect(result.unplaced).toEqual([
      { taskId: 'b', remainingMinutes: 15, reason: 'insufficient_time' },
    ]);
  });
});
