/**
 * Unit contract for {@link import('../../src/components/calendar/calendar-layer-dedup')}.
 *
 * @remarks
 * Pins the exact rules the panel's "Hide duplicates" action rests on. Two properties matter most
 * and are asserted throughout: the function never returns a group of one (so no caller can be led
 * to hide the only copy of a calendar), and it never throws or degrades to nothing when the linked
 * accounts are unknown.
 */
import {
  CalendarConnectionId,
  type CalendarConnectionOut,
  CalendarLayerId,
  type CalendarLayerOut,
} from '@docket/types';
import { describe, expect, it } from 'vitest';

import {
  findDuplicateCalendarLayers,
  isHolidayLayer,
} from '../../src/components/calendar/calendar-layer-dedup';

const WORK_CONNECTION = CalendarConnectionId.parse('01BX5ZZKBKACTAV9WEVGEMMVC1');
const PERSONAL_CONNECTION = CalendarConnectionId.parse('01BX5ZZKBKACTAV9WEVGEMMVC2');

/** A linked Google account fixture. */
function connection(
  id: string,
  accountEmail: string | null,
  overrides: Partial<CalendarConnectionOut> = {},
): CalendarConnectionOut {
  return {
    id: CalendarConnectionId.parse(id),
    provider: 'google',
    externalAccountId: `sub-${id}`,
    accountEmail,
    accountName: accountEmail,
    accountPictureUrl: null,
    status: 'connected',
    calendarsTotal: 1,
    calendarsEnabled: 1,
    lastSyncedAt: null,
    lastError: null,
    scopeState: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A calendar-layer fixture defaulting to a Docket-native layer. */
function layer(id: string, overrides: Partial<CalendarLayerOut> = {}): CalendarLayerOut {
  return {
    id: CalendarLayerId.parse(id),
    connectionId: null,
    provider: null,
    sourceKind: 'native_blocks',
    externalLayerId: null,
    title: 'Layer',
    description: null,
    timezone: null,
    color: null,
    accessRole: null,
    primary: false,
    selected: true,
    visibleByDefault: true,
    editableCore: true,
    lastSyncedAt: null,
    lastError: null,
    watchExpiresAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A provider layer under one linked account. */
function providerLayer(
  id: string,
  connectionId: string,
  externalLayerId: string,
  overrides: Partial<CalendarLayerOut> = {},
): CalendarLayerOut {
  return layer(id, {
    connectionId: CalendarConnectionId.parse(connectionId),
    provider: 'google',
    sourceKind: 'provider_calendar',
    externalLayerId,
    ...overrides,
  });
}

describe('isHolidayLayer', () => {
  it.each([
    'en.usa#holiday@group.v.calendar.google.com',
    'en-gb.uk#holidays@group.v.calendar.google.com',
    'something@holiday.calendar.google.com',
    'EN.USA#HOLIDAY@group.v.calendar.google.com',
  ])('recognises %s as a holiday calendar id', (externalLayerId) => {
    expect(
      isHolidayLayer(providerLayer('01BX5ZZKBKACTAV9WEVGEMMVN1', WORK_CONNECTION, externalLayerId)),
    ).toBe(true);
  });

  it.each([
    'ada@example.com',
    'abc123@group.v.calendar.google.com',
    'primary',
    'imported@import.calendar.google.com',
  ])('does not treat %s as a holiday calendar id', (externalLayerId) => {
    expect(
      isHolidayLayer(providerLayer('01BX5ZZKBKACTAV9WEVGEMMVN1', WORK_CONNECTION, externalLayerId)),
    ).toBe(false);
  });

  it('never classifies a Docket-native layer as a holiday calendar', () => {
    expect(isHolidayLayer(layer('01BX5ZZKBKACTAV9WEVGEMMVN1', { title: 'Holidays' }))).toBe(false);
  });
});

describe('findDuplicateCalendarLayers', () => {
  it('returns nothing for a single account with distinct calendars', () => {
    expect(
      findDuplicateCalendarLayers(
        [
          providerLayer('01BX5ZZKBKACTAV9WEVGEMMVN1', WORK_CONNECTION, 'ada@work.example'),
          providerLayer(
            '01BX5ZZKBKACTAV9WEVGEMMVN2',
            WORK_CONNECTION,
            'team@group.v.calendar.google.com',
          ),
          layer('01BX5ZZKBKACTAV9WEVGEMMVN3'),
        ],
        [connection(WORK_CONNECTION, 'ada@work.example')],
      ),
    ).toEqual([]);
  });

  it('never groups Docket-native layers, even when they share a title', () => {
    expect(
      findDuplicateCalendarLayers(
        [
          layer('01BX5ZZKBKACTAV9WEVGEMMVN1', { title: 'Focus' }),
          layer('01BX5ZZKBKACTAV9WEVGEMMVN2', { title: 'Focus' }),
        ],
        [],
      ),
    ).toEqual([]);
  });

  it('groups the same provider calendar subscribed on two accounts', () => {
    const shared = 'team@group.v.calendar.google.com';
    const onWork = providerLayer('01BX5ZZKBKACTAV9WEVGEMMVN1', WORK_CONNECTION, shared, {
      createdAt: '2026-07-01T00:00:00.000Z',
    });
    const onPersonal = providerLayer('01BX5ZZKBKACTAV9WEVGEMMVN2', PERSONAL_CONNECTION, shared, {
      createdAt: '2026-07-05T00:00:00.000Z',
    });

    const [group, ...rest] = findDuplicateCalendarLayers(
      [onPersonal, onWork],
      [
        connection(WORK_CONNECTION, 'ada@work.example'),
        connection(PERSONAL_CONNECTION, 'ada@personal.example'),
      ],
    );

    expect(rest).toEqual([]);
    expect(group?.reason).toBe('same_provider_calendar');
    expect(group?.key).toBe(`google:${shared}`);
    // Neither account owns the calendar, so the oldest copy wins — and input order does not.
    expect(group?.keep.id).toBe(onWork.id);
    expect(group?.redundant.map((entry) => entry.id)).toEqual([onPersonal.id]);
  });

  it('treats a differently-cased and padded provider id as the same calendar', () => {
    const groups = findDuplicateCalendarLayers(
      [
        providerLayer(
          '01BX5ZZKBKACTAV9WEVGEMMVN1',
          WORK_CONNECTION,
          'Team@Group.V.Calendar.Google.Com',
        ),
        providerLayer(
          '01BX5ZZKBKACTAV9WEVGEMMVN2',
          PERSONAL_CONNECTION,
          '  team@group.v.calendar.google.com  ',
        ),
      ],
      [],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.redundant).toHaveLength(1);
  });

  it('prefers the primary copy, then the oldest, over an arbitrary one', () => {
    const shared = 'team@group.v.calendar.google.com';
    const secondary = providerLayer('01BX5ZZKBKACTAV9WEVGEMMVN1', WORK_CONNECTION, shared, {
      createdAt: '2026-06-01T00:00:00.000Z',
    });
    const primary = providerLayer('01BX5ZZKBKACTAV9WEVGEMMVN2', PERSONAL_CONNECTION, shared, {
      createdAt: '2026-07-01T00:00:00.000Z',
      primary: true,
    });

    expect(findDuplicateCalendarLayers([secondary, primary], [])[0]?.keep.id).toBe(primary.id);
  });

  it('keeps the personal copy of a personal calendar that also lands on the work account', () => {
    const personalEmail = 'ada@personal.example';
    const onWork = providerLayer('01BX5ZZKBKACTAV9WEVGEMMVN1', WORK_CONNECTION, personalEmail, {
      createdAt: '2026-06-01T00:00:00.000Z',
      primary: true,
    });
    const onPersonal = providerLayer(
      '01BX5ZZKBKACTAV9WEVGEMMVN2',
      PERSONAL_CONNECTION,
      personalEmail,
      { createdAt: '2026-07-01T00:00:00.000Z' },
    );

    const [group] = findDuplicateCalendarLayers(
      [onWork, onPersonal],
      [
        connection(WORK_CONNECTION, 'ada@work.example'),
        connection(PERSONAL_CONNECTION, personalEmail),
      ],
    );

    expect(group?.reason).toBe('other_account_primary');
    // Account ownership outranks both `primary` and the earlier `createdAt` on the work copy.
    expect(group?.keep.id).toBe(onPersonal.id);
    expect(group?.redundant.map((entry) => entry.id)).toEqual([onWork.id]);
  });

  it('labels a shared mailbox calendar as a plain provider duplicate when no account owns it', () => {
    const shared = 'shared-room@example.com';
    const groups = findDuplicateCalendarLayers(
      [
        providerLayer('01BX5ZZKBKACTAV9WEVGEMMVN1', WORK_CONNECTION, shared),
        providerLayer('01BX5ZZKBKACTAV9WEVGEMMVN2', PERSONAL_CONNECTION, shared),
      ],
      [
        connection(WORK_CONNECTION, 'ada@work.example'),
        connection(PERSONAL_CONNECTION, 'ada@personal.example'),
      ],
    );

    expect(groups[0]?.reason).toBe('same_provider_calendar');
  });

  it('groups the same holiday calendar id arriving on two accounts', () => {
    const holiday = 'en.usa#holiday@group.v.calendar.google.com';
    const groups = findDuplicateCalendarLayers(
      [
        providerLayer('01BX5ZZKBKACTAV9WEVGEMMVN1', WORK_CONNECTION, holiday, {
          title: 'Holidays in United States',
        }),
        providerLayer('01BX5ZZKBKACTAV9WEVGEMMVN2', PERSONAL_CONNECTION, holiday, {
          title: 'Holidays in United States',
        }),
      ],
      [],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.reason).toBe('holiday_calendar');
  });

  it('groups per-locale holiday ids on different accounts by their identical title', () => {
    const groups = findDuplicateCalendarLayers(
      [
        providerLayer(
          '01BX5ZZKBKACTAV9WEVGEMMVN1',
          WORK_CONNECTION,
          'en.usa#holiday@group.v.calendar.google.com',
          { title: 'Holidays in United States' },
        ),
        providerLayer(
          '01BX5ZZKBKACTAV9WEVGEMMVN2',
          PERSONAL_CONNECTION,
          'en-gb.usa#holiday@group.v.calendar.google.com',
          { title: '  holidays in united states ' },
        ),
      ],
      [],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.reason).toBe('holiday_calendar');
    expect(groups[0]?.key).toBe('holiday-title:holidays in united states');
    expect(groups[0]?.redundant).toHaveLength(1);
  });

  it('does not group two identically titled holiday calendars on the same account', () => {
    expect(
      findDuplicateCalendarLayers(
        [
          providerLayer(
            '01BX5ZZKBKACTAV9WEVGEMMVN1',
            WORK_CONNECTION,
            'en.usa#holiday@group.v.calendar.google.com',
            { title: 'Holidays' },
          ),
          providerLayer(
            '01BX5ZZKBKACTAV9WEVGEMMVN2',
            WORK_CONNECTION,
            'en.gb#holiday@group.v.calendar.google.com',
            { title: 'Holidays' },
          ),
        ],
        [connection(WORK_CONNECTION, 'ada@work.example')],
      ),
    ).toEqual([]);
  });

  it('does not group non-holiday calendars that merely share a title', () => {
    expect(
      findDuplicateCalendarLayers(
        [
          providerLayer(
            '01BX5ZZKBKACTAV9WEVGEMMVN1',
            WORK_CONNECTION,
            'a@group.v.calendar.google.com',
            {
              title: 'Team',
            },
          ),
          providerLayer(
            '01BX5ZZKBKACTAV9WEVGEMMVN2',
            PERSONAL_CONNECTION,
            'b@group.v.calendar.google.com',
            {
              title: 'Team',
            },
          ),
        ],
        [],
      ),
    ).toEqual([]);
  });

  it('still reports id-based duplicates when the linked accounts are unknown', () => {
    const shared = 'team@group.v.calendar.google.com';
    const groups = findDuplicateCalendarLayers(
      [
        providerLayer('01BX5ZZKBKACTAV9WEVGEMMVN1', WORK_CONNECTION, shared),
        providerLayer('01BX5ZZKBKACTAV9WEVGEMMVN2', PERSONAL_CONNECTION, shared),
      ],
      [],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.reason).toBe('same_provider_calendar');
  });

  it('returns a stable, key-ordered result for repeated calls', () => {
    const layers = [
      providerLayer(
        '01BX5ZZKBKACTAV9WEVGEMMVN1',
        WORK_CONNECTION,
        'zeta@group.v.calendar.google.com',
      ),
      providerLayer(
        '01BX5ZZKBKACTAV9WEVGEMMVN2',
        PERSONAL_CONNECTION,
        'zeta@group.v.calendar.google.com',
      ),
      providerLayer(
        '01BX5ZZKBKACTAV9WEVGEMMVN3',
        WORK_CONNECTION,
        'alpha@group.v.calendar.google.com',
      ),
      providerLayer(
        '01BX5ZZKBKACTAV9WEVGEMMVN4',
        PERSONAL_CONNECTION,
        'alpha@group.v.calendar.google.com',
      ),
    ];

    const keys = findDuplicateCalendarLayers(layers, []).map((group) => group.key);
    expect(keys).toEqual([
      'google:alpha@group.v.calendar.google.com',
      'google:zeta@group.v.calendar.google.com',
    ]);
    expect(findDuplicateCalendarLayers([...layers].reverse(), []).map((g) => g.key)).toEqual(keys);
  });

  it('tolerates blank ids, missing account emails, and empty input without throwing', () => {
    expect(findDuplicateCalendarLayers([], [])).toEqual([]);
    expect(
      findDuplicateCalendarLayers(
        [
          providerLayer('01BX5ZZKBKACTAV9WEVGEMMVN1', WORK_CONNECTION, '   '),
          providerLayer('01BX5ZZKBKACTAV9WEVGEMMVN2', PERSONAL_CONNECTION, '   '),
        ],
        [connection(WORK_CONNECTION, null)],
      ),
    ).toEqual([]);
  });
});
