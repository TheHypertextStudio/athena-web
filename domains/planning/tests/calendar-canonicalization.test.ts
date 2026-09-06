import { describe, expect, it } from 'vitest';

import {
  canonicalizeCalendarItems,
  canonicalizeCalendarLayers,
  groupExactCalendarSources,
  type CanonicalizableCalendarItem,
  type CanonicalizableCalendarLayer,
} from '../src/calendar-canonicalization';

function layer(
  id: string,
  overrides: Partial<CanonicalizableCalendarLayer> = {},
): CanonicalizableCalendarLayer {
  return {
    id,
    sourceIdentity: { namespace: 'google-calendar', value: 'personal@example.com' },
    sourceRelationship: 'subscribed',
    primary: false,
    ...overrides,
  };
}

function item(
  id: string,
  layerId: string,
  overrides: Partial<CanonicalizableCalendarItem> = {},
): CanonicalizableCalendarItem {
  return {
    id,
    layerId,
    eventIdentity: { namespace: 'ical', value: 'event@example.com' },
    occurrenceIdentity: null,
    permissions: { canEditCore: false },
    linkedTasks: [],
    ...overrides,
  };
}

describe('groupExactCalendarSources', () => {
  it('groups an exact source identity across two linked accounts', () => {
    const groups = groupExactCalendarSources([layer('work'), layer('personal')]);

    expect(groups).toEqual([
      { key: 'google-calendar\0personal@example.com', layerIds: ['work', 'personal'] },
    ]);
  });

  it('keeps identity values case-sensitive and namespaces provider-owned', () => {
    const groups = groupExactCalendarSources([
      layer('lower'),
      layer('upper', {
        sourceIdentity: { namespace: 'google-calendar', value: 'Personal@example.com' },
      }),
      layer('microsoft', {
        sourceIdentity: { namespace: 'microsoft-calendar', value: 'personal@example.com' },
      }),
    ]);

    expect(groups).toHaveLength(3);
  });

  it('never groups native or unmigrated layers without a provider identity', () => {
    const groups = groupExactCalendarSources([
      layer('native-a', { sourceIdentity: null }),
      layer('native-b', { sourceIdentity: null }),
    ]);

    expect(groups.map((group) => group.layerIds)).toEqual([['native-a'], ['native-b']]);
  });

  it('returns one owned source for rendering and maps every copy to it', () => {
    const result = canonicalizeCalendarLayers([
      layer('work'),
      layer('personal', { sourceRelationship: 'owned' }),
    ]);

    expect(result.layers.map((entry) => entry.id)).toEqual(['personal']);
    expect(result.preferredLayerIdByLayerId).toEqual(
      new Map([
        ['work', 'personal'],
        ['personal', 'personal'],
      ]),
    );
  });

  it('uses the primary source when relationships are tied', () => {
    const result = canonicalizeCalendarLayers([
      layer('secondary'),
      layer('primary', { primary: true }),
    ]);

    expect(result.layers.map((entry) => entry.id)).toEqual(['primary']);
  });

  it('applies a confirmed group across different provider source identities', () => {
    const result = canonicalizeCalendarLayers(
      [
        layer('us-holidays'),
        layer('regional-holidays', {
          sourceIdentity: { namespace: 'google-calendar', value: 'regional-holidays' },
        }),
      ],
      {
        preferredLayerIdByLayerId: new Map([
          ['us-holidays', 'regional-holidays'],
          ['regional-holidays', 'regional-holidays'],
        ]),
      },
    );

    expect(result.layers.map((entry) => entry.id)).toEqual(['regional-holidays']);
  });
});

describe('canonicalizeCalendarItems', () => {
  it('returns one event for exact iCalendar identity copies and unions linked tasks', () => {
    const result = canonicalizeCalendarItems(
      [
        item('work-event', 'work', {
          linkedTasks: [{ taskId: 'task-a', organizationId: 'org-a', role: 'related' }],
        }),
        item('personal-event', 'personal', {
          permissions: { canEditCore: true },
          linkedTasks: [
            { taskId: 'task-a', organizationId: 'org-a', role: 'related' },
            { taskId: 'task-b', organizationId: 'org-a', role: 'prep' },
          ],
        }),
      ],
      [layer('work'), layer('personal', { sourceRelationship: 'owned' })],
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 'personal-event' });
    expect(result.items[0]?.linkedTasks).toEqual([
      { taskId: 'task-a', organizationId: 'org-a', role: 'related' },
      { taskId: 'task-b', organizationId: 'org-a', role: 'prep' },
    ]);
    expect(result.equivalentItemIds.get('personal-event')).toEqual([
      'work-event',
      'personal-event',
    ]);
  });

  it('uses an explicit preferred source before editability and inferred source ownership', () => {
    const result = canonicalizeCalendarItems(
      [
        item('work-event', 'work'),
        item('personal-event', 'personal', { permissions: { canEditCore: true } }),
      ],
      [layer('work'), layer('personal', { sourceRelationship: 'owned' })],
      {
        preferredLayerIdByLayerId: new Map([
          ['work', 'work'],
          ['personal', 'work'],
        ]),
      },
    );

    expect(result.items.map((entry) => entry.id)).toEqual(['work-event']);
  });

  it('prefers an editable copy when the source preference is tied', () => {
    const result = canonicalizeCalendarItems(
      [
        item('read-only-event', 'read-only'),
        item('editable-event', 'editable', { permissions: { canEditCore: true } }),
      ],
      [
        layer('read-only', {
          sourceIdentity: { namespace: 'google-calendar', value: 'read-only@example.com' },
        }),
        layer('editable', {
          sourceIdentity: { namespace: 'google-calendar', value: 'editable@example.com' },
        }),
      ],
    );

    expect(result.items.map((entry) => entry.id)).toEqual(['editable-event']);
  });

  it('prefers a direct source over a subscribed source when stronger signals are tied', () => {
    const result = canonicalizeCalendarItems(
      [item('subscribed-event', 'subscribed'), item('direct-event', 'direct')],
      [
        layer('subscribed', {
          sourceIdentity: { namespace: 'google-calendar', value: 'subscribed@example.com' },
        }),
        layer('direct', {
          sourceIdentity: { namespace: 'google-calendar', value: 'direct@example.com' },
          sourceRelationship: 'direct',
        }),
      ],
    );

    expect(result.items.map((entry) => entry.id)).toEqual(['direct-event']);
  });

  it('prefers a primary source when editability and relationship are tied', () => {
    const result = canonicalizeCalendarItems(
      [item('secondary-event', 'secondary'), item('primary-event', 'primary')],
      [
        layer('secondary', {
          sourceIdentity: { namespace: 'google-calendar', value: 'secondary@example.com' },
        }),
        layer('primary', {
          sourceIdentity: { namespace: 'google-calendar', value: 'primary@example.com' },
          primary: true,
        }),
      ],
    );

    expect(result.items.map((entry) => entry.id)).toEqual(['primary-event']);
  });

  it('uses the layer id as a stable final source tie-breaker', () => {
    const result = canonicalizeCalendarItems(
      [item('z-event', 'z-layer'), item('a-event', 'a-layer')],
      [
        layer('z-layer', {
          sourceIdentity: { namespace: 'google-calendar', value: 'z@example.com' },
        }),
        layer('a-layer', {
          sourceIdentity: { namespace: 'google-calendar', value: 'a@example.com' },
        }),
      ],
    );

    expect(result.items.map((entry) => entry.id)).toEqual(['a-event']);
  });

  it('keeps two occurrences in one recurring series separate', () => {
    const result = canonicalizeCalendarItems(
      [
        item('monday-work', 'work', { occurrenceIdentity: '2026-09-07T09:00:00-07:00' }),
        item('monday-personal', 'personal', {
          occurrenceIdentity: '2026-09-07T09:00:00-07:00',
        }),
        item('tuesday-work', 'work', { occurrenceIdentity: '2026-09-08T09:00:00-07:00' }),
        item('tuesday-personal', 'personal', {
          occurrenceIdentity: '2026-09-08T09:00:00-07:00',
        }),
      ],
      [layer('work'), layer('personal')],
    );

    expect(result.items).toHaveLength(2);
  });

  it('collapses the same iCalendar event across Google and Microsoft adapters', () => {
    const result = canonicalizeCalendarItems(
      [item('google-event', 'google'), item('microsoft-event', 'microsoft')],
      [
        layer('google'),
        layer('microsoft', {
          sourceIdentity: { namespace: 'microsoft-calendar', value: 'AAMk-calendar' },
          sourceRelationship: 'owned',
        }),
      ],
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe('microsoft-event');
  });

  it('does not collapse equal titles and times without an exact event identity', () => {
    const result = canonicalizeCalendarItems(
      [
        item('first', 'work', { eventIdentity: null }),
        item('second', 'personal', { eventIdentity: null }),
      ],
      [layer('work'), layer('personal')],
    );

    expect(result.items.map((entry) => entry.id)).toEqual(['first', 'second']);
  });

  it('compares opaque event identities case-sensitively', () => {
    const result = canonicalizeCalendarItems(
      [
        item('lower', 'work'),
        item('upper', 'personal', {
          eventIdentity: { namespace: 'ical', value: 'Event@example.com' },
        }),
      ],
      [layer('work'), layer('personal')],
    );

    expect(result.items).toHaveLength(2);
  });

  it('never collapses two source entries inside one calendar layer', () => {
    const result = canonicalizeCalendarItems(
      [item('first', 'work'), item('second', 'work')],
      [layer('work')],
    );

    expect(result.items).toHaveLength(2);
  });
});
