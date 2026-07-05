/**
 * Unit tests for the pure overlap/lane layout in
 * {@link import('../../src/components/calendar/lane-layout')}.
 *
 * @remarks
 * `layoutLanes` is the full calendar view's only overlap-placement logic, so its contract is
 * pinned thoroughly, independent of any React rendering:
 *
 * - no items → no placements;
 * - disjoint items each get lane 0 with `laneCount: 1` (no unrelated cluster inflates their count);
 * - touching items (one ends exactly when the next starts) are treated as disjoint, not overlapping;
 * - a fully overlapping pair gets two lanes;
 * - a nested triple (A ⊃ B ⊃ C) gets three lanes;
 * - a transitive chain where the two ends never overlap each other still needs only 2 lanes, not 3;
 * - input order does not affect the placement (the function sorts internally).
 */
import { describe, expect, it } from 'vitest';

import { type LaneLayoutInput, layoutLanes } from '@/components/calendar/lane-layout';

/** Build a lane-layout input with a stable id and ISO bounds on 2026-07-01. */
function item(id: string, startHHMM: string, endHHMM: string): LaneLayoutInput {
  return {
    id,
    startsAt: `2026-07-01T${startHHMM}:00.000Z`,
    endsAt: `2026-07-01T${endHHMM}:00.000Z`,
  };
}

/** Find a placement by id, asserting it exists (fails loudly instead of returning `undefined`). */
function placementOf(placements: ReturnType<typeof layoutLanes>, id: string) {
  const found = placements.find((p) => p.id === id);
  if (!found) throw new Error(`No placement for ${id}`);
  return found;
}

describe('layoutLanes', () => {
  it('returns no placements for no items', () => {
    expect(layoutLanes([])).toEqual([]);
  });

  it('places non-overlapping items each in lane 0 with laneCount 1', () => {
    const placements = layoutLanes([item('a', '09:00', '09:30'), item('b', '10:00', '10:30')]);
    expect(placementOf(placements, 'a')).toEqual({ id: 'a', lane: 0, laneCount: 1 });
    expect(placementOf(placements, 'b')).toEqual({ id: 'b', lane: 0, laneCount: 1 });
  });

  it('treats touching items (one ends exactly when the next starts) as non-overlapping', () => {
    const placements = layoutLanes([item('a', '09:00', '10:00'), item('b', '10:00', '11:00')]);
    expect(placementOf(placements, 'a')).toEqual({ id: 'a', lane: 0, laneCount: 1 });
    expect(placementOf(placements, 'b')).toEqual({ id: 'b', lane: 0, laneCount: 1 });
  });

  it('places a fully overlapping pair in two lanes', () => {
    const placements = layoutLanes([item('a', '09:00', '10:00'), item('b', '09:15', '09:45')]);
    expect(placementOf(placements, 'a')).toEqual({ id: 'a', lane: 0, laneCount: 2 });
    expect(placementOf(placements, 'b')).toEqual({ id: 'b', lane: 1, laneCount: 2 });
  });

  it('places a nested triple (A ⊃ B ⊃ C) in three lanes', () => {
    const placements = layoutLanes([
      item('a', '09:00', '10:00'),
      item('b', '09:15', '09:45'),
      item('c', '09:20', '09:30'),
    ]);
    expect(placementOf(placements, 'a')).toEqual({ id: 'a', lane: 0, laneCount: 3 });
    expect(placementOf(placements, 'b')).toEqual({ id: 'b', lane: 1, laneCount: 3 });
    expect(placementOf(placements, 'c')).toEqual({ id: 'c', lane: 2, laneCount: 3 });
  });

  it('needs only 2 lanes for a transitive chain whose ends never overlap each other', () => {
    // a: 9:00-10:00, b: 9:30-10:30 (overlaps a), c: 10:15-11:00 (overlaps b only, not a).
    // a and c never coexist, so c can reuse a's lane once a ends.
    const placements = layoutLanes([
      item('a', '09:00', '10:00'),
      item('b', '09:30', '10:30'),
      item('c', '10:15', '11:00'),
    ]);
    expect(placementOf(placements, 'a').lane).toBe(0);
    expect(placementOf(placements, 'b').lane).toBe(1);
    expect(placementOf(placements, 'c').lane).toBe(0);
    expect(placementOf(placements, 'a').laneCount).toBe(2);
    expect(placementOf(placements, 'b').laneCount).toBe(2);
    expect(placementOf(placements, 'c').laneCount).toBe(2);
  });

  it('produces the same placements regardless of input order', () => {
    const inOrder = [item('a', '09:00', '10:00'), item('b', '09:15', '09:45')];
    const reversed = [inOrder[1]!, inOrder[0]!];
    expect(layoutLanes(reversed).sort((x, y) => x.id.localeCompare(y.id))).toEqual(
      layoutLanes(inOrder).sort((x, y) => x.id.localeCompare(y.id)),
    );
  });

  it('keeps two disjoint clusters independent (no cross-cluster lane inflation)', () => {
    const placements = layoutLanes([
      item('a', '09:00', '09:30'),
      item('b', '09:00', '09:30'),
      item('c', '11:00', '11:30'),
    ]);
    expect(placementOf(placements, 'a').laneCount).toBe(2);
    expect(placementOf(placements, 'b').laneCount).toBe(2);
    expect(placementOf(placements, 'c')).toEqual({ id: 'c', lane: 0, laneCount: 1 });
  });
});
