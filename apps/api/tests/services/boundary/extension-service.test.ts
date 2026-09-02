/**
 * `@docket/api` — the Athena-to-boundary evening-extension loop.
 *
 * @remarks
 * Every assertion here lands on **persisted state** rather than on how many times a double was
 * called. A mock call count proves the code executed; the row proves the system is in the state
 * the policy claims it is in, which is the thing that actually has to survive a restart, a
 * concurrent sweep, and the next five-minute tick.
 *
 * The four policies under test are the point of the step: the ask is bounded at two hours, the
 * morning boundary is never written, a refusal leaves the plan alone, and one deadline produces
 * exactly one consent prompt however many times the sweep runs.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { assertDefined } from '@docket/test-utils';

import type * as DbModule from '@docket/db';

import { getDb, seedUserWithHub } from '../../support/routes-harness';

import {
  advanceEveningExtension,
  readExtensionRequests,
  REQUEST_EXPIRY_MINUTES,
} from '../../../src/services/boundary/extension-service';
import type {
  BoundaryExtensionRequest,
  BoundaryRequestOutcome,
  BoundaryRequestState,
  BoundarySubmission,
  DayBoundaryPort,
} from '../../../src/services/boundary/port';
import type { DayBlock } from '../../../src/services/scheduling/day-loop';
import { assessEveningShortfall } from '../../../src/services/scheduling/day-loop';
import type { DayContext } from '../../../src/services/scheduling/directive-service';
import { instantAt } from '@docket/planning/zoned-time';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

const TZ = 'UTC';
/** A Wednesday. The seeded windows cover every weekday, so the choice only has to be stable. */
const DATE = '2026-08-12';

/** The working window every seeded Hub gets: 09:00–17:00 local, every day. */
const DAY_START_MINUTE = 9 * 60;
const DAY_END_MINUTE = 17 * 60;

/** The one availability window the pure-function cases evaluate against. */
const WEEKDAY_WINDOW = {
  weekday: 3,
  startMinute: DAY_START_MINUTE,
  endMinute: DAY_END_MINUTE,
  kind: 'desk',
  label: null,
} as const;

function at(minuteOfDay: number): number {
  return instantAt(DATE, minuteOfDay, TZ).getTime();
}

/**
 * A boundary client under the test's control.
 *
 * @remarks
 * A real MCP client and this double satisfy the same two-method port, which is the whole reason
 * the port is two methods. It records what it was asked so a test *can* check the wire when the
 * wire is the subject, but every policy assertion below reads the database instead.
 */
class FakeBoundaryPort implements DayBoundaryPort {
  readonly submissions: BoundaryExtensionRequest[] = [];
  readonly polls: string[] = [];
  /** What the next poll answers. Mutated between passes to play out a conversation. */
  outcome: BoundaryRequestOutcome = { state: 'pending', detail: null };
  /** When set, submission fails the way an unreachable client does. */
  failSubmit = false;
  #next = 0;

  async submitExtensionRequest(request: BoundaryExtensionRequest): Promise<BoundarySubmission> {
    if (this.failSubmit) throw new Error('boundary client unreachable');
    this.submissions.push(request);
    this.#next += 1;
    return await Promise.resolve({ requestId: `req-${String(this.#next)}` });
  }

  async pollExtensionRequest(requestId: string): Promise<BoundaryRequestOutcome> {
    this.polls.push(requestId);
    return await Promise.resolve(this.outcome);
  }

  answer(state: BoundaryRequestState, detail: string | null = null): void {
    this.outcome = { state, detail };
  }
}

let blockCounter = 0;
function block(over: Partial<DayBlock> = {}): DayBlock {
  blockCounter += 1;
  return {
    calendarItemId: `BND-ITEM-${String(blockCounter)}`,
    taskId: null,
    organizationId: null,
    title: `Block ${String(blockCounter)}`,
    shape: 'deep_writing',
    start: at(DAY_START_MINUTE),
    end: at(DAY_START_MINUTE + 60),
    done: false,
    schedulerOwned: true,
    ...over,
  };
}

/** Seed a Hub whose working window is 09:00–17:00 on every weekday. */
async function seedHub(label: string): Promise<{ hubId: string; userId: string }> {
  const userId = await seedUserWithHub(db, schema, label);
  const [hubRow] = await db
    .select({ id: schema.hub.id })
    .from(schema.hub)
    .where(eq(schema.hub.userId, userId))
    .limit(1);
  if (!hubRow) throw new Error('seeded user has no hub');
  await db.insert(schema.schedulingPreference).values({
    hubId: hubRow.id,
    timezone: TZ,
    windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      startMinute: DAY_START_MINUTE,
      endMinute: DAY_END_MINUTE,
      kind: 'desk',
      label: null,
    })),
  });
  return { hubId: hubRow.id, userId };
}

function context(seed: { hubId: string; userId: string }, blocks: DayBlock[]): DayContext {
  return {
    hubId: seed.hubId,
    userId: seed.userId,
    date: DATE,
    timezone: TZ,
    blocks,
    readiness: 'ready',
  };
}

/**
 * A day whose remaining window cannot hold what is left on it.
 *
 * @remarks
 * At 16:00 the 09:00 block has overrun and is therefore what is actually being worked, so it is
 * fixed and consumes the day up to now. That leaves one free hour, and the block after it needs
 * `overflowMinutes`. Nothing fits, so the day is genuinely short — not merely late.
 */
function overflowingDay(overflowMinutes: number): DayBlock[] {
  return [
    block({ start: at(DAY_START_MINUTE), end: at(15 * 60 + 30), title: 'Morning deep work' }),
    block({
      start: at(15 * 60 + 30),
      end: at(15 * 60 + 30 + overflowMinutes),
      title: 'Finish Q3 deck',
    }),
  ];
}

/** 16:00 — inside the lead window, an hour before the boundary. */
const EVENING = new Date(at(16 * 60));

describe('assessEveningShortfall', () => {
  it('reports no shortfall before the lead window, however overrun the day already is', () => {
    // 11:00: the 09:00 block has overrun by two hours, so the posture is already unhappy — but
    // there are six hours of window left and the day can still absorb the work by itself.
    const result = assessEveningShortfall({
      blocks: overflowingDay(90),
      now: new Date(at(11 * 60)),
      date: DATE,
      timezone: TZ,
      windows: [WEEKDAY_WINDOW],
    });
    expect(result.requestMinutes).toBe(0);
    expect(result.deadlineKey).toBeNull();
  });

  it('caps the ask at two hours however far the day has overflowed', () => {
    const blocks = [
      block({ start: at(DAY_START_MINUTE), end: at(15 * 60 + 30), title: 'Morning deep work' }),
      block({ start: at(15 * 60 + 30), end: at(19 * 60 + 30), title: 'Four hour overflow' }),
      block({ start: at(19 * 60 + 30), end: at(22 * 60), title: 'More overflow' }),
    ];
    const result = assessEveningShortfall({
      blocks,
      now: EVENING,
      date: DATE,
      timezone: TZ,
      windows: [WEEKDAY_WINDOW],
    });
    expect(result.shortfallMinutes).toBeGreaterThan(120);
    expect(result.requestMinutes).toBe(120);
  });
});

describe('advanceEveningExtension', () => {
  it('does nothing at all when the deployment has no boundary client', async () => {
    const seed = await seedHub('bnd-noport');
    const pass = await advanceEveningExtension(db, context(seed, overflowingDay(90)), {
      port: null,
      now: EVENING,
    });
    expect(pass.skipped).toBe('no_port');
    await expect(readExtensionRequests(db, seed.hubId, DATE)).resolves.toHaveLength(0);
  });

  // ── Acceptance criterion C ────────────────────────────────────────────────────────────────
  it('submits a bounded request with a reason when the day genuinely will not fit', async () => {
    const seed = await seedHub('bnd-submit');
    const port = new FakeBoundaryPort();
    const blocks = overflowingDay(90);

    const pass = await advanceEveningExtension(db, context(seed, blocks), {
      port,
      now: EVENING,
    });
    expect(pass.submitted).toBe(true);
    expect(pass.skipped).toBeNull();

    // The proof is the row, not the call.
    const rows = await readExtensionRequests(db, seed.hubId, DATE);
    expect(rows).toHaveLength(1);
    const row = assertDefined(rows[0]);
    expect(row.state).toBe('pending');
    // Bounded: two hours of evening, maximum. This day needs 90 minutes and asks for 90.
    expect(row.requestedMinutes).toBe(90);
    expect(row.requestedMinutes).toBeLessThanOrEqual(120);
    // And a reason a person could actually be shown.
    expect(row.reason.length).toBeGreaterThan(0);
    expect(row.reason).toContain('Finish Q3 deck');
    expect(row.reason).toContain('90 more minutes');
    // The request is attributed to the deadline that overflowed, and carries the client's ticket.
    expect(row.deadlineKey).toBe(assertDefined(blocks[1]).calendarItemId);
    expect(row.externalRequestId).toBe('req-1');
  });

  it('never asks for more than two hours, even when the day has overflowed by four', async () => {
    const seed = await seedHub('bnd-ceiling');
    const port = new FakeBoundaryPort();
    const blocks = [
      block({ start: at(DAY_START_MINUTE), end: at(15 * 60 + 30), title: 'Morning deep work' }),
      block({ start: at(15 * 60 + 30), end: at(19 * 60 + 30), title: 'Enormous overflow' }),
    ];

    await advanceEveningExtension(db, context(seed, blocks), { port, now: EVENING });

    const [row] = await readExtensionRequests(db, seed.hubId, DATE);
    expect(row?.requestedMinutes).toBe(120);
    expect(row?.reason).toContain('120 more minutes');
  });

  // ── Acceptance criterion D ────────────────────────────────────────────────────────────────
  it('leaves the plan and the wake boundary untouched when the request is denied, and never retries', async () => {
    const seed = await seedHub('bnd-denied');
    const port = new FakeBoundaryPort();
    const blocks = overflowingDay(90);
    const ctx = context(seed, blocks);

    // Snapshot everything on the morning side of the day before anything is asked.
    const before = await morningState(seed.hubId);
    const planBefore = structuredClone(blocks);

    await advanceEveningExtension(db, ctx, { port, now: EVENING });
    port.answer('denied', 'Not during a warning stage');

    // The next sweep polls, learns the answer, and records it.
    const second = await advanceEveningExtension(db, ctx, { port, now: EVENING });
    expect(second.resolved).toBe(1);
    const denied = await readExtensionRequests(db, seed.hubId, DATE);
    expect(denied).toHaveLength(1);
    expect(denied[0]?.state).toBe('denied');
    expect(denied[0]?.resolvedAt).not.toBeNull();

    // No retry storm: eight more sweeps over the same still-overflowing day.
    port.answer('approved');
    for (let i = 0; i < 8; i += 1) {
      const pass = await advanceEveningExtension(db, ctx, { port, now: EVENING });
      expect(pass.submitted).toBe(false);
      expect(pass.skipped).toBe('already_requested');
    }
    // One request ever, still denied — a refusal that a later sweep could overwrite would be a
    // refusal the person never actually gave.
    const after = await readExtensionRequests(db, seed.hubId, DATE);
    expect(after).toHaveLength(1);
    expect(after[0]?.state).toBe('denied');
    // Exactly one consent prompt was ever raised.
    expect(port.submissions).toHaveLength(1);
    // And the client was polled once, for the one pass that had something open to poll.
    expect(port.polls).toEqual(['req-1']);

    // The plan is still coherent without the extension: nothing about the day moved.
    expect(blocks).toEqual(planBefore);
    // The morning boundary is untouched — the availability windows (whose start minutes *are*
    // the wake side of the day) and the morning release signal are byte-identical.
    expect(await morningState(seed.hubId)).toEqual(before);
  });

  it('treats an unanswered request as expired rather than as a refusal, and stops polling it', async () => {
    const seed = await seedHub('bnd-expiry');
    const port = new FakeBoundaryPort();
    const ctx = context(seed, overflowingDay(90));

    await advanceEveningExtension(db, ctx, { port, now: EVENING });
    // Still pending well past the expiry.
    const later = new Date(EVENING.getTime() + (REQUEST_EXPIRY_MINUTES + 1) * 60_000);
    const pass = await advanceEveningExtension(db, ctx, { port, now: later });
    expect(pass.resolved).toBe(1);

    const rows = await readExtensionRequests(db, seed.hubId, DATE);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('expired');

    // An expired request is final too: nothing re-asks, and nothing polls it again.
    const pollsAfterExpiry = port.polls.length;
    await advanceEveningExtension(db, ctx, { port, now: later });
    expect(port.polls).toHaveLength(pollsAfterExpiry);
    expect(port.submissions).toHaveLength(1);
  });

  it('seals the whole day when the client reports its shared budget is spent', async () => {
    const seed = await seedHub('bnd-budget');
    const port = new FakeBoundaryPort();
    const firstDeadline = overflowingDay(90);

    await advanceEveningExtension(db, context(seed, firstDeadline), { port, now: EVENING });
    port.answer('budget_exhausted', 'No extensions left this week');
    await advanceEveningExtension(db, context(seed, firstDeadline), { port, now: EVENING });
    expect((await readExtensionRequests(db, seed.hubId, DATE))[0]?.state).toBe('budget_exhausted');

    // A *different* deadline overflows later the same evening. A spent budget refuses that ask
    // identically, so asking again is noise aimed at someone who already said no.
    port.answer('pending');
    const otherDeadline = overflowingDay(75);
    const pass = await advanceEveningExtension(db, context(seed, otherDeadline), {
      port,
      now: EVENING,
    });
    expect(pass.submitted).toBe(false);
    expect(pass.skipped).toBe('budget_exhausted');
    expect(await readExtensionRequests(db, seed.hubId, DATE)).toHaveLength(1);
    expect(port.submissions).toHaveLength(1);
  });

  it('releases its claim when the client cannot be reached, so a later pass can try again', async () => {
    const seed = await seedHub('bnd-unreachable');
    const port = new FakeBoundaryPort();
    const ctx = context(seed, overflowingDay(90));

    port.failSubmit = true;
    const failed = await advanceEveningExtension(db, ctx, { port, now: EVENING });
    expect(failed.skipped).toBe('submit_failed');
    // No phantom pending row: a transport blip must not silently retire the deadline.
    expect(await readExtensionRequests(db, seed.hubId, DATE)).toHaveLength(0);

    port.failSubmit = false;
    const retried = await advanceEveningExtension(db, ctx, { port, now: EVENING });
    expect(retried.submitted).toBe(true);
    expect(await readExtensionRequests(db, seed.hubId, DATE)).toHaveLength(1);
  });

  it('records an approval without touching the plan, because the grant is the device schedule’s', async () => {
    const seed = await seedHub('bnd-approved');
    const port = new FakeBoundaryPort();
    const blocks = overflowingDay(90);
    const ctx = context(seed, blocks);
    const before = await morningState(seed.hubId);
    const planBefore = structuredClone(blocks);

    await advanceEveningExtension(db, ctx, { port, now: EVENING });
    port.answer('approved');
    await advanceEveningExtension(db, ctx, { port, now: EVENING });

    const [row] = await readExtensionRequests(db, seed.hubId, DATE);
    expect(row?.state).toBe('approved');
    expect(blocks).toEqual(planBefore);
    expect(await morningState(seed.hubId)).toEqual(before);
  });

  it('keeps a request open while the client says pending, counting the polls', async () => {
    const seed = await seedHub('bnd-pending');
    const port = new FakeBoundaryPort();
    const ctx = context(seed, overflowingDay(90));

    await advanceEveningExtension(db, ctx, { port, now: EVENING });
    await advanceEveningExtension(db, ctx, { port, now: EVENING });
    await advanceEveningExtension(db, ctx, { port, now: EVENING });

    const rows = await readExtensionRequests(db, seed.hubId, DATE);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('pending');
    expect(rows[0]?.pollCount).toBe(2);
    expect(rows[0]?.resolvedAt).toBeNull();
  });

  it('asks for nothing when the remaining window still holds everything left', async () => {
    const seed = await seedHub('bnd-fits');
    const port = new FakeBoundaryPort();
    // One 30-minute block starting at 16:00 — the last hour holds it comfortably.
    const blocks = [block({ start: at(16 * 60), end: at(16 * 60 + 30), title: 'Short wrap-up' })];

    const pass = await advanceEveningExtension(db, context(seed, blocks), {
      port,
      now: EVENING,
    });
    expect(pass.skipped).toBe('no_shortfall');
    expect(await readExtensionRequests(db, seed.hubId, DATE)).toHaveLength(0);
  });
});

/**
 * Everything about a Hub-day that encodes a morning boundary.
 *
 * @remarks
 * The availability windows are the wake side of the day — `startMinute` is literally when the
 * working window opens — and `agendaAcknowledgedAt` is the morning release signal. If the evening
 * path could ever move a wake time, it would show up in one of these two.
 */
async function morningState(hubId: string): Promise<unknown> {
  const [preference] = await db
    .select({ windows: schema.schedulingPreference.windows })
    .from(schema.schedulingPreference)
    .where(eq(schema.schedulingPreference.hubId, hubId));
  const directives = await db
    .select({
      date: schema.dayDirective.date,
      agendaAcknowledgedAt: schema.dayDirective.agendaAcknowledgedAt,
    })
    .from(schema.dayDirective)
    .where(eq(schema.dayDirective.hubId, hubId));
  return { windows: preference?.windows ?? null, directives };
}
