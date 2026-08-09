import { describe, expect, it } from 'vitest';

import { defaultAvailabilityWindows } from '../../../src/services/scheduling/availability';
import type { DayBlock } from '../../../src/services/scheduling/day-loop';
import {
  MIN_CHECK_INS_PER_DAY,
  REORGANIZE_COOLDOWN_MINUTES,
  assessDrift,
  buildCheckInSchedule,
  computeDirectivePosture,
  dayBounds,
  dayEndGate,
  dayStartGate,
  reorganizeDay,
} from '../../../src/services/scheduling/day-loop';
import { instantAt } from '../../../src/services/scheduling/zoned-time';

const TZ = 'America/Los_Angeles';
/** A Tuesday. */
const DATE = '2026-09-08';

function at(minuteOfDay: number): number {
  return instantAt(DATE, minuteOfDay, TZ).getTime();
}

let n = 0;
function block(over: Partial<DayBlock> = {}): DayBlock {
  n += 1;
  return {
    calendarItemId: `ITEM${String(n)}`,
    taskId: null,
    organizationId: null,
    title: `Block ${String(n)}`,
    shape: 'deep_writing',
    start: at(9 * 60),
    end: at(11 * 60),
    done: false,
    schedulerOwned: true,
    ...over,
  };
}

describe('computeDirectivePosture', () => {
  it('reports on_track when nothing has slipped', () => {
    const result = computeDirectivePosture({
      blocks: [block({ start: at(13 * 60), end: at(15 * 60) })],
      now: new Date(at(9 * 60)),
      timezone: TZ,
    });
    expect(result.posture).toBe('on_track');
    expect(result.recommended).toBeNull();
    expect(result.driftMinutes).toBe(0);
  });

  it('reports attention_needed for a single modest overrun and names the block', () => {
    const late = block({ title: 'Draft the transit brief', start: at(9 * 60), end: at(10 * 60) });
    const result = computeDirectivePosture({
      blocks: [late],
      now: new Date(at(10 * 60 + 20)),
      timezone: TZ,
    });
    expect(result.posture).toBe('attention_needed');
    expect(result.driftMinutes).toBe(20);
    expect(result.reason).toContain('Draft the transit brief');
    expect(result.reason).toContain('20');
  });

  it('reports attention_needed when the current block is about to end', () => {
    const current = block({ start: at(9 * 60), end: at(11 * 60) });
    const result = computeDirectivePosture({
      blocks: [current],
      now: new Date(at(10 * 60 + 50)),
      timezone: TZ,
    });
    expect(result.posture).toBe('attention_needed');
    expect(result.recommended?.calendarItemId).toBe(current.calendarItemId);
  });

  it('escalates to intervention_recommended past a 30-minute overrun, naming the block to narrow to', () => {
    const late = block({ title: 'Shoot B-roll', start: at(9 * 60), end: at(10 * 60) });
    const result = computeDirectivePosture({
      blocks: [late],
      now: new Date(at(10 * 60 + 45)),
      timezone: TZ,
    });
    expect(result.posture).toBe('intervention_recommended');
    expect(result.driftMinutes).toBe(45);
    expect(result.recommended?.calendarItemId).toBe(late.calendarItemId);
  });

  it('escalates on two overruns even when neither is badly late', () => {
    const result = computeDirectivePosture({
      blocks: [
        block({ start: at(9 * 60), end: at(10 * 60) }),
        block({ start: at(10 * 60), end: at(10 * 60 + 30) }),
      ],
      now: new Date(at(10 * 60 + 40)),
      timezone: TZ,
    });
    expect(result.posture).toBe('intervention_recommended');
  });

  it('ignores blocks the person already finished', () => {
    const result = computeDirectivePosture({
      blocks: [block({ start: at(9 * 60), end: at(10 * 60), done: true })],
      now: new Date(at(12 * 60)),
      timezone: TZ,
    });
    expect(result.posture).toBe('on_track');
    expect(result.reason).toContain('done');
  });

  it('keeps its reason inside the 280-character schema limit', () => {
    const long = 'x'.repeat(400);
    const result = computeDirectivePosture({
      blocks: [block({ title: long, start: at(9 * 60), end: at(10 * 60) })],
      now: new Date(at(10 * 60 + 20)),
      timezone: TZ,
    });
    expect(result.reason.length).toBeLessThanOrEqual(280);
  });
});

describe('buildCheckInSchedule', () => {
  const bounds = dayBounds({ date: DATE, timezone: TZ, windows: defaultAvailabilityWindows() });

  it('issues at least three check-ins in a work day, in order, inside the day', () => {
    const schedule = buildCheckInSchedule({
      blocks: [
        block({ start: at(9 * 60), end: at(11 * 60) }),
        block({ start: at(13 * 60), end: at(15 * 60) }),
      ],
      dayStart: bounds.start,
      dayEnd: bounds.end,
    });
    expect(schedule.length).toBeGreaterThanOrEqual(MIN_CHECK_INS_PER_DAY);
    for (let i = 1; i < schedule.length; i += 1) {
      expect(schedule[i]?.scheduledAt ?? 0).toBeGreaterThan(schedule[i - 1]?.scheduledAt ?? 0);
    }
    for (const entry of schedule) {
      expect(entry.scheduledAt).toBeGreaterThan(bounds.start.getTime());
      expect(entry.scheduledAt).toBeLessThan(bounds.end.getTime());
    }
  });

  it('still issues the floor of check-ins on a day with no blocks at all', () => {
    const schedule = buildCheckInSchedule({
      blocks: [],
      dayStart: bounds.start,
      dayEnd: bounds.end,
    });
    expect(schedule.length).toBeGreaterThanOrEqual(MIN_CHECK_INS_PER_DAY);
  });

  it('anchors a check-in to the end of each block and names the block it is about', () => {
    const first = block({ title: 'Write the funding memo', start: at(9 * 60), end: at(11 * 60) });
    const schedule = buildCheckInSchedule({
      blocks: [first],
      dayStart: bounds.start,
      dayEnd: bounds.end,
    });
    const anchored = schedule.find((c) => c.scheduledAt === first.end);
    expect(anchored).toBeDefined();
    expect(anchored?.blockTitle).toBe('Write the funding memo');
    expect(anchored?.blockCalendarItemId).toBe(first.calendarItemId);
  });

  it('counts the goals still outstanding at each check-in', () => {
    const schedule = buildCheckInSchedule({
      blocks: [
        block({ start: at(9 * 60), end: at(11 * 60) }),
        block({ start: at(13 * 60), end: at(15 * 60) }),
        block({ start: at(15 * 60), end: at(17 * 60) }),
      ],
      dayStart: bounds.start,
      dayEnd: bounds.end,
    });
    const first = schedule[0];
    const last = schedule[schedule.length - 1];
    expect(first?.outstandingGoals ?? 0).toBeGreaterThanOrEqual(last?.outstandingGoals ?? 0);
  });

  it('caps a heavily-blocked day rather than becoming a day of interruptions', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      block({ start: at(8 * 60 + i * 30), end: at(8 * 60 + (i + 1) * 30) }),
    );
    const schedule = buildCheckInSchedule({
      blocks: many,
      dayStart: bounds.start,
      dayEnd: bounds.end,
    });
    expect(schedule.length).toBeLessThanOrEqual(8);
  });
});

describe('reorganizeDay', () => {
  const windows = defaultAvailabilityWindows();

  it('shifts the not-yet-started blocks when a block overruns by 45 minutes', () => {
    // Afternoon desk runs 13:00–17:00. The 13:00 block runs 45 minutes long, so the 15:00 block
    // can no longer start where it was planned.
    const overrunning = block({ title: 'Morning writing', start: at(13 * 60), end: at(15 * 60) });
    const later = block({ title: 'Afternoon architecture', start: at(15 * 60), end: at(16 * 60) });
    const now = new Date(at(15 * 60 + 45));

    const result = reorganizeDay({
      blocks: [overrunning, later],
      now,
      date: DATE,
      timezone: TZ,
      windows,
      externalBusy: [],
    });

    expect(result.driftMinutes).toBe(45);
    const moved = result.moves.find((m) => m.calendarItemId === later.calendarItemId);
    expect(moved, 'the displaced afternoon block should have been re-placed').toBeDefined();
    expect(moved?.toStart).toBeGreaterThanOrEqual(now.getTime());
    expect(moved?.minutesShifted).toBe(45);
    // Its duration is preserved: re-cutting the day never silently shortens work.
    expect((moved?.toEnd ?? 0) - (moved?.toStart ?? 0)).toBe(60 * 60_000);
    // And the overrunning block itself is left exactly where it is.
    expect(result.moves.map((m) => m.calendarItemId)).not.toContain(overrunning.calendarItemId);
  });

  it('never moves a block a person put there by hand', () => {
    const overrunning = block({ start: at(9 * 60), end: at(10 * 60) });
    const handPlaced = block({
      title: 'Dentist',
      start: at(14 * 60),
      end: at(15 * 60),
      schedulerOwned: false,
    });
    const result = reorganizeDay({
      blocks: [overrunning, handPlaced],
      now: new Date(at(10 * 60 + 45)),
      date: DATE,
      timezone: TZ,
      windows,
      externalBusy: [],
    });
    expect(result.moves.map((m) => m.calendarItemId)).not.toContain(handPlaced.calendarItemId);
    expect(result.displaced.map((d) => d.calendarItemId)).not.toContain(handPlaced.calendarItemId);
  });

  it('never moves a block that is already in progress', () => {
    const inProgress = block({ start: at(10 * 60), end: at(12 * 60) });
    const result = reorganizeDay({
      blocks: [inProgress],
      now: new Date(at(11 * 60)),
      date: DATE,
      timezone: TZ,
      windows,
      externalBusy: [],
    });
    expect(result.moves).toEqual([]);
  });

  it('reports a block the shortened day can no longer hold instead of quietly dropping it', () => {
    // Six two-hour blocks cannot fit in the ~2h of desk time left after 15:00.
    const blocks = Array.from({ length: 6 }, (_, i) =>
      block({ start: at(15 * 60 + i), end: at(17 * 60 + i), title: `Late block ${String(i)}` }),
    );
    const result = reorganizeDay({
      blocks,
      now: new Date(at(14 * 60 + 59)),
      date: DATE,
      timezone: TZ,
      windows,
      externalBusy: [],
    });
    expect(result.displaced.length).toBeGreaterThan(0);
  });

  it('does nothing at all on a day that has not drifted and has nothing to move', () => {
    const result = reorganizeDay({
      blocks: [block({ start: at(9 * 60), end: at(11 * 60), done: true })],
      now: new Date(at(11 * 60)),
      date: DATE,
      timezone: TZ,
      windows,
      externalBusy: [],
    });
    expect(result).toEqual({ moves: [], displaced: [], driftMinutes: 0 });
  });

  it('keeps a shoot out of desk hours when re-cutting', () => {
    const shoot = block({
      title: 'Filming',
      shape: 'filming_session',
      start: at(18 * 60),
      end: at(20 * 60),
    });
    const result = reorganizeDay({
      blocks: [shoot],
      now: new Date(at(12 * 60)),
      date: DATE,
      timezone: TZ,
      windows,
      externalBusy: [],
    });
    // The evening field window is where it already is, so nothing should pull it into the
    // afternoon desk block that is sitting empty.
    expect(result.moves).toEqual([]);
  });
});

describe('gates', () => {
  it('holds the start of the day until the agenda has been through', () => {
    const holding = dayStartGate({ agendaReady: true, acknowledgedAt: null });
    expect(holding.state).toBe('holding');
    expect(holding.outstandingSteps).toEqual(['agenda_reviewed']);
    expect(holding.releasedAt).toBeNull();

    const at = new Date('2026-09-08T15:00:00Z');
    const open = dayStartGate({ agendaReady: true, acknowledgedAt: at });
    expect(open.state).toBe('open');
    expect(open.outstandingSteps).toEqual([]);
    expect(open.releasedAt).toBe(at.toISOString());
  });

  it('holds the end of the day while any of the three review steps is outstanding', () => {
    expect(
      dayEndGate({
        reconciled: false,
        reflected: false,
        tomorrowConfirmed: false,
        completedAt: null,
      }).outstandingSteps,
    ).toEqual(['day_reconciled', 'day_reflected', 'tomorrow_confirmed']);

    expect(
      dayEndGate({
        reconciled: true,
        reflected: false,
        tomorrowConfirmed: false,
        completedAt: null,
      }).outstandingSteps,
    ).toEqual(['day_reflected', 'tomorrow_confirmed']);

    expect(
      dayEndGate({ reconciled: true, reflected: true, tomorrowConfirmed: false, completedAt: null })
        .outstandingSteps,
    ).toEqual(['tomorrow_confirmed']);

    const released = dayEndGate({
      reconciled: true,
      reflected: true,
      tomorrowConfirmed: true,
      completedAt: new Date('2026-09-08T23:00:00Z'),
    });
    expect(released.state).toBe('open');
    expect(released.releasedAt).toBe('2026-09-08T23:00:00.000Z');
  });

  it('states conditions, never enforcement — no gate carries a mechanism', () => {
    const gate = dayEndGate({
      reconciled: false,
      reflected: false,
      tomorrowConfirmed: false,
      completedAt: null,
    });
    const serialized = JSON.stringify(gate).toLowerCase();
    for (const forbidden of ['lock', 'block ', 'quit', 'kill', 'shutdown', 'overlay', 'app']) {
      expect(serialized, `gate leaked an enforcement word: ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('assessDrift — whether a day gets re-cut, and how often', () => {
  const NOW = new Date(at(15 * 60));

  /** One answered check-in, at a wall-clock minute of the same day. */
  function answered(
    response: 'behind' | 'switched' | 'on_track' | 'done',
    minuteOfDay: number,
  ): { response: 'behind' | 'switched' | 'on_track' | 'done'; respondedAt: Date } {
    return { response, respondedAt: new Date(at(minuteOfDay)) };
  }

  it('says nothing about a day that is on track and has admitted nothing', () => {
    expect(
      assessDrift({
        posture: 'on_track',
        checkIns: [answered('on_track', 14 * 60), { response: null, respondedAt: null }],
        lastReorganizedAt: null,
        now: NOW,
      }),
    ).toEqual({ trigger: null, shouldReorganize: false, cooledDown: false });
  });

  it('does not act on attention_needed — one late block is a slip, not a day to re-cut', () => {
    expect(
      assessDrift({ posture: 'attention_needed', checkIns: [], lastReorganizedAt: null, now: NOW }),
    ).toMatchObject({ trigger: null, shouldReorganize: false });
  });

  it('acts on the clock once the posture reaches intervention_recommended', () => {
    expect(
      assessDrift({
        posture: 'intervention_recommended',
        checkIns: [],
        lastReorganizedAt: null,
        now: NOW,
      }),
    ).toEqual({ trigger: 'posture', shouldReorganize: true, cooledDown: false });
  });

  it('holds the clock signal off inside the cooldown, so a five-minute tick is not a five-minute re-cut', () => {
    const justRecut = new Date(NOW.getTime() - (REORGANIZE_COOLDOWN_MINUTES - 5) * 60_000);
    expect(
      assessDrift({
        posture: 'intervention_recommended',
        checkIns: [],
        lastReorganizedAt: justRecut,
        now: NOW,
      }),
    ).toEqual({ trigger: 'posture', shouldReorganize: false, cooledDown: true });
  });

  it('acts again once the cooldown has elapsed', () => {
    const old = new Date(NOW.getTime() - (REORGANIZE_COOLDOWN_MINUTES + 1) * 60_000);
    expect(
      assessDrift({
        posture: 'intervention_recommended',
        checkIns: [],
        lastReorganizedAt: old,
        now: NOW,
      }),
    ).toMatchObject({ shouldReorganize: true, cooledDown: false });
  });

  it('believes the person over the clock: "behind" re-cuts a day the posture calls healthy', () => {
    expect(
      assessDrift({
        posture: 'on_track',
        checkIns: [answered('behind', 14 * 60 + 30)],
        lastReorganizedAt: null,
        now: NOW,
      }),
    ).toEqual({ trigger: 'check_in', shouldReorganize: true, cooledDown: false });
  });

  it('treats "switched" as drift too, and "done" as nothing at all', () => {
    const base = { posture: 'on_track', lastReorganizedAt: null, now: NOW } as const;
    expect(assessDrift({ ...base, checkIns: [answered('switched', 14 * 60)] })).toMatchObject({
      trigger: 'check_in',
    });
    expect(assessDrift({ ...base, checkIns: [answered('done', 14 * 60)] })).toMatchObject({
      trigger: null,
    });
  });

  it('never suppresses an admission made since the last re-cut — that re-cut could not have had it', () => {
    expect(
      assessDrift({
        posture: 'on_track',
        checkIns: [answered('behind', 14 * 60 + 58)],
        lastReorganizedAt: new Date(at(14 * 60 + 55)),
        now: NOW,
      }),
    ).toEqual({ trigger: 'check_in', shouldReorganize: true, cooledDown: false });
  });

  it('does not re-honour an admission the last re-cut already answered', () => {
    expect(
      assessDrift({
        posture: 'on_track',
        checkIns: [answered('behind', 14 * 60 + 30)],
        lastReorganizedAt: new Date(at(14 * 60 + 40)),
        now: NOW,
      }),
    ).toMatchObject({ trigger: null, shouldReorganize: false });
  });

  it('is deterministic: the same inputs give the same verdict, every time', () => {
    const input = {
      posture: 'intervention_recommended',
      checkIns: [answered('on_track', 13 * 60), answered('behind', 14 * 60 + 50)],
      lastReorganizedAt: new Date(at(14 * 60)),
      now: NOW,
    } as const;
    const runs = Array.from({ length: 25 }, () => assessDrift(input));
    for (const run of runs) expect(run).toEqual(runs[0]);
  });
});
