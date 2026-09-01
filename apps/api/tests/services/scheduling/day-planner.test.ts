import type { AvailabilityWindow } from '@docket/planning/scheduling-contract';
import { describe, expect, it } from 'vitest';

import { defaultAvailabilityWindows } from '../../../src/services/scheduling/availability';
import type {
  DayCandidate,
  DependencyEdge,
  PlanDayInput,
  PlannedTask,
} from '../../../src/services/scheduling/day-planner';
import {
  DEFAULT_TASK_MINUTES,
  MAX_TASK_MINUTES,
  MIN_TASK_MINUTES,
  planDay,
  topologicalOrder,
} from '../../../src/services/scheduling/day-planner';
import type { Interval } from '@docket/planning/intervals';
import { instantAt } from '@docket/planning/zoned-time';
import { assertDefined } from '@docket/test-utils';

const TZ = 'America/Los_Angeles';
/** A Wednesday, so the default weekday windows apply. */
const DATE = '2026-08-05';

function candidate(over: Partial<DayCandidate> & { taskId: string }): DayCandidate {
  return {
    title: `Task ${over.taskId}`,
    priority: 'none',
    estimateMinutes: null,
    startDate: null,
    dueDate: null,
    organizationId: 'ORG',
    ...over,
  };
}

function baseInput(over: Partial<PlanDayInput> = {}): PlanDayInput {
  return {
    date: DATE,
    timezone: TZ,
    windows: defaultAvailabilityWindows(),
    busy: [],
    candidates: [],
    edges: [],
    ...over,
  };
}

/** Where a task landed in the returned order, by id. */
function indexOf(items: readonly PlannedTask[], taskId: string): number {
  return items.findIndex((i) => i.taskId === taskId);
}

function at(minute: number): number {
  return instantAt(DATE, minute, TZ).getTime();
}

describe('planDay — dependency order is never violated', () => {
  it('places a blocker before the task it blocks', () => {
    const result = planDay(
      baseInput({
        candidates: [candidate({ taskId: 'B' }), candidate({ taskId: 'A' })],
        edges: [{ blockingTaskId: 'A', blockedTaskId: 'B' }],
      }),
    );
    expect(indexOf(result.items, 'A')).toBeLessThan(indexOf(result.items, 'B'));
  });

  it('keeps a blocker first even when the task it blocks is urgent and it is not', () => {
    // The interesting case: priority must reorder only *within* what dependencies permit.
    // If priority could jump a blocker, the plan would tell you to do work you cannot start.
    const result = planDay(
      baseInput({
        candidates: [
          candidate({ taskId: 'BLOCKED', priority: 'urgent' }),
          candidate({ taskId: 'BLOCKER', priority: 'none' }),
        ],
        edges: [{ blockingTaskId: 'BLOCKER', blockedTaskId: 'BLOCKED' }],
      }),
    );
    expect(result.items.map((i) => i.taskId)).toEqual(['BLOCKER', 'BLOCKED']);
  });

  it('respects a transitive chain end to end', () => {
    const result = planDay(
      baseInput({
        candidates: ['C', 'A', 'D', 'B'].map((taskId) => candidate({ taskId })),
        edges: [
          { blockingTaskId: 'A', blockedTaskId: 'B' },
          { blockingTaskId: 'B', blockedTaskId: 'C' },
          { blockingTaskId: 'C', blockedTaskId: 'D' },
        ],
      }),
    );
    expect(result.items.map((i) => i.taskId)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('gives the blocker an earlier timebox, not just an earlier line', () => {
    // Array position alone is not the guarantee anyone cares about. A plan that lists the
    // blocker first but times it after the task it blocks is still telling you to do work
    // you cannot start, so placement walks strictly forward in time.
    const result = planDay(
      baseInput({
        candidates: [
          candidate({ taskId: 'BLOCKED', priority: 'urgent', estimateMinutes: 30 }),
          candidate({ taskId: 'BLOCKER', priority: 'none', estimateMinutes: 120 }),
        ],
        edges: [{ blockingTaskId: 'BLOCKER', blockedTaskId: 'BLOCKED' }],
      }),
    );
    const blocker = result.items.find((i) => i.taskId === 'BLOCKER');
    const blocked = result.items.find((i) => i.taskId === 'BLOCKED');
    expect(blocker?.end).not.toBeNull();
    expect(assertDefined(assertDefined(blocked).start)).toBeGreaterThanOrEqual(
      assertDefined(assertDefined(blocker).end),
    );
  });

  it('ignores an edge whose blocker is not a candidate for the day', () => {
    // A blocker on another day must not strand today's work: the edge is out of scope, not
    // an ordering constraint we can honour.
    const result = planDay(
      baseInput({
        candidates: [candidate({ taskId: 'B' })],
        edges: [{ blockingTaskId: 'NOT_TODAY', blockedTaskId: 'B' }],
      }),
    );
    expect(result.items.map((i) => i.taskId)).toEqual(['B']);
  });

  it('orders by priority, then due date, then id when dependencies permit', () => {
    const result = planDay(
      baseInput({
        candidates: [
          candidate({ taskId: 'LOW', priority: 'low' }),
          candidate({ taskId: 'URGENT', priority: 'urgent' }),
          candidate({ taskId: 'HIGH_LATE', priority: 'high', dueDate: at(20 * 60) }),
          candidate({ taskId: 'HIGH_EARLY', priority: 'high', dueDate: at(10 * 60) }),
        ],
      }),
    );
    expect(result.items.map((i) => i.taskId)).toEqual(['URGENT', 'HIGH_EARLY', 'HIGH_LATE', 'LOW']);
  });

  it('stays total on a cycle rather than spinning or dropping work', () => {
    // The database forbids dependency cycles, so this is defensive only — but a planner that
    // hangs on corrupt data is worse than one that makes an arbitrary, documented choice.
    const result = planDay(
      baseInput({
        candidates: [candidate({ taskId: 'X' }), candidate({ taskId: 'Y' })],
        edges: [
          { blockingTaskId: 'X', blockedTaskId: 'Y' },
          { blockingTaskId: 'Y', blockedTaskId: 'X' },
        ],
      }),
    );
    expect(result.items.map((i) => i.taskId).sort()).toEqual(['X', 'Y']);
  });
});

describe('planDay — estimates are consumed, not guessed', () => {
  it('gives a task with an estimate a timebox of exactly that length', () => {
    const result = planDay(
      baseInput({ candidates: [candidate({ taskId: 'A', estimateMinutes: 90 })] }),
    );
    const item = result.items[0];
    expect(item?.minutes).toBe(90);
    expect(item?.durationSource).toBe('requested');
    expect(
      (assertDefined(assertDefined(item).end) - assertDefined(assertDefined(item).start)) / 60_000,
    ).toBe(90);
  });

  it('falls back to the documented default when the task carries no estimate', () => {
    const result = planDay(baseInput({ candidates: [candidate({ taskId: 'A' })] }));
    expect(result.items[0]?.minutes).toBe(DEFAULT_TASK_MINUTES);
    expect(result.items[0]?.durationSource).toBe('shape_default');
  });

  it('clamps a corrupt estimate into the documented bounds', () => {
    const huge = planDay(
      baseInput({ candidates: [candidate({ taskId: 'A', estimateMinutes: 100_000 })] }),
    );
    expect(huge.items[0]?.minutes).toBe(MAX_TASK_MINUTES);

    const tiny = planDay(
      baseInput({ candidates: [candidate({ taskId: 'A', estimateMinutes: 1 })] }),
    );
    expect(tiny.items[0]?.minutes).toBe(MIN_TASK_MINUTES);
  });
});

describe('planDay — availability is real, and protected time is unreachable', () => {
  it('places nothing inside a declared personal window', () => {
    // The default model protects 12:00–13:00 for lunch. Enough work to overflow the morning
    // must skip it rather than eat into it.
    const result = planDay(
      baseInput({
        candidates: Array.from({ length: 8 }, (_, i) =>
          candidate({ taskId: `T${String(i)}`, estimateMinutes: 60 }),
        ),
      }),
    );
    const lunchStart = at(12 * 60);
    const lunchEnd = at(13 * 60);
    for (const item of result.items) {
      if (item.start === null || item.end === null) continue;
      expect(item.start < lunchEnd && lunchStart < item.end).toBe(false);
    }
  });

  it('never double-books: no two timeboxes overlap', () => {
    const result = planDay(
      baseInput({
        candidates: Array.from({ length: 10 }, (_, i) =>
          candidate({ taskId: `T${String(i)}`, estimateMinutes: 45 }),
        ),
      }),
    );
    const placed = result.items
      .filter((i) => i.start !== null)
      .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    for (let i = 1; i < placed.length; i += 1) {
      expect(assertDefined(assertDefined(placed[i]).start)).toBeGreaterThanOrEqual(
        assertDefined(assertDefined(placed[i - 1]).end),
      );
    }
  });

  it('routes around time the week planner already placed rather than on top of it', () => {
    // This is the concrete join between the two systems: a block planWeek placed is busy time
    // here, so an auto-planned day can never double-book the week it belongs to.
    const weekBlock: Interval = { start: at(9 * 60), end: at(11 * 60) };
    const result = planDay(
      baseInput({
        busy: [weekBlock],
        candidates: [candidate({ taskId: 'A', estimateMinutes: 60 })],
      }),
    );
    const item = result.items[0];
    expect(item?.start).not.toBeNull();
    expect(
      assertDefined(assertDefined(item).start) < weekBlock.end &&
        weekBlock.start < assertDefined(assertDefined(item).end),
    ).toBe(false);
  });

  it('stuffs the windows front to back rather than leaving the morning empty', () => {
    const result = planDay(
      baseInput({ candidates: [candidate({ taskId: 'A', estimateMinutes: 60 })] }),
    );
    // Desk availability opens at 09:00 in the default model.
    expect(result.items[0]?.start).toBe(at(9 * 60));
  });

  it('keeps an over-full day on the plan, in order, and says what did not fit', () => {
    const candidates = Array.from({ length: 40 }, (_, i) =>
      candidate({ taskId: `T${String(i).padStart(2, '0')}`, estimateMinutes: 120 }),
    );
    const result = planDay(baseInput({ candidates }));
    expect(result.items).toHaveLength(40);
    expect(result.unplaced.length).toBeGreaterThan(0);
    // Everything unplaced is still a plan line, just without a timebox.
    for (const un of result.unplaced) {
      const item = result.items.find((i) => i.taskId === un.taskId);
      expect(item?.start).toBeNull();
      expect(un.reason).toBe('day_full');
    }
    // And the sort is a dense 1..n regardless of what fitted.
    expect(result.items.map((i) => i.sort)).toEqual(candidates.map((_, i) => i + 1));
  });

  it('plans nothing into a day with no declared windows, and says so', () => {
    const noWindows: AvailabilityWindow[] = [];
    const result = planDay(
      baseInput({ windows: noWindows, candidates: [candidate({ taskId: 'A' })] }),
    );
    expect(result.items[0]?.start).toBeNull();
    expect(result.unplaced.map((u) => u.taskId)).toEqual(['A']);
    expect(result.availableMinutes).toBe(0);
  });
});

/** A seeded PRNG, so a "generated" case is reproducible from its seed alone. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRIORITIES = ['none', 'urgent', 'high', 'medium', 'low'] as const;

/** Generate a candidate set plus a guaranteed-acyclic DAG over it. */
function generateCase(seed: number): { candidates: DayCandidate[]; edges: DependencyEdge[] } {
  const rand = mulberry32(seed);
  const count = 3 + Math.floor(rand() * 12);
  const candidates: DayCandidate[] = Array.from({ length: count }, (_, i) =>
    candidate({
      taskId: `T${String(i).padStart(2, '0')}`,
      priority: assertDefined(PRIORITIES[Math.floor(rand() * PRIORITIES.length)]),
      estimateMinutes: rand() < 0.5 ? null : 15 + Math.floor(rand() * 180),
      dueDate: rand() < 0.5 ? null : at(Math.floor(rand() * 1440)),
    }),
  );
  // Edges only ever point from a lower index to a higher one, which makes a cycle impossible
  // by construction — the generator tests ordering, not the cycle guard.
  const edges: DependencyEdge[] = [];
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      if (rand() < 0.15) {
        edges.push({
          blockingTaskId: `T${String(i).padStart(2, '0')}`,
          blockedTaskId: `T${String(j).padStart(2, '0')}`,
        });
      }
    }
  }
  return { candidates, edges };
}

describe('planDay — determinism', () => {
  it('produces an identical day from identical inputs, across a hundred generated cases', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const { candidates, edges } = generateCase(seed);
      const first = planDay(baseInput({ candidates, edges }));
      const second = planDay(baseInput({ candidates, edges }));
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }
  });

  it('is independent of the order the candidates and edges arrive in', () => {
    // The property that actually matters: a database returning the same rows in a different
    // page order must not produce a different day. Without a total tiebreak it would.
    for (let seed = 1; seed <= 100; seed += 1) {
      const { candidates, edges } = generateCase(seed);
      const forward = planDay(baseInput({ candidates, edges }));
      const reversed = planDay(
        baseInput({ candidates: [...candidates].reverse(), edges: [...edges].reverse() }),
      );
      expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
    }
  });

  it('never violates a dependency, across a hundred generated cases', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const { candidates, edges } = generateCase(seed);
      const result = planDay(baseInput({ candidates, edges }));
      expect(result.items).toHaveLength(candidates.length);
      for (const edge of edges) {
        expect(indexOf(result.items, edge.blockingTaskId)).toBeLessThan(
          indexOf(result.items, edge.blockedTaskId),
        );
      }
    }
  });

  it('never double-books across a hundred generated cases', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const { candidates, edges } = generateCase(seed);
      const placed = planDay(baseInput({ candidates, edges }))
        .items.filter((i) => i.start !== null)
        .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
      for (let i = 1; i < placed.length; i += 1) {
        expect(assertDefined(assertDefined(placed[i]).start)).toBeGreaterThanOrEqual(
          assertDefined(assertDefined(placed[i - 1]).end),
        );
      }
    }
  });
});

describe('topologicalOrder', () => {
  it('is exported on its own, because the ordering is the part worth reasoning about', () => {
    const order = topologicalOrder(
      [candidate({ taskId: 'B' }), candidate({ taskId: 'A' })],
      [{ blockingTaskId: 'A', blockedTaskId: 'B' }],
    );
    expect(order.map((c) => c.taskId)).toEqual(['A', 'B']);
  });
});
