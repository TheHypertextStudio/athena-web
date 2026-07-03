import { describe, expect, it } from 'vitest';

import { CalendarItemId, CalendarItemWriteId, CalendarLayerId } from '../src/primitives';
import {
  CalendarItemCreate,
  CalendarItemOut,
  CalendarItemTaskLinkCreate,
  CalendarItemTaskLinkResultOut,
  CalendarItemUpdate,
  CalendarLayerOut,
  CalendarRangeQuery,
} from '../src/calendar';
import type { CalendarItemLinkedTaskOut } from '../src/calendar';

/** Plain ULID strings — used as-is (never pre-parsed) to exercise brand acceptance via `z.input`. */
const LAYER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const CONNECTION_ID = '01BX5ZZKBKACTAV9WEVGEMMVRZ';
const ITEM_ID = '01BX5ZZKBKACTAV9WEVGEMMVS0';
const TASK_ID = '01BX5ZZKBKACTAV9WEVGEMMVS1';
const ORG_ID = '01BX5ZZKBKACTAV9WEVGEMMVS2';

describe('new branded ids accept plain ULID strings', () => {
  it('CalendarLayerId / CalendarItemId / CalendarItemWriteId parse a raw ULID string', () => {
    expect(CalendarLayerId.parse(LAYER_ID)).toBe(LAYER_ID);
    expect(CalendarItemId.parse(ITEM_ID)).toBe(ITEM_ID);
    expect(CalendarItemWriteId.parse(LAYER_ID)).toBe(LAYER_ID);
  });

  it('rejects a non-ULID string', () => {
    expect(CalendarLayerId.safeParse('not-a-ulid').success).toBe(false);
    expect(CalendarItemId.safeParse('not-a-ulid').success).toBe(false);
    expect(CalendarItemWriteId.safeParse('not-a-ulid').success).toBe(false);
  });
});

describe('CalendarLayerOut', () => {
  it('round-trips a provider-backed layer', () => {
    const parsed = CalendarLayerOut.parse({
      id: LAYER_ID,
      connectionId: CONNECTION_ID,
      provider: 'google',
      sourceKind: 'provider_calendar',
      externalLayerId: 'primary',
      title: 'Ada',
      description: null,
      timezone: 'America/Los_Angeles',
      color: '#16a34a',
      accessRole: 'owner',
      primary: true,
      selected: true,
      visibleByDefault: true,
      editableCore: false,
      lastSyncedAt: '2026-06-30T09:00:00.000Z',
      lastError: null,
      watchExpiresAt: null,
      createdAt: '2026-06-30T08:00:00.000Z',
      updatedAt: '2026-06-30T09:00:00.000Z',
    });
    expect(parsed.sourceKind).toBe('provider_calendar');
    expect(parsed.editableCore).toBe(false);
  });

  it('round-trips a Docket-native layer with null connection/provider', () => {
    const parsed = CalendarLayerOut.parse({
      id: LAYER_ID,
      connectionId: null,
      provider: null,
      sourceKind: 'native_blocks',
      externalLayerId: null,
      title: 'My Blocks',
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
      createdAt: '2026-06-30T08:00:00.000Z',
      updatedAt: '2026-06-30T09:00:00.000Z',
    });
    expect(parsed.connectionId).toBeNull();
    expect(parsed.editableCore).toBe(true);
  });

  it('does not expose syncToken or watch-channel identifiers', () => {
    expect(CalendarLayerOut.shape).not.toHaveProperty('syncToken');
    expect(CalendarLayerOut.shape).not.toHaveProperty('watchChannelId');
    expect(CalendarLayerOut.shape).not.toHaveProperty('watchResourceId');
    expect(CalendarLayerOut.shape).not.toHaveProperty('watchToken');
  });
});

const basePermissions = { canEditCore: true, canDelete: true, readOnlyReason: null };

function baseItem() {
  return {
    id: ITEM_ID,
    layerId: LAYER_ID,
    connectionId: CONNECTION_ID,
    kind: 'provider_event' as const,
    provider: 'google' as const,
    externalCalendarId: 'primary',
    externalEventId: 'event-1',
    recurringEventId: null,
    recurrenceInstanceKey: null,
    status: 'confirmed' as const,
    title: 'Design review',
    description: null,
    location: null,
    htmlLink: null,
    startsAt: null,
    endsAt: null,
    allDayStartDate: null,
    allDayEndDate: null,
    timezone: null,
    organizer: null,
    attendees: [],
    permissions: basePermissions,
    syncState: 'clean' as const,
    hasConflict: false,
    updatedExternalAt: null,
    archivedAt: null,
    linkedTasks: [],
    createdAt: '2026-06-30T08:00:00.000Z',
    updatedAt: '2026-06-30T08:00:00.000Z',
  };
}

describe('CalendarItemOut', () => {
  it('parses a timed item', () => {
    const parsed = CalendarItemOut.parse({
      ...baseItem(),
      startsAt: '2026-06-30T16:00:00.000Z',
      endsAt: '2026-06-30T17:00:00.000Z',
    });
    expect(parsed.startsAt).toContain('T16:00');
  });

  it('parses an all-day item', () => {
    const parsed = CalendarItemOut.parse({
      ...baseItem(),
      allDayStartDate: '2026-06-30',
      allDayEndDate: '2026-07-01',
    });
    expect(parsed.allDayStartDate).toBe('2026-06-30');
  });

  it('rejects an item with neither timed nor all-day bounds', () => {
    const result = CalendarItemOut.safeParse(baseItem());
    expect(result.success).toBe(false);
  });

  it('round-trips a linked task summary', () => {
    const parsed = CalendarItemOut.parse({
      ...baseItem(),
      startsAt: '2026-06-30T16:00:00.000Z',
      endsAt: '2026-06-30T17:00:00.000Z',
      linkedTasks: [
        {
          taskId: TASK_ID,
          organizationId: ORG_ID,
          role: 'agenda',
          sort: 0,
          note: null,
          title: 'Prep slides',
          state: 'in_progress',
          done: false,
        },
      ],
    });
    expect(parsed.linkedTasks).toHaveLength(1);
    const [linkedTask] = parsed.linkedTasks;
    expect(linkedTask).toBeDefined();
    const parsedTask: CalendarItemLinkedTaskOut = linkedTask!;
    expect(parsedTask.role).toBe('agenda');
    expect(parsedTask.done).toBe(false);
  });
});

describe('CalendarRangeQuery', () => {
  it('parses a valid range with optional filters', () => {
    const parsed = CalendarRangeQuery.parse({
      start: '2026-06-30T00:00:00.000Z',
      end: '2026-07-01T00:00:00.000Z',
      layerIds: [LAYER_ID],
      kinds: ['provider_event'],
    });
    expect(parsed.layerIds).toEqual([LAYER_ID]);
  });

  it('parses a valid range with no optional filters', () => {
    const parsed = CalendarRangeQuery.parse({
      start: '2026-06-30T00:00:00.000Z',
      end: '2026-07-01T00:00:00.000Z',
    });
    expect(parsed.kinds).toBeUndefined();
  });

  it('rejects end <= start', () => {
    expect(
      CalendarRangeQuery.safeParse({
        start: '2026-07-01T00:00:00.000Z',
        end: '2026-06-30T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      CalendarRangeQuery.safeParse({
        start: '2026-06-30T00:00:00.000Z',
        end: '2026-06-30T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('CalendarItemCreate', () => {
  const base = { kind: 'native_block' as const, title: 'Focus block' };

  it('accepts complete timed bounds', () => {
    const parsed = CalendarItemCreate.parse({
      ...base,
      startsAt: '2026-06-30T16:00:00.000Z',
      endsAt: '2026-06-30T17:00:00.000Z',
    });
    expect(parsed.startsAt).toBe('2026-06-30T16:00:00.000Z');
  });

  it('accepts complete all-day bounds', () => {
    const parsed = CalendarItemCreate.parse({
      ...base,
      allDayStartDate: '2026-06-30',
      allDayEndDate: '2026-07-01',
    });
    expect(parsed.allDayStartDate).toBe('2026-06-30');
  });

  it('rejects neither timed nor all-day bounds', () => {
    expect(CalendarItemCreate.safeParse(base).success).toBe(false);
  });

  it('rejects an incomplete timed pair (only startsAt)', () => {
    expect(
      CalendarItemCreate.safeParse({ ...base, startsAt: '2026-06-30T16:00:00.000Z' }).success,
    ).toBe(false);
  });

  it('rejects an empty title', () => {
    expect(
      CalendarItemCreate.safeParse({
        ...base,
        title: '',
        startsAt: '2026-06-30T16:00:00.000Z',
        endsAt: '2026-06-30T17:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('CalendarItemUpdate', () => {
  it('accepts a single-field patch', () => {
    const parsed = CalendarItemUpdate.parse({ title: 'New title' });
    expect(parsed.title).toBe('New title');
  });

  it('accepts an empty string to clear a clearable field', () => {
    const parsed = CalendarItemUpdate.parse({ description: '' });
    expect(parsed.description).toBe('');
  });

  it('rejects an empty patch (no fields present)', () => {
    expect(CalendarItemUpdate.safeParse({}).success).toBe(false);
  });

  it('never combines .nullable() with .optional() (description accepts undefined, not null)', () => {
    expect(CalendarItemUpdate.safeParse({ description: null }).success).toBe(false);
  });
});

describe('CalendarItemTaskLinkCreate', () => {
  it('parses the "link" mode (existing task)', () => {
    const parsed = CalendarItemTaskLinkCreate.parse({
      mode: 'link',
      organizationId: ORG_ID,
      taskId: TASK_ID,
      role: 'prep',
    });
    if (parsed.mode !== 'link') throw new Error('expected link mode');
    expect(parsed.taskId).toBe(TASK_ID);
  });

  it('parses the "create" mode (new task)', () => {
    const parsed = CalendarItemTaskLinkCreate.parse({
      mode: 'create',
      organizationId: ORG_ID,
      title: 'Follow up',
    });
    if (parsed.mode !== 'create') throw new Error('expected create mode');
    expect(parsed.title).toBe('Follow up');
  });

  it('rejects an unknown mode', () => {
    expect(
      CalendarItemTaskLinkCreate.safeParse({ mode: 'delete', organizationId: ORG_ID }).success,
    ).toBe(false);
  });
});

describe('CalendarItemTaskLinkResultOut', () => {
  it('parses a link + task pair', () => {
    const parsed = CalendarItemTaskLinkResultOut.parse({
      link: {
        calendarItemId: ITEM_ID,
        taskId: TASK_ID,
        organizationId: ORG_ID,
        role: 'related',
        sort: 0,
        note: null,
        createdBy: '01BX5ZZKBKACTAV9WEVGEMMVS3',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      task: {
        id: TASK_ID,
        organizationId: ORG_ID,
        title: 'Follow up',
        teamId: '01BX5ZZKBKACTAV9WEVGEMMVS4',
        state: 'backlog',
        priority: 'none',
        provenance: {
          source: 'native',
          sourceIntegrationId: null,
          externalId: null,
          externalUrl: null,
          syncMode: null,
        },
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    });
    expect(parsed.link.taskId).toBe(TASK_ID);
    expect(parsed.task.title).toBe('Follow up');
  });
});
