import { describe, expect, it } from 'vitest';

import {
  derivePlanState,
  selectFocus,
  selectMomentum,
  selectStatusCards,
  remainingAvailableMinutes,
  type TodayPlanCandidate,
  type TodayStatusCandidate,
  type TodaySuggestionCandidate,
} from '../../src/services/hub/today-projection';

const DATE = '2026-08-13';
const NOW = new Date('2026-08-13T17:00:00.000Z');

function planCandidate(
  id: string,
  overrides: Partial<TodayPlanCandidate> = {},
): TodayPlanCandidate {
  return {
    id,
    organizationId: 'org-one',
    title: `Task ${id}`,
    state: 'todo',
    stateType: 'unstarted',
    priority: 'medium',
    assigneeId: 'actor-one',
    projectId: null,
    dueDate: null,
    planItemId: `plan-${id}`,
    planStatus: 'planned',
    sort: 0,
    position: 0,
    estimateMinutes: 30,
    timeboxStartsAt: null,
    timeboxEndsAt: null,
    blocked: false,
    dependencyImpact: 0,
    reason: 'You chose this first',
    ...overrides,
  };
}

describe('derivePlanState', () => {
  it('keeps a day unplanned when no scheduling receipt or personal plan exists', () => {
    expect(derivePlanState({ readiness: 'not_generated', items: [] })).toBe('unplanned');
  });

  it('treats a generated empty week as a cleared day', () => {
    expect(derivePlanState({ readiness: 'empty_week', items: [] })).toBe('cleared');
  });

  it('treats an accepted plan with incomplete work as active', () => {
    expect(derivePlanState({ readiness: 'ready', items: [planCandidate('active')] })).toBe(
      'active',
    );
  });

  it('treats an accepted plan with only completed rows as cleared', () => {
    expect(
      derivePlanState({
        readiness: 'ready',
        items: [planCandidate('done', { planStatus: 'done' })],
      }),
    ).toBe('cleared');
  });
});

describe('selectFocus', () => {
  it('prefers an active timer, then the current timebox, then accepted plan order', () => {
    const first = planCandidate('first', { position: 0 });
    const currentTimebox = planCandidate('timeboxed', {
      position: 1,
      timeboxStartsAt: '2026-08-13T16:30:00.000Z',
      timeboxEndsAt: '2026-08-13T17:30:00.000Z',
    });
    const activeTimer = planCandidate('timer', { position: 2 });
    const following = planCandidate('following', { position: 3 });

    expect(
      selectFocus({
        items: [first, currentTimebox, activeTimer, following],
        now: NOW,
        activeTaskId: activeTimer.id,
      }),
    ).toEqual({ now: activeTimer, after: first });
  });

  it('skips completed and blocked work in both focus positions', () => {
    const blocked = planCandidate('blocked', { position: 0, blocked: true });
    const done = planCandidate('done', { position: 1, planStatus: 'done' });
    const now = planCandidate('now', { position: 2 });
    const after = planCandidate('after', { position: 3 });

    expect(selectFocus({ items: [blocked, done, now, after], now: NOW })).toEqual({ now, after });
  });
});

describe('selectStatusCards', () => {
  it('prioritizes focus-linked work, removes repeated stories, and caps the result at four', () => {
    const candidates: TodayStatusCandidate[] = [
      {
        id: 'project-focus',
        kind: 'project',
        organizationId: 'workspace-a',
        storyKey: 'initiative-one',
        linkedToFocus: true,
        linkedToToday: true,
        risk: 0,
        stale: false,
        targetSoon: false,
        updatedAt: null,
      },
      {
        id: 'initiative-duplicate',
        kind: 'initiative',
        organizationId: 'workspace-a',
        storyKey: 'initiative-one',
        linkedToFocus: false,
        linkedToToday: true,
        risk: 2,
        stale: true,
        targetSoon: true,
        updatedAt: '2026-08-13T16:00:00.000Z',
      },
      ...['risk', 'stale', 'target', 'recent'].map<TodayStatusCandidate>((id, index) => ({
        id,
        kind: index % 2 === 0 ? 'project' : 'initiative',
        organizationId: index < 3 ? 'workspace-a' : 'workspace-b',
        storyKey: id,
        linkedToFocus: false,
        linkedToToday: index === 0,
        risk: index === 0 ? 2 : 0,
        stale: index === 1,
        targetSoon: index === 2,
        updatedAt: index === 3 ? '2026-08-13T15:00:00.000Z' : null,
      })),
    ];

    const selected = selectStatusCards(candidates);

    expect(selected.map((candidate) => candidate.id)).toEqual([
      'project-focus',
      'risk',
      'stale',
      'target',
    ]);
    expect(selected).toHaveLength(4);
  });

  it('uses an equally relevant story from another workspace before repeating one workspace', () => {
    const candidates = ['a-1', 'a-2', 'b-1'].map<TodayStatusCandidate>((id) => ({
      id,
      kind: 'project',
      organizationId: id.startsWith('a') ? 'workspace-a' : 'workspace-b',
      storyKey: id,
      linkedToFocus: false,
      linkedToToday: true,
      risk: 0,
      stale: false,
      targetSoon: false,
      updatedAt: null,
    }));

    expect(selectStatusCards(candidates).map((candidate) => candidate.id)).toEqual([
      'a-1',
      'b-1',
      'a-2',
    ]);
  });
});

describe('selectMomentum', () => {
  it('returns only visible, actionable, unplanned work that fits the remaining day', () => {
    const candidates: TodaySuggestionCandidate[] = [
      {
        id: 'fits-and-unblocks',
        visible: true,
        alreadyPlanned: false,
        blocked: false,
        terminal: false,
        estimateMinutes: 30,
        dependencyImpact: 3,
        priority: 'high',
        dueDate: null,
        startDate: DATE,
        updatedAt: '2026-08-13T15:00:00.000Z',
      },
      {
        id: 'fits-and-due',
        visible: true,
        alreadyPlanned: false,
        blocked: false,
        terminal: false,
        estimateMinutes: 45,
        dependencyImpact: 0,
        priority: 'urgent',
        dueDate: DATE,
        startDate: null,
        updatedAt: null,
      },
      {
        id: 'too-large',
        visible: true,
        alreadyPlanned: false,
        blocked: false,
        terminal: false,
        estimateMinutes: 180,
        dependencyImpact: 9,
        priority: 'urgent',
        dueDate: DATE,
        startDate: DATE,
        updatedAt: null,
      },
      {
        id: 'invisible',
        visible: false,
        alreadyPlanned: false,
        blocked: false,
        terminal: false,
        estimateMinutes: 15,
        dependencyImpact: 10,
        priority: 'urgent',
        dueDate: DATE,
        startDate: DATE,
        updatedAt: null,
      },
      {
        id: 'already-planned',
        visible: true,
        alreadyPlanned: true,
        blocked: false,
        terminal: false,
        estimateMinutes: 15,
        dependencyImpact: 10,
        priority: 'urgent',
        dueDate: DATE,
        startDate: DATE,
        updatedAt: null,
      },
      {
        id: 'blocked',
        visible: true,
        alreadyPlanned: false,
        blocked: true,
        terminal: false,
        estimateMinutes: 15,
        dependencyImpact: 10,
        priority: 'urgent',
        dueDate: DATE,
        startDate: DATE,
        updatedAt: null,
      },
    ];

    expect(
      selectMomentum({ candidates, date: DATE, remainingMinutes: 90, largestSpanMinutes: 90 }).map(
        (candidate) => candidate.id,
      ),
    ).toEqual(['fits-and-unblocks', 'fits-and-due']);
  });

  it('uses the id as a stable final tie-breaker and returns at most three suggestions', () => {
    const candidates = ['d', 'b', 'a', 'c'].map<TodaySuggestionCandidate>((id) => ({
      id,
      visible: true,
      alreadyPlanned: false,
      blocked: false,
      terminal: false,
      estimateMinutes: 15,
      dependencyImpact: 0,
      priority: 'medium',
      dueDate: null,
      startDate: null,
      updatedAt: null,
    }));

    expect(
      selectMomentum({
        candidates,
        date: DATE,
        remainingMinutes: 120,
        largestSpanMinutes: 120,
      }).map((candidate) => candidate.id),
    ).toEqual(['a', 'b', 'c']);
  });

  it('requires one contiguous free span and does not offer work before its start date', () => {
    const candidates: TodaySuggestionCandidate[] = [
      {
        id: 'too-long-for-either-gap',
        visible: true,
        alreadyPlanned: false,
        blocked: false,
        terminal: false,
        estimateMinutes: 45,
        dependencyImpact: 0,
        priority: 'high',
        dueDate: null,
        startDate: DATE,
        updatedAt: null,
      },
      {
        id: 'starts-tomorrow',
        visible: true,
        alreadyPlanned: false,
        blocked: false,
        terminal: false,
        estimateMinutes: 20,
        dependencyImpact: 0,
        priority: 'urgent',
        dueDate: null,
        startDate: '2026-08-14',
        updatedAt: null,
      },
      {
        id: 'honest-fit',
        visible: true,
        alreadyPlanned: false,
        blocked: false,
        terminal: false,
        estimateMinutes: 30,
        dependencyImpact: 0,
        priority: 'medium',
        dueDate: null,
        startDate: null,
        updatedAt: null,
      },
    ];

    expect(
      selectMomentum({
        candidates,
        date: DATE,
        remainingMinutes: 60,
        largestSpanMinutes: 30,
      }).map((candidate) => candidate.id),
    ).toEqual(['honest-fit']);
  });
});

describe('remainingAvailableMinutes', () => {
  it('does not count free time that has already passed today', () => {
    const hour = 60 * 60 * 1_000;
    expect(
      remainingAvailableMinutes({
        start: 0,
        end: 8 * hour,
        now: 5 * hour,
        blocks: [{ start: 6 * hour, end: 7 * hour }],
      }),
    ).toBe(120);
  });

  it('returns the full future window and zero after the day ends', () => {
    const hour = 60 * 60 * 1_000;
    const input = { start: 4 * hour, end: 8 * hour, blocks: [] } as const;
    expect(remainingAvailableMinutes({ ...input, now: 0 })).toBe(240);
    expect(remainingAvailableMinutes({ ...input, now: 9 * hour })).toBe(0);
  });
});
