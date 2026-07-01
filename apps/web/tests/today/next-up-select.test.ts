/**
 * Unit tests for the Today "Next up" selector in
 * {@link import('../../src/components/today/next-up-select')}.
 *
 * @remarks
 * `selectNextUp` decides *what* the daily landing shows next, independent of the React tree that
 * renders it. The contract these pin:
 *
 * - upcoming timeboxed blocks win, ordered by start, capped at `NEXT_UP_LIMIT`;
 * - a block still in progress (started before `now`, ends after) is still "upcoming";
 * - a block that already ended is dropped;
 * - with no upcoming block, it falls back to tasks due today (same cap);
 * - upcoming blocks suppress the due-today fallback entirely;
 * - a clear day (no upcoming block, no due task) yields an empty list, not a crash.
 */
import { HubTaskItem, OrganizationId, TaskId } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { type CalendarBlock, NEXT_UP_LIMIT, selectNextUp } from '@/components/today/next-up-select';

/** Reference "now" all fixtures are positioned around. */
const NOW = new Date('2026-06-29T12:00:00.000Z');

/** A valid org ULID, reused across fixtures (only its identity matters here). */
const ORG = '01BX5ZZKBKACTAV9WEVGEMMVRZ';
/** Distinct valid task ULIDs (share a prefix, vary in the last char). */
const T = {
  past: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
  inProgress: '01ARZ3NDEKTSV4RRFFQ69G5FA1',
  soon: '01ARZ3NDEKTSV4RRFFQ69G5FA2',
  later: '01ARZ3NDEKTSV4RRFFQ69G5FA3',
  latest: '01ARZ3NDEKTSV4RRFFQ69G5FA4',
};
/** Distinct valid due-task ULIDs. */
const D = {
  one: '01BX5ZZKBKACTAV9WEVGEMMVR0',
  two: '01BX5ZZKBKACTAV9WEVGEMMVR1',
  three: '01BX5ZZKBKACTAV9WEVGEMMVR2',
  four: '01BX5ZZKBKACTAV9WEVGEMMVR3',
};

/** Build a calendar block with correctly-branded ids (no casts). */
function block(taskUlid: string, startsAt: string, endsAt: string): CalendarBlock {
  return {
    taskId: TaskId.parse(taskUlid),
    organizationId: OrganizationId.parse(ORG),
    startsAt,
    endsAt,
  };
}

/** Build a minimal due-today task via the DTO schema. */
function dueTask(idUlid: string): HubTaskItem {
  return HubTaskItem.parse({
    id: idUlid,
    organizationId: ORG,
    title: 'Due task',
    state: 'started',
    priority: 'medium',
  });
}

describe('selectNextUp', () => {
  it('returns upcoming blocks, start-ordered, capped at NEXT_UP_LIMIT', () => {
    const blocks = [
      block(T.latest, '2026-06-29T15:00:00.000Z', '2026-06-29T15:30:00.000Z'),
      block(T.soon, '2026-06-29T13:00:00.000Z', '2026-06-29T13:30:00.000Z'),
      block(T.later, '2026-06-29T14:00:00.000Z', '2026-06-29T14:30:00.000Z'),
      block(T.inProgress, '2026-06-29T11:30:00.000Z', '2026-06-29T12:30:00.000Z'),
    ];

    const picks = selectNextUp(blocks, [], NOW);

    expect(picks).toHaveLength(NEXT_UP_LIMIT);
    expect(picks.every((p) => p.kind === 'block')).toBe(true);
    // In-progress block sorts first (earliest start), then soon, then later. `latest` is dropped
    // by the cap.
    expect(picks.map((p) => (p.kind === 'block' ? p.block.taskId : null))).toEqual([
      TaskId.parse(T.inProgress),
      TaskId.parse(T.soon),
      TaskId.parse(T.later),
    ]);
  });

  it('drops blocks that have already ended', () => {
    const blocks = [
      block(T.past, '2026-06-29T09:00:00.000Z', '2026-06-29T09:30:00.000Z'),
      block(T.soon, '2026-06-29T13:00:00.000Z', '2026-06-29T13:30:00.000Z'),
    ];

    const picks = selectNextUp(blocks, [], NOW);

    expect(picks).toHaveLength(1);
    expect(picks[0]?.kind === 'block' ? picks[0].block.taskId : null).toEqual(TaskId.parse(T.soon));
  });

  it('falls back to due-today tasks when no block is upcoming, capped at NEXT_UP_LIMIT', () => {
    const endedBlocks = [block(T.past, '2026-06-29T09:00:00.000Z', '2026-06-29T09:30:00.000Z')];
    const dueToday = [dueTask(D.one), dueTask(D.two), dueTask(D.three), dueTask(D.four)];

    const picks = selectNextUp(endedBlocks, dueToday, NOW);

    expect(picks).toHaveLength(NEXT_UP_LIMIT);
    expect(picks.every((p) => p.kind === 'due')).toBe(true);
    expect(picks.map((p) => (p.kind === 'due' ? p.task.id : null))).toEqual([
      HubTaskItem.parse({ ...dueTask(D.one) }).id,
      HubTaskItem.parse({ ...dueTask(D.two) }).id,
      HubTaskItem.parse({ ...dueTask(D.three) }).id,
    ]);
  });

  it('suppresses the due-today fallback when an upcoming block exists', () => {
    const blocks = [block(T.soon, '2026-06-29T13:00:00.000Z', '2026-06-29T13:30:00.000Z')];
    const dueToday = [dueTask(D.one)];

    const picks = selectNextUp(blocks, dueToday, NOW);

    expect(picks).toHaveLength(1);
    expect(picks[0]?.kind).toBe('block');
  });

  it('returns an empty list on a clear day', () => {
    expect(selectNextUp([], [], NOW)).toEqual([]);
  });
});
