import { describe, expect, it } from 'vitest';

import { arrangeDenseScheduleItems } from '@/components/scheduling/scheduling-dense-overflow';
import { positionScheduleLaneItems } from '@/components/scheduling/scheduling-overlap-layout';
import type { ScheduleItem, ScheduleLane } from '@/components/scheduling/scheduling-types';
import { assertDefined } from '@docket/test-utils';

/** Build one UTC item with deterministic wall-clock bounds. */
function item(id: string, startsAt: string, endsAt: string): ScheduleItem {
  return {
    id,
    title: `Event ${id}`,
    startsAt: `2026-07-13T${startsAt}:00Z`,
    endsAt: `2026-07-13T${endsAt}:00Z`,
  };
}

/** Position a lane before applying width-aware dense-overlap disclosure. */
function positioned(items: readonly ScheduleItem[]) {
  const lane: ScheduleLane = {
    id: 'date:2026-07-13',
    label: 'Mon, Jul 13',
    date: '2026-07-13',
    items,
  };
  return positionScheduleLaneItems(lane, 'UTC', 60, 18);
}

describe('arrangeDenseScheduleItems', () => {
  it('derives collision capacity from the width left after a cluster inset', () => {
    const collisions = positioned([
      item('a', '09:00', '10:00'),
      item('b', '09:00', '10:00'),
      item('c', '09:00', '10:00'),
    ]);
    const clusterId = assertDefined(collisions[0]).clusterId;
    const withoutInset = arrangeDenseScheduleItems(collisions, 300, {
      minimumReadableItemWidth: 96,
    });
    const withInset = arrangeDenseScheduleItems(collisions, 300, {
      leadingInsetByCluster: new Map([[clusterId, 40]]),
      minimumReadableItemWidth: 96,
    });

    expect(withoutInset.directItems).toHaveLength(3);
    expect(withoutInset.overflowGroups).toEqual([]);
    expect(withInset.directItems).toHaveLength(1);
    expect(withInset.overflowGroups).toHaveLength(1);
    expect(withInset.overflowGroups[0]?.items).toHaveLength(2);
    expect(withInset.overflowGroups[0]?.placement).toMatchObject({
      columnIndex: 1,
      columnCount: 2,
    });
  });

  it('keeps ordinary collisions directly visible when their cards remain readable', () => {
    const result = arrangeDenseScheduleItems(
      positioned([
        item('a', '09:00', '10:00'),
        item('b', '09:00', '10:00'),
        item('c', '09:00', '10:00'),
      ]),
      500,
    );

    expect(result.directItems.map(({ item: direct }) => direct.id)).toEqual(['a', 'b', 'c']);
    expect(result.overflowGroups).toEqual([]);
  });

  it('derives readable capacity from lane width and preserves access to all fifty items', () => {
    const result = arrangeDenseScheduleItems(
      positioned(
        Array.from({ length: 50 }, (_, index) =>
          item(`dense-${String(index).padStart(2, '0')}`, '09:00', '10:00'),
        ),
      ),
      240,
    );

    expect(result.directItems).toHaveLength(2);
    expect(result.directItems.every(({ placement }) => placement.columnCount === 3)).toBe(true);
    expect(result.overflowGroups).toHaveLength(1);
    expect(result.overflowGroups[0]?.items).toHaveLength(48);
    expect(result.overflowGroups[0]?.placement).toMatchObject({
      columnIndex: 2,
      columnCount: 3,
    });
    expect(
      new Set([
        ...result.directItems.map(({ item: direct }) => direct.id),
        ...result.overflowGroups.flatMap((group) =>
          group.items.map(({ item: hidden }) => hidden.id),
        ),
      ]).size,
    ).toBe(50);
  });

  it('promotes a chosen hidden column without duplicating or losing collision items', () => {
    const result = arrangeDenseScheduleItems(
      positioned(
        Array.from({ length: 5 }, (_, index) => item(`dense-${String(index)}`, '09:00', '10:00')),
      ),
      240,
      { promotedItemId: 'dense-4' },
    );

    expect(result.directItems.map(({ item: direct }) => direct.id)).toEqual(['dense-0', 'dense-4']);
    expect(result.directItems.at(-1)?.placement).toMatchObject({
      columnIndex: 1,
      columnCount: 3,
    });
    expect(
      result.overflowGroups.flatMap(({ items }) => items.map(({ item: hidden }) => hidden.id)),
    ).toEqual(['dense-1', 'dense-2', 'dense-3']);
  });

  it('creates independent overflow disclosures for disjoint dense clusters', () => {
    const result = arrangeDenseScheduleItems(
      positioned([
        ...Array.from({ length: 5 }, (_, index) =>
          item(`morning-${String(index)}`, '09:00', '10:00'),
        ),
        ...Array.from({ length: 5 }, (_, index) =>
          item(`afternoon-${String(index)}`, '14:00', '15:00'),
        ),
      ]),
      240,
    );

    expect(result.overflowGroups).toHaveLength(2);
    expect(result.overflowGroups.map(({ items }) => items.length)).toEqual([3, 3]);
    expect(result.overflowGroups[0]?.top).toBe(9 * 60);
    expect(result.overflowGroups[1]?.top).toBe(14 * 60);
  });

  it('keeps a short overflow hitbox inside its collision interval', () => {
    const result = arrangeDenseScheduleItems(
      positioned([
        ...Array.from({ length: 5 }, (_, index) =>
          item(`short-${String(index)}`, '09:00', '09:05'),
        ),
        item('next', '09:20', '09:50'),
      ]),
      240,
    );

    expect(result.overflowGroups[0]).toMatchObject({ top: 9 * 60, height: 18 });
    expect(
      assertDefined(result.overflowGroups[0]).top + assertDefined(result.overflowGroups[0]).height,
    ).toBeLessThanOrEqual(
      assertDefined(result.directItems.find(({ item: direct }) => direct.id === 'next')).top,
    );
  });

  it('caps an ordinary overflow disclosure at forty pixels', () => {
    const result = arrangeDenseScheduleItems(
      positioned(
        Array.from({ length: 5 }, (_, index) => item(`dense-${String(index)}`, '09:00', '10:00')),
      ),
      240,
    );

    expect(result.overflowGroups[0]?.height).toBe(40);
  });

  it('places local disclosures along a long transitive collision chain', () => {
    const result = arrangeDenseScheduleItems(
      positioned([
        item('morning-long', '09:00', '13:00'),
        item('morning-a', '09:00', '10:00'),
        item('morning-b', '09:00', '10:00'),
        item('morning-c', '09:00', '10:00'),
        item('afternoon-a', '12:00', '14:00'),
        item('afternoon-b', '12:00', '14:00'),
        item('afternoon-c', '12:00', '14:00'),
      ]),
      240,
    );

    expect(result.overflowGroups.map(({ top }) => top)).toEqual([9 * 60, 12 * 60]);
    expect(result.overflowGroups.map(({ items }) => items.length)).toEqual([2, 2]);
  });
});
