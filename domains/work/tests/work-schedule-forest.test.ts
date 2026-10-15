import { describe, expect, it } from 'vitest';
import { WorkScheduleForest } from '../src/contracts/work-schedule-forest';

const id = '01M4Y1B4B5V04E5ANJQ5QHTEZ8';
function draft() {
  return {
    kind: 'schedule',
    revision: 1,
    template: { targetType: 'task', workTypeId: id, selection: { kind: 'latest' } },
    titlePattern: '{month} Preparation',
    timezone: 'America/Los_Angeles',
    root: { kind: 'task', fields: {}, placement: {}, dates: {} },
    stepOverrides: [],
    optionalChoices: [],
  };
}
const venue = { rootKey: 'venue', path: [] };
const catering = { rootKey: 'catering', path: [] };
function forest() {
  return {
    kind: 'forest',
    revision: 1,
    state: 'published',
    roots: [
      { key: 'venue', draft: draft() },
      { key: 'catering', draft: draft() },
    ],
    dependencies: [{ blocker: venue, blocked: catering }],
    timing: [{ target: catering, prerequisite: venue, offsetDays: 2 }],
  };
}

describe('private canonical schedule forest', () => {
  it('uses one saved series timezone for every root and rejects mixed completion calendars', () => {
    expect(WorkScheduleForest.safeParse(forest()).success).toBe(true);
    const mixed = forest();
    const second = mixed.roots[1];
    if (!second) throw new Error('Missing second root');
    second.draft.timezone = 'Asia/Tokyo';
    expect(WorkScheduleForest.safeParse(mixed).success).toBe(false);
  });
  it('retains independently selected roots and root-qualified private rules without wrapper work', () => {
    const saved = WorkScheduleForest.parse(forest());
    expect(saved.roots.map((root) => root.key)).toEqual(['venue', 'catering']);
    expect(saved.dependencies).toEqual([{ blocker: venue, blocked: catering }]);
    expect(saved.timing).toEqual([{ target: catering, prerequisite: venue, offsetDays: 2 }]);
  });
  it('retains pending latest drafts without inventing an executable publication', () => {
    const pending = WorkScheduleForest.parse({ ...forest(), state: 'pending_draft' });
    expect(pending.state).toBe('pending_draft');
    expect(pending.roots[0]?.draft.template.selection).toEqual({ kind: 'latest' });
  });
  it('refuses duplicate roots and references to an absent root', () => {
    expect(
      WorkScheduleForest.safeParse({
        ...forest(),
        roots: [forest().roots[0], forest().roots[0]],
      }).success,
    ).toBe(false);
    expect(
      WorkScheduleForest.safeParse({
        ...forest(),
        timing: [
          { target: catering, prerequisite: { rootKey: 'missing', path: [] }, offsetDays: 0 },
        ],
      }).success,
    ).toBe(false);
  });
  it('refuses self edges, repeated edges and a cycle spanning timing and dependencies', () => {
    for (const dependencies of [
      [{ blocker: venue, blocked: venue }],
      [forest().dependencies[0], forest().dependencies[0]],
    ])
      expect(WorkScheduleForest.safeParse({ ...forest(), dependencies }).success).toBe(false);
    expect(
      WorkScheduleForest.safeParse({
        ...forest(),
        timing: [{ target: venue, prerequisite: catering, offsetDays: -1 }],
      }).success,
    ).toBe(false);
  });
  it('keeps equal child paths in separate roots distinct and refuses malformed private rules', () => {
    expect(
      WorkScheduleForest.safeParse({
        ...forest(),
        dependencies: [
          {
            blocker: { ...venue, path: ['book'] },
            blocked: { ...catering, path: ['book'] },
          },
        ],
        timing: [],
      }).success,
    ).toBe(true);
    expect(WorkScheduleForest.safeParse({ ...forest(), ownerProgramId: id }).success).toBe(false);
    expect(
      WorkScheduleForest.safeParse({
        ...forest(),
        timing: [{ target: catering, prerequisite: venue, offsetDays: 0.5 }],
      }).success,
    ).toBe(false);
  });
});
