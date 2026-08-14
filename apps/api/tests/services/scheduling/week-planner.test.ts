import type { AvailabilityWindow, SchedulingCommitment, WorkShape } from '@docket/types';
import { WORK_SHAPES, workShapeProfile } from '@docket/types';
import { describe, expect, it } from 'vitest';

import type { BusyItem } from '../../../src/services/scheduling/availability';
import { defaultAvailabilityWindows } from '../../../src/services/scheduling/availability';
import { EMPTY_ACTUALS } from '../../../src/services/scheduling/duration-model';
import type { PlanWeekInput, PlannedBlock } from '../../../src/services/scheduling/week-planner';
import { planWeek, shapesPresent } from '../../../src/services/scheduling/week-planner';
import { addDays, instantAt, localDateString } from '../../../src/services/scheduling/zoned-time';
import { assertDefined } from '@docket/test-utils';

const TZ = 'America/Los_Angeles';
/** A Monday. */
const WEEK = '2026-08-03';

let counter = 0;
/** A 26-char ULID-shaped id; the planner only needs uniqueness. */
function id(prefix: string): string {
  counter += 1;
  return `${prefix.toUpperCase()}${String(counter).padStart(26 - prefix.length, '0')}`.slice(0, 26);
}

function commitment(
  over: Partial<SchedulingCommitment> & { shape: WorkShape },
): SchedulingCommitment {
  return {
    id: id('C'),
    title: `${over.shape} work`,
    organizationId: null,
    taskId: null,
    sessionsPerWeek: 1,
    minutesPerSession: null,
    location: null,
    attendees: [],
    active: true,
    ...over,
  };
}

/** The full six-shape commitment set the author named, with their real preconditions met. */
function sixShapeCommitments(): SchedulingCommitment[] {
  return [
    commitment({
      shape: 'filming_session',
      title: 'LVBT filming session',
      location: 'Downtown Las Vegas transit center',
      sessionsPerWeek: 1,
    }),
    commitment({
      shape: 'community_meeting',
      title: 'LVBT community member meeting',
      attendees: ['rider@example.org', 'organizer@example.org'],
      sessionsPerWeek: 2,
    }),
    commitment({ shape: 'deep_writing', title: 'Write and plan longer-term', sessionsPerWeek: 2 }),
    commitment({ shape: 'interstitial_reading', title: 'Reading', sessionsPerWeek: 2 }),
    commitment({
      shape: 'architecture_brainstorm',
      title: 'Brainstorm service architecture',
      sessionsPerWeek: 1,
    }),
  ];
}

function baseInput(over: Partial<PlanWeekInput> = {}): PlanWeekInput {
  return {
    weekStartDate: WEEK,
    timezone: TZ,
    windows: defaultAvailabilityWindows(),
    commitments: sixShapeCommitments(),
    busy: [],
    actuals: EMPTY_ACTUALS,
    reflectionForMeetings: true,
    backfillShapes: ['deep_writing', 'architecture_brainstorm', 'interstitial_reading'],
    maxUnplannedGapMinutes: 60,
    minTransitGapMinutes: 15,
    maxTransitGapMinutes: 120,
    ...over,
  };
}

/** Two located commitments with a bus ride between them. */
function locatedPair(date: string): BusyItem[] {
  return [
    {
      id: id('B'),
      title: 'Site visit',
      start: instantAt(date, 9 * 60, TZ).getTime(),
      end: instantAt(date, 10 * 60, TZ).getTime(),
      location: 'Bonneville Transit Center',
      attendees: [],
      workShape: null,
      schedulerOwned: false,
    },
    {
      id: id('B'),
      title: 'Council briefing',
      start: instantAt(date, 11 * 60, TZ).getTime(),
      end: instantAt(date, 12 * 60, TZ).getTime(),
      location: 'Clark County Government Center',
      attendees: [],
      workShape: null,
      schedulerOwned: false,
    },
  ];
}

function minutesOf(block: PlannedBlock): number {
  return Math.round((block.end - block.start) / 60_000);
}

describe('planWeek — the six named work types in one run', () => {
  it('places at least one block of every one of the six shapes from a single run', () => {
    const busy = locatedPair(addDays(WEEK, 1));
    const result = planWeek(baseInput({ busy }));

    expect(shapesPresent(result.blocks)).toEqual([...WORK_SHAPES]);
    for (const shape of WORK_SHAPES) {
      expect(result.blocks.filter((b) => b.shape === shape).length).toBeGreaterThan(0);
    }
  });

  it('spans a full seven-day week and never places a block outside it', () => {
    const result = planWeek(baseInput({ busy: locatedPair(addDays(WEEK, 1)) }));
    const weekDays = new Set(Array.from({ length: 7 }, (_, i) => addDays(WEEK, i)));
    for (const block of result.blocks) {
      expect(weekDays.has(localDateString(new Date(block.start), TZ))).toBe(true);
    }
  });

  it('never double-books: no two placed blocks overlap', () => {
    const result = planWeek(baseInput({ busy: locatedPair(addDays(WEEK, 1)) }));
    const sorted = [...result.blocks].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (prev === undefined || cur === undefined) continue;
      expect(cur.start).toBeGreaterThanOrEqual(prev.end);
    }
  });
});

describe('planWeek — each shape carries its own constraints', () => {
  it('gives a filming session a shoot-length contiguous block with its location, not a default slot', () => {
    const result = planWeek(baseInput());
    const filming = result.blocks.filter((b) => b.shape === 'filming_session');
    expect(filming.length).toBeGreaterThan(0);
    for (const block of filming) {
      expect(minutesOf(block)).toBeGreaterThanOrEqual(90);
      expect(minutesOf(block)).not.toBe(30);
      expect(block.location).toBe('Downtown Las Vegas transit center');
    }
  });

  it('attaches community-member attendees to meeting blocks', () => {
    const result = planWeek(baseInput());
    const meetings = result.blocks.filter((b) => b.shape === 'community_meeting');
    expect(meetings.length).toBeGreaterThan(0);
    for (const block of meetings) {
      expect(block.attendees).toEqual(['rider@example.org', 'organizer@example.org']);
    }
  });

  it('keeps writing contiguous and at least an hour, never fragmented across the day', () => {
    const result = planWeek(baseInput());
    const writing = result.blocks.filter(
      (b) => b.shape === 'deep_writing' && b.commitmentId !== null,
    );
    expect(writing.length).toBeGreaterThan(0);
    for (const block of writing) {
      expect(minutesOf(block)).toBeGreaterThanOrEqual(60);
    }
  });

  it('refuses to schedule a filming session with no location, and says why', () => {
    const result = planWeek(
      baseInput({
        commitments: [commitment({ shape: 'filming_session', location: null, sessionsPerWeek: 1 })],
      }),
    );
    expect(result.blocks.filter((b) => b.shape === 'filming_session')).toHaveLength(0);
    expect(result.unplaced.map((u) => u.reason)).toContain('missing_location');
  });

  it('refuses to schedule a community meeting with nobody in it, and says why', () => {
    const result = planWeek(
      baseInput({
        commitments: [
          commitment({ shape: 'community_meeting', attendees: [], sessionsPerWeek: 1 }),
        ],
      }),
    );
    expect(result.blocks.filter((b) => b.shape === 'community_meeting')).toHaveLength(0);
    expect(result.unplaced.map((u) => u.reason)).toContain('missing_attendees');
  });
});

describe('planWeek — reading is interstitial, not a desk block', () => {
  it('places reading inside the travel gap between two located events', () => {
    const tuesday = addDays(WEEK, 1);
    const busy = locatedPair(tuesday);
    const result = planWeek(baseInput({ busy }));

    const reading = result.blocks.filter((b) => b.shape === 'interstitial_reading');
    expect(reading.length).toBeGreaterThan(0);
    const gapStart = busy[0]?.end ?? 0;
    const gapEnd = busy[1]?.start ?? 0;
    const inGap = reading.filter((b) => b.start >= gapStart && b.end <= gapEnd);
    expect(inGap.length).toBeGreaterThan(0);
  });

  it('places no reading at all when the week contains no travel, rather than inventing desk time', () => {
    const result = planWeek(
      baseInput({
        busy: [],
        windows: defaultAvailabilityWindows().filter((w) => w.kind !== 'transit'),
        backfillShapes: ['deep_writing', 'architecture_brainstorm'],
        commitments: [commitment({ shape: 'interstitial_reading', sessionsPerWeek: 3 })],
      }),
    );
    expect(result.blocks.filter((b) => b.shape === 'interstitial_reading')).toHaveLength(0);
    expect(result.unplaced.map((u) => u.reason)).toContain('no_matching_window');
  });

  it('does not treat a gap between two events at the same location as travel', () => {
    const tuesday = addDays(WEEK, 1);
    const pair = locatedPair(tuesday).map((b) => ({ ...b, location: 'Same building' }));
    const result = planWeek(
      baseInput({
        busy: pair,
        windows: defaultAvailabilityWindows().filter((w) => w.kind !== 'transit'),
        backfillShapes: ['deep_writing', 'architecture_brainstorm'],
        commitments: [commitment({ shape: 'interstitial_reading', sessionsPerWeek: 1 })],
      }),
    );
    expect(result.blocks.filter((b) => b.shape === 'interstitial_reading')).toHaveLength(0);
  });
});

describe('planWeek — reflection is anchored to what it reflects on', () => {
  it('places a debrief after every meeting-shaped block, on the same day, linked to it', () => {
    const result = planWeek(baseInput());
    const anchors = result.blocks.filter(
      (b) => b.shape === 'filming_session' || b.shape === 'community_meeting',
    );
    expect(anchors.length).toBeGreaterThan(0);

    for (const anchor of anchors) {
      const debrief = result.blocks.find(
        (b) => b.shape === 'reflection_debrief' && b.anchorKey === anchor.key,
      );
      expect(debrief, `no debrief linked to ${anchor.title}`).toBeDefined();
      expect(debrief?.date).toBe(anchor.date);
      expect(debrief?.start ?? 0).toBeGreaterThanOrEqual(anchor.end);
    }
  });

  it('debriefs a pre-existing calendar event that has attendees, linking to that event', () => {
    const tuesday = addDays(WEEK, 1);
    const existing: BusyItem = {
      id: 'EXISTING-EVENT-ID',
      title: 'Coalition sync',
      start: instantAt(tuesday, 10 * 60, TZ).getTime(),
      end: instantAt(tuesday, 11 * 60, TZ).getTime(),
      location: 'City Hall',
      attendees: ['someone@example.org'],
      workShape: null,
      schedulerOwned: false,
    };
    const result = planWeek(baseInput({ busy: [existing], commitments: [] }));
    const debrief = result.blocks.find(
      (b) => b.shape === 'reflection_debrief' && b.anchorCalendarItemId === 'EXISTING-EVENT-ID',
    );
    expect(debrief).toBeDefined();
    expect(debrief?.title).toBe('Debrief: Coalition sync');
  });

  it('places no debriefs when the person turns them off', () => {
    const result = planWeek(baseInput({ reflectionForMeetings: false }));
    expect(result.blocks.filter((b) => b.shape === 'reflection_debrief')).toHaveLength(0);
  });
});

describe('planWeek — protected time is never scheduled into', () => {
  const personalWindows: AvailabilityWindow[] = defaultAvailabilityWindows().filter(
    (w) => w.kind === 'personal',
  );

  it('places zero work blocks inside declared personal windows across ten generated weeks', () => {
    const violations: string[] = [];
    for (let week = 0; week < 10; week += 1) {
      const weekStart = addDays(WEEK, week * 7);
      const busy = locatedPair(addDays(weekStart, 1));
      const result = planWeek(baseInput({ weekStartDate: weekStart, busy }));
      expect(result.blocks.length).toBeGreaterThan(0);

      for (const block of result.blocks) {
        for (const day of Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))) {
          for (const window of personalWindows) {
            const dayWeekday = new Date(`${day}T00:00:00Z`).getUTCDay();
            if (dayWeekday !== window.weekday) continue;
            const start = instantAt(day, window.startMinute, TZ).getTime();
            const end = instantAt(day, window.endMinute, TZ).getTime();
            if (block.start < end && start < block.end) {
              violations.push(`${String(week)}:${block.title}@${block.date}`);
            }
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('reports the protected minutes it deliberately left alone', () => {
    const result = planWeek(baseInput());
    expect(result.protectedMinutes).toBeGreaterThan(0);
  });

  it('does not turn a travel gap that lands in protected time into reading time', () => {
    const tuesday = addDays(WEEK, 1);
    // Two located events straddling the protected 12:00–13:00 lunch.
    const busy: BusyItem[] = [
      {
        id: id('B'),
        title: 'Morning shoot',
        start: instantAt(tuesday, 11 * 60, TZ).getTime(),
        end: instantAt(tuesday, 12 * 60, TZ).getTime(),
        location: 'A',
        attendees: [],
        workShape: null,
        schedulerOwned: false,
      },
      {
        id: id('B'),
        title: 'Afternoon meeting',
        start: instantAt(tuesday, 13 * 60, TZ).getTime(),
        end: instantAt(tuesday, 14 * 60, TZ).getTime(),
        location: 'B',
        attendees: [],
        workShape: null,
        schedulerOwned: false,
      },
    ];
    const result = planWeek(
      baseInput({
        busy,
        windows: defaultAvailabilityWindows().filter((w) => w.kind !== 'transit'),
        backfillShapes: [],
        reflectionForMeetings: false,
        commitments: [commitment({ shape: 'interstitial_reading', sessionsPerWeek: 1 })],
      }),
    );
    const lunchStart = instantAt(tuesday, 12 * 60, TZ).getTime();
    const lunchEnd = instantAt(tuesday, 13 * 60, TZ).getTime();
    for (const block of result.blocks) {
      expect(block.start < lunchEnd && lunchStart < block.end).toBe(false);
    }
  });
});

describe('planWeek — coverage', () => {
  it('leaves no unassigned gap larger than the configured threshold', () => {
    const result = planWeek(baseInput({ busy: locatedPair(addDays(WEEK, 1)) }));
    expect(result.largestGapMinutes).toBeLessThanOrEqual(60);
    expect(result.gaps).toEqual([]);
  });

  it('reports available versus scheduled minutes that add up', () => {
    const result = planWeek(baseInput({ busy: locatedPair(addDays(WEEK, 1)) }));
    expect(result.availableMinutes).toBeGreaterThan(0);
    expect(result.scheduledMinutes).toBeGreaterThan(0);
    expect(result.scheduledMinutes).toBeLessThanOrEqual(result.availableMinutes);
  });

  it('leaves the week honestly under-covered when backfill is switched off', () => {
    const withBackfill = planWeek(baseInput());
    const withoutBackfill = planWeek(baseInput({ backfillShapes: [] }));
    expect(withoutBackfill.scheduledMinutes).toBeLessThan(withBackfill.scheduledMinutes);
    expect(withoutBackfill.largestGapMinutes).toBeGreaterThan(60);
  });
});

describe('planWeek — duration comes from measured time, not guesses', () => {
  it('prefers a task’s own tracked median over the shape default', () => {
    const taskId = id('T');
    const result = planWeek(
      baseInput({
        commitments: [
          commitment({
            shape: 'deep_writing',
            taskId: taskId as SchedulingCommitment['taskId'],
            sessionsPerWeek: 1,
            minutesPerSession: null,
          }),
        ],
        reflectionForMeetings: false,
        backfillShapes: [],
        actuals: { byTaskId: new Map([[taskId, { minutes: [95, 100, 105] }]]), byShape: new Map() },
      }),
    );
    const writing = result.blocks.find((b) => b.shape === 'deep_writing');
    expect(writing).toBeDefined();
    expect(minutesOf(assertDefined(writing))).toBe(100);
    expect(writing?.durationSource).toBe('measured');
  });

  it('clamps a runaway tracked duration into the shape’s own bounds', () => {
    const taskId = id('T');
    const result = planWeek(
      baseInput({
        commitments: [
          commitment({
            shape: 'deep_writing',
            taskId: taskId as SchedulingCommitment['taskId'],
            sessionsPerWeek: 1,
          }),
        ],
        reflectionForMeetings: false,
        backfillShapes: [],
        actuals: {
          byTaskId: new Map([[taskId, { minutes: [900, 900, 900] }]]),
          byShape: new Map(),
        },
      }),
    );
    const writing = result.blocks.find((b) => b.shape === 'deep_writing');
    expect(minutesOf(assertDefined(writing))).toBe(workShapeProfile('deep_writing').maxMinutes);
  });

  it('falls back to the requested length, then to the shape default', () => {
    const requested = planWeek(
      baseInput({
        commitments: [
          commitment({ shape: 'deep_writing', sessionsPerWeek: 1, minutesPerSession: 75 }),
        ],
        reflectionForMeetings: false,
        backfillShapes: [],
      }),
    ).blocks.find((b) => b.shape === 'deep_writing');
    expect(minutesOf(assertDefined(requested))).toBe(75);
    expect(requested?.durationSource).toBe('requested');

    const defaulted = planWeek(
      baseInput({
        commitments: [commitment({ shape: 'deep_writing', sessionsPerWeek: 1 })],
        reflectionForMeetings: false,
        backfillShapes: [],
      }),
    ).blocks.find((b) => b.shape === 'deep_writing');
    expect(minutesOf(assertDefined(defaulted))).toBe(
      workShapeProfile('deep_writing').defaultMinutes,
    );
    expect(defaulted?.durationSource).toBe('shape_default');
  });
});

describe('planWeek — determinism and spreading', () => {
  it('is deterministic: the same inputs produce the same week', () => {
    const first = planWeek(baseInput({ busy: locatedPair(addDays(WEEK, 1)) }));
    const second = planWeek(baseInput({ busy: locatedPair(addDays(WEEK, 1)) }));
    expect(first.blocks.map((b) => `${b.shape}@${String(b.start)}`)).toEqual(
      second.blocks.map((b) => `${b.shape}@${String(b.start)}`),
    );
  });

  it('spreads repeated sessions of one commitment across different days', () => {
    const writing = commitment({ shape: 'deep_writing', sessionsPerWeek: 3 });
    const result = planWeek(
      baseInput({ commitments: [writing], reflectionForMeetings: false, backfillShapes: [] }),
    );
    const placed = result.blocks.filter((b) => b.commitmentId === writing.id);
    expect(placed).toHaveLength(3);
    expect(new Set(placed.map((b) => b.date)).size).toBe(3);
  });

  it('schedules around pre-existing commitments rather than on top of them', () => {
    const tuesday = addDays(WEEK, 1);
    const existing: BusyItem = {
      id: id('B'),
      title: 'Existing appointment',
      start: instantAt(tuesday, 9 * 60, TZ).getTime(),
      end: instantAt(tuesday, 12 * 60, TZ).getTime(),
      location: null,
      attendees: [],
      workShape: null,
      schedulerOwned: false,
    };
    const result = planWeek(baseInput({ busy: [existing] }));
    for (const block of result.blocks) {
      expect(block.start < existing.end && existing.start < block.end).toBe(false);
    }
  });
});
