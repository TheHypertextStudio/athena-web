import { describe, expect, it } from 'vitest';
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

describe('daily proposal suggestions', () => {
  it('uses a later full-minute span when an earlier free sliver cannot hold work', () => {
    const result = proposeDailyPlan({
      ...input([candidate('fits', 30)]),
      windows: [
        { date, kind: 'desk', start: Date.parse(at(9)), end: Date.parse(at(9)) + 30_000 },
        { date, kind: 'desk', start: Date.parse(at(10)), end: Date.parse(at(10, 30)) },
      ],
    });
    expect(result.draft.tasks.map((task) => task.taskId)).toEqual(['fits']);
    expect(result.draft.sessions[0]).toMatchObject({ startsAt: at(10), endsAt: at(10, 30) });
    expect(result.unplaced).toEqual([]);
  });

  it('does not select a large assigned backlog when the real day has no free time', () => {
    const backlog = Array.from({ length: 230 }, (_, index) => candidate(`backlog-${index}`));
    const result = proposeDailyPlan({
      ...input(backlog),
      busy: [{ start: Date.parse(at(9)), end: Date.parse(at(17)) }],
    });
    expect(result.availableMinutes).toBe(0);
    expect(result.draft.tasks).toEqual([]);
    expect(result.draft.sessions).toEqual([]);
    expect(result.unplaced).toEqual([]);
  });

  it('keeps existing suggested and explicit commitments when new backlog work cannot fit', () => {
    const commitments = [candidate('already-selected', 60), candidate('chosen', 30)];
    const result = proposeDailyPlan({
      ...input([...commitments, ...Array.from({ length: 230 }, (_, i) => candidate(`new-${i}`))]),
      windows: [],
      draft: {
        ...draft,
        tasks: commitments.map((task, sort) => ({
          taskId: task.taskId,
          organizationId: task.organizationId,
          plannedMinutes: task.plannedMinutes,
          sort,
          selectionSource: sort === 0 ? 'suggested' : 'explicit',
        })),
      },
    });
    expect(result.draft.tasks.map((task) => task.taskId)).toEqual(['already-selected', 'chosen']);
    expect(result.unplaced).toEqual([
      { taskId: 'already-selected', remainingMinutes: 60, reason: 'no_availability' },
      { taskId: 'chosen', remainingMinutes: 30, reason: 'no_availability' },
    ]);
  });

  it('skips blocked and oversized suggestions so later shorter work can fit after the buffer', () => {
    const result = proposeDailyPlan({
      ...input([
        { ...candidate('blocked', 15), blockerIds: ['external'] },
        candidate('too-large', 60),
        candidate('fits', 30),
        candidate('last', 15),
        candidate('overflow', 15),
      ]),
      draft: { ...draft, finishAt: at(10), settings: { startAt: at(9), bufferPercent: 15 } },
    });
    expect(result.bufferMinutes).toBe(15);
    expect(result.draft.tasks.map((task) => task.taskId)).toEqual(['fits', 'last']);
    expect(result.draft.sessions.flatMap((session) => session.allocations)).toEqual([
      { taskId: 'fits', plannedMinutes: 30 },
      { taskId: 'last', plannedMinutes: 15 },
    ]);
    expect(result.unplaced).toEqual([]);
  });

  it('does not add a suggested dependent when its blocker cannot be fully scheduled', () => {
    const result = proposeDailyPlan({
      ...input([
        { ...candidate('dependent', 15), blockerIds: ['oversized-blocker'] },
        candidate('oversized-blocker', 90),
        candidate('independent', 30),
      ]),
      draft: { ...draft, finishAt: at(10) },
    });
    expect(result.draft.tasks.map((task) => task.taskId)).toEqual(['independent']);
    expect(result.unplaced).toEqual([]);
  });

  it('reserves room for existing commitments before considering earlier backlog suggestions', () => {
    const result = proposeDailyPlan({
      ...input([candidate('backlog', 45), candidate('selected', 30), candidate('short', 15)]),
      draft: {
        ...draft,
        finishAt: at(10),
        tasks: [{ taskId: 'selected', organizationId: 'org', plannedMinutes: 30, sort: 0 }],
      },
    });
    expect(result.draft.tasks.map((task) => task.taskId)).toEqual(['selected', 'short']);
    expect(result.unplaced).toEqual([]);
  });

  it('places a commitment and its eligible blockers ahead of unrelated backlog suggestions', () => {
    const result = proposeDailyPlan({
      ...input([
        candidate('unrelated', 45),
        { ...candidate('selected', 15), blockerIds: ['blocker'] },
        candidate('blocker', 30),
        candidate('short', 15),
      ]),
      draft: {
        ...draft,
        finishAt: at(10),
        tasks: [{ taskId: 'selected', organizationId: 'org', plannedMinutes: 15, sort: 0 }],
      },
    });
    expect(result.draft.tasks.map((task) => task.taskId)).toEqual(['blocker', 'selected', 'short']);
    expect(result.unplaced).toEqual([]);
  });

  it('fits the remaining recorded budget across separate free spans without selecting oversized work', () => {
    const result = proposeDailyPlan({
      ...input([
        candidate('too-large', 90),
        { ...candidate('remaining', 90), recordedMinutes: 20 },
        candidate('short', 5),
      ]),
      windows: [
        { date, kind: 'desk', start: Date.parse(at(9)), end: Date.parse(at(9, 30)) },
        { date, kind: 'desk', start: Date.parse(at(10)), end: Date.parse(at(10, 45)) },
      ],
    });
    expect(result.draft.tasks.map((task) => task.taskId)).toEqual(['remaining', 'short']);
    expect(result.draft.sessions.flatMap((session) => session.allocations)).toEqual([
      { taskId: 'remaining', plannedMinutes: 30 },
      { taskId: 'remaining', plannedMinutes: 40 },
      { taskId: 'short', plannedMinutes: 5 },
    ]);
    expect(result.unplaced).toEqual([]);
  });
});
