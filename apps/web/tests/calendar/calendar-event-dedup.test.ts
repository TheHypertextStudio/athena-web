/**
 * Contract tests for {@link import('../../src/components/calendar/calendar-event-dedup')}.
 *
 * @remarks
 * The requirement is "the same event arriving from more than one connected account renders as a
 * single block, and the deduplicated sources stay discoverable". Both halves are asserted here:
 * every collapse is checked for what survives *and* for the provenance it hands back, because a
 * copy that vanishes with nothing recording where it went is the failure mode this feature is meant
 * to prevent.
 *
 * The negative cases carry as much weight as the positive ones. Two entries in the *same* calendar
 * that share a title and a time are two real entries — a double booking, a duplicated invite the
 * owner has to see — and collapsing those would make the app lie about what is scheduled.
 */
import { CalendarConnectionId, CalendarItemId, CalendarLayerId } from '@docket/planning/ids';
import { type CalendarItemOut, type CalendarLayerOut } from '@docket/planning/calendar-contract';
import { describe, expect, it } from 'vitest';

import { deduplicateCalendarItems } from '../../src/components/calendar/calendar-event-dedup';
import { assertDefined } from '@docket/test-utils';

const WORK_LAYER = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVA1');
const PERSONAL_LAYER = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVA2');
const THIRD_LAYER = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVA3');
const WORK_CONNECTION = CalendarConnectionId.parse('01BX5ZZKBKACTAV9WEVGEMMVB1');
const PERSONAL_CONNECTION = CalendarConnectionId.parse('01BX5ZZKBKACTAV9WEVGEMMVB2');

/** A provider calendar item fixture with the fields dedup actually reads. */
function item(overrides: Partial<CalendarItemOut> & { id: string }): CalendarItemOut {
  return {
    layerId: WORK_LAYER,
    connectionId: WORK_CONNECTION,
    kind: 'provider_event',
    provider: 'google',
    externalCalendarId: 'work@example.com',
    externalEventId: null,
    recurringEventId: null,
    recurrenceInstanceKey: null,
    status: 'confirmed',
    title: 'Design review',
    description: null,
    location: null,
    workPlaceId: null,
    htmlLink: null,
    startsAt: '2026-08-02T15:00:00.000Z',
    endsAt: '2026-08-02T16:00:00.000Z',
    allDayStartDate: null,
    allDayEndDate: null,
    timezone: null,
    organizer: null,
    attendees: [],
    permissions: { canEditCore: false, canDelete: false, readOnlyReason: null },
    syncState: 'clean',
    hasConflict: false,
    updatedExternalAt: null,
    archivedAt: null,
    linkedTasks: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A layer fixture; dedup reads only `id` and `primary`. */
function layer(overrides: Partial<CalendarLayerOut> & { id: string }): CalendarLayerOut {
  return {
    connectionId: WORK_CONNECTION,
    provider: 'google',
    sourceKind: 'provider_calendar',
    externalLayerId: 'work@example.com',
    title: 'Work',
    description: null,
    timezone: null,
    color: '#2563eb',
    accessRole: 'reader',
    primary: false,
    selected: true,
    visibleByDefault: true,
    editableCore: false,
    lastSyncedAt: null,
    lastError: null,
    watchExpiresAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

const ITEM_A = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVD1');
const ITEM_B = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVD2');
const ITEM_C = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVD3');

describe('deduplicateCalendarItems', () => {
  it('collapses the same provider event synced from two accounts into one block', () => {
    const work = item({ id: ITEM_A, externalEventId: 'evt-9', layerId: WORK_LAYER });
    const personal = item({
      id: ITEM_B,
      externalEventId: 'EVT-9',
      layerId: PERSONAL_LAYER,
      connectionId: PERSONAL_CONNECTION,
    });

    const result = deduplicateCalendarItems(
      [work, personal],
      [layer({ id: WORK_LAYER }), layer({ id: PERSONAL_LAYER })],
    );

    expect(result.items).toHaveLength(1);
    // The provenance of the copy that was folded away is exactly what the detail view renders.
    expect(
      result.duplicatesByItemId.get(assertDefined(result.items[0]).id)?.map((copy) => copy.id),
    ).toEqual([assertDefined(result.items[0]).id === ITEM_A ? ITEM_B : ITEM_A]);
  });

  it('collapses an identically-titled, identically-timed holiday from two accounts', () => {
    // Google issues a *different* generated calendar id per locale for one holiday set, so the
    // provider identifiers do not match and only title + instant can see that these are one day.
    const work = item({
      id: ITEM_A,
      title: 'Independence Day',
      layerId: WORK_LAYER,
      allDayStartDate: '2026-07-04',
      allDayEndDate: '2026-07-05',
      startsAt: '2026-07-04T00:00:00.000Z',
      endsAt: '2026-07-05T00:00:00.000Z',
    });
    const personal = item({
      id: ITEM_B,
      title: 'independence day',
      layerId: PERSONAL_LAYER,
      connectionId: PERSONAL_CONNECTION,
      allDayStartDate: '2026-07-04',
      allDayEndDate: '2026-07-05',
      // A different instant for the same bare date: the two accounts sit in different timezones.
      startsAt: '2026-07-04T05:00:00.000Z',
      endsAt: '2026-07-05T05:00:00.000Z',
    });

    const result = deduplicateCalendarItems(
      [work, personal],
      [layer({ id: WORK_LAYER }), layer({ id: PERSONAL_LAYER })],
    );

    expect(result.items).toHaveLength(1);
    expect(result.duplicatesByItemId.get(assertDefined(result.items[0]).id)).toHaveLength(1);
  });

  it('collapses three copies of one event into a single block naming both others', () => {
    const copies = [WORK_LAYER, PERSONAL_LAYER, THIRD_LAYER].map((layerId, index) =>
      item({
        id: assertDefined([ITEM_A, ITEM_B, ITEM_C][index]),
        externalEventId: 'evt-9',
        layerId,
      }),
    );

    const result = deduplicateCalendarItems(
      copies,
      copies.map((copy) => layer({ id: copy.layerId })),
    );

    expect(result.items).toHaveLength(1);
    expect(result.duplicatesByItemId.get(assertDefined(result.items[0]).id)).toHaveLength(2);
  });

  it('keeps the copy you can edit, so the surviving block stays draggable', () => {
    const readOnly = item({ id: ITEM_A, externalEventId: 'evt-9', layerId: WORK_LAYER });
    const writable = item({
      id: ITEM_B,
      externalEventId: 'evt-9',
      layerId: PERSONAL_LAYER,
      permissions: { canEditCore: true, canDelete: true, readOnlyReason: null },
    });

    const result = deduplicateCalendarItems(
      [readOnly, writable],
      [layer({ id: WORK_LAYER }), layer({ id: PERSONAL_LAYER })],
    );

    expect(result.items.map((entry) => entry.id)).toEqual([ITEM_B]);
  });

  it('prefers the primary calendar when neither copy is editable', () => {
    const secondary = item({ id: ITEM_A, externalEventId: 'evt-9', layerId: WORK_LAYER });
    const onPrimary = item({ id: ITEM_B, externalEventId: 'evt-9', layerId: PERSONAL_LAYER });

    const result = deduplicateCalendarItems(
      [secondary, onPrimary],
      [layer({ id: WORK_LAYER }), layer({ id: PERSONAL_LAYER, primary: true })],
    );

    expect(result.items.map((entry) => entry.id)).toEqual([ITEM_B]);
  });

  it('never collapses two entries inside one calendar, however identical', () => {
    // A double booking is real information. Hiding one would be the app lying about the day.
    const first = item({ id: ITEM_A, layerId: WORK_LAYER });
    const second = item({ id: ITEM_B, layerId: WORK_LAYER });

    const result = deduplicateCalendarItems([first, second], [layer({ id: WORK_LAYER })]);

    expect(result.items).toHaveLength(2);
    expect(result.duplicatesByItemId.size).toBe(0);
  });

  it('leaves genuinely different events on different calendars alone', () => {
    const standup = item({ id: ITEM_A, title: 'Standup', layerId: WORK_LAYER });
    const oneOnOne = item({
      id: ITEM_B,
      title: 'One on one',
      layerId: PERSONAL_LAYER,
      startsAt: '2026-08-02T17:00:00.000Z',
      endsAt: '2026-08-02T17:30:00.000Z',
    });

    const result = deduplicateCalendarItems(
      [standup, oneOnOne],
      [layer({ id: WORK_LAYER }), layer({ id: PERSONAL_LAYER })],
    );

    expect(result.items).toHaveLength(2);
    expect(result.duplicatesByItemId.size).toBe(0);
  });

  it('does not merge two occurrences of one recurring event', () => {
    const monday = item({
      id: ITEM_A,
      externalEventId: 'evt-9',
      recurrenceInstanceKey: '2026-08-03',
      layerId: WORK_LAYER,
    });
    const tuesday = item({
      id: ITEM_B,
      externalEventId: 'evt-9',
      recurrenceInstanceKey: '2026-08-04',
      layerId: PERSONAL_LAYER,
      title: 'Design review',
      startsAt: '2026-08-04T15:00:00.000Z',
      endsAt: '2026-08-04T16:00:00.000Z',
    });

    const result = deduplicateCalendarItems(
      [monday, tuesday],
      [layer({ id: WORK_LAYER }), layer({ id: PERSONAL_LAYER })],
    );

    expect(result.items).toHaveLength(2);
  });

  it('preserves input order and returns every item exactly once', () => {
    const items = [
      item({ id: ITEM_A, title: 'Standup', layerId: WORK_LAYER }),
      item({ id: ITEM_B, externalEventId: 'evt-9', layerId: WORK_LAYER }),
      item({ id: ITEM_C, externalEventId: 'evt-9', layerId: PERSONAL_LAYER }),
    ];

    const result = deduplicateCalendarItems(items, [
      layer({ id: WORK_LAYER }),
      layer({ id: PERSONAL_LAYER }),
    ]);

    expect(result.items.map((entry) => entry.id)).toEqual([ITEM_A, ITEM_B]);
    const accounted = new Set([
      ...result.items.map((entry) => entry.id),
      ...[...result.duplicatesByItemId.values()].flat().map((entry) => entry.id),
    ]);
    expect(accounted).toEqual(new Set([ITEM_A, ITEM_B, ITEM_C]));
  });

  it('is a no-op for an empty or single-item range', () => {
    expect(deduplicateCalendarItems([], []).items).toEqual([]);
    const only = item({ id: ITEM_A });
    expect(deduplicateCalendarItems([only], []).items).toEqual([only]);
  });

  it('never collapses Docket-native items, which carry no provider identity', () => {
    const first = item({
      id: ITEM_A,
      provider: null,
      externalEventId: null,
      kind: 'native_block',
      title: 'Focus',
      layerId: WORK_LAYER,
    });
    const second = item({
      id: ITEM_B,
      provider: null,
      externalEventId: null,
      kind: 'native_block',
      title: 'Focus',
      // Same title and time, but a native block only ever exists in one place, so a second one is a
      // second block the person made on purpose.
      layerId: WORK_LAYER,
    });

    expect(
      deduplicateCalendarItems([first, second], [layer({ id: WORK_LAYER })]).items,
    ).toHaveLength(2);
  });
});
