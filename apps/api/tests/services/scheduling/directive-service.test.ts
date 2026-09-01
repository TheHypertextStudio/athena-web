/**
 * `@docket/api` — direct unit coverage for `services/scheduling/directive-service.ts`.
 *
 * @remarks
 * `directive-routes.test.ts` exercises this module end-to-end through the HTTP router, using
 * real weeks planned by the scheduler — which is the right shape for behavioral coverage but
 * never lands on a handful of edge cases the router path cannot reach: a day that was planned
 * but placed nothing, a block already marked done, an `appUrl` deep link, a posture that
 * actually recommends narrowing, check-ins read after some are already due, and a day that has
 * genuinely drifted enough to move blocks. This file calls the service functions directly so it
 * can construct exactly those shapes without depending on the scheduler's own placement logic.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { genId } from '@docket/db';
import type * as DbModule from '@docket/db';

import { getDb, seedUserWithHub } from '../../support/routes-harness';

import type { DayBlock } from '../../../src/services/scheduling/day-loop';
import type { DayContext } from '../../../src/services/scheduling/directive-service';
import {
  acknowledgeAgenda,
  answerReviewPrompt,
  computeDirective,
  confirmTomorrow,
  decideMorningProposal,
  disposeReviewItem,
  ensureCheckIns,
  loadDayContext,
  readCheckIns,
  readDayReview,
  reorganizeRemainingDay,
} from '../../../src/services/scheduling/directive-service';
import { ensureDayDirective } from '../../../src/services/scheduling/repository';
import { instantAt } from '@docket/planning/zoned-time';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

const TZ = 'America/Los_Angeles';
const DATE = '2026-10-06';

function at(minuteOfDay: number): number {
  return instantAt(DATE, minuteOfDay, TZ).getTime();
}

let blockCounter = 0;
function block(over: Partial<DayBlock> = {}): DayBlock {
  blockCounter += 1;
  return {
    calendarItemId: `DSITEM${String(blockCounter)}`,
    taskId: null,
    organizationId: null,
    title: `Direct block ${String(blockCounter)}`,
    shape: 'deep_writing',
    start: at(9 * 60),
    end: at(11 * 60),
    done: false,
    schedulerOwned: true,
    ...over,
  };
}

/** Seed a bare Hub (no scheduling preferences, no runs) and return its id. */
async function seedHub(label: string): Promise<{ hubId: string; userId: string }> {
  const userId = await seedUserWithHub(db, schema, label);
  const [hubRow] = await db
    .select({ id: schema.hub.id })
    .from(schema.hub)
    .where(eq(schema.hub.userId, userId))
    .limit(1);
  if (!hubRow) throw new Error('seeded user has no hub');
  return { hubId: hubRow.id, userId };
}

function buildContext(hubId: string, userId: string, blocks: readonly DayBlock[]): DayContext {
  return {
    hubId,
    userId,
    date: DATE,
    timezone: TZ,
    blocks,
    readiness: blocks.length === 0 ? 'empty_week' : 'ready',
  };
}

describe('loadDayContext — a run that covers the day but placed nothing', () => {
  it('reports empty_week readiness rather than not_generated', async () => {
    const { hubId, userId } = await seedHub('DirectiveSvcEmptyWeek');
    await db.insert(schema.scheduleRun).values({
      hubId,
      weekStartDate: DATE,
      timezone: TZ,
      blockCount: 0,
    });

    const context = await loadDayContext(db, { hubId, userId, date: DATE });

    expect(context.readiness).toBe('empty_week');
    expect(context.blocks).toEqual([]);
  });
});

describe('ensureCheckIns/readCheckIns on a day with no blocks at all', () => {
  it('still materializes at least the floor of check-ins, each with the generic prompt', async () => {
    const { hubId, userId } = await seedHub('DirectiveSvcEmptyCheckIns');
    await db.insert(schema.scheduleRun).values({
      hubId,
      weekStartDate: DATE,
      timezone: TZ,
      blockCount: 0,
    });
    const context = await loadDayContext(db, { hubId, userId, date: DATE });
    expect(context.readiness).toBe('empty_week');

    const created = await ensureCheckIns(db, context);
    expect(created).toBeGreaterThan(0);

    const rows = await db
      .select()
      .from(schema.dayCheckIn)
      .where(eq(schema.dayCheckIn.hubId, hubId))
      .orderBy(schema.dayCheckIn.scheduledAt);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) expect(row.blockTitle).toBeNull();

    // Read with `now` between the first and second check-in: the first is due and superseded by
    // the second (also due) — "missed" — while the second is due but nothing later is, so it is
    // not missed. The third is not due yet at all.
    const now = new Date(assertDefined(rows[1]).scheduledAt.getTime() + 1_000);
    const items = await readCheckIns(db, context, now);
    const first = items.find((i) => i.id === assertDefined(rows[0]).id);
    const second = items.find((i) => i.id === assertDefined(rows[1]).id);
    const third = items.find((i) => i.id === assertDefined(rows[2]).id);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(third).toBeDefined();

    expect(first?.blockTitle).toBeNull();
    expect(first?.prompt).toBe('Nothing is blocked out right now — how is the day going?');
    expect(first?.firedAt).toBe(assertDefined(rows[0]).scheduledAt.toISOString());
    expect(first?.missed, 'a superseded, unanswered check-in reads as missed').toBe(true);

    expect(second?.firedAt).toBe(assertDefined(rows[1]).scheduledAt.toISOString());
    expect(second?.missed, 'the most recent due check-in is not itself missed').toBe(false);

    expect(third?.firedAt).toBeNull();
    expect(third?.missed).toBe(false);
  });
});

describe('computeDirective — plan serialization and posture escalation', () => {
  it('marks a done block, links an appUrl, counts due check-ins, and recommends narrowing', async () => {
    const { hubId, userId } = await seedHub('DirectiveSvcComputeDirective');
    const finishedBlock = block({
      title: 'Already wrapped',
      start: at(7 * 60),
      end: at(8 * 60),
      done: true,
    });
    // About to end: `computeDirectivePosture` recommends narrowing to the block that's almost
    // over, per day-loop's `attention_needed` escalation.
    const currentBlock = block({
      title: 'Wrapping up now',
      start: at(9 * 60),
      end: at(11 * 60),
    });
    const now = new Date(at(10 * 60 + 50));
    const context = buildContext(hubId, userId, [finishedBlock, currentBlock]);

    // One due, unanswered check-in (counts) and one already-answered check-in (does not count).
    await db.insert(schema.dayCheckIn).values([
      {
        hubId,
        date: DATE,
        scheduledAt: new Date(at(9 * 60)),
        blockCalendarItemId: currentBlock.calendarItemId,
        blockTitle: currentBlock.title,
        outstandingGoals: 1,
      },
      {
        hubId,
        date: DATE,
        scheduledAt: new Date(at(9 * 60 + 30)),
        respondedAt: new Date(at(9 * 60 + 31)),
        response: 'on_track',
        blockCalendarItemId: currentBlock.calendarItemId,
        blockTitle: currentBlock.title,
        outstandingGoals: 1,
      },
    ]);

    const payload = await computeDirective(db, context, {
      now,
      appUrl: 'https://app.docket.example',
    });

    const finishedItem = payload.plan.find(
      (p) => p.calendarItemId === finishedBlock.calendarItemId,
    );
    const currentItem = payload.plan.find((p) => p.calendarItemId === currentBlock.calendarItemId);
    expect(finishedItem?.status).toBe('done');
    expect(currentItem?.status).toBe('planned');
    expect(currentItem?.url).toBe(
      `https://app.docket.example/calendar?item=${currentBlock.calendarItemId}`,
    );

    expect(payload.posture).toBe('attention_needed');
    expect(payload.recommendedAction).not.toBeNull();
    expect(payload.recommendedAction?.calendarItemId).toBe(currentBlock.calendarItemId);
    expect(payload.recommendedAction?.kind).toBe('narrow_focus');

    // One due-and-unanswered check-in, one answered — only the first counts.
    expect(payload.checkInsDue).toBe(1);
  });
});

describe('reorganizeRemainingDay — an actually-drifted day', () => {
  it('stamps lastReorganizedAt only when something genuinely moved or was displaced', async () => {
    const { hubId, userId } = await seedHub('DirectiveSvcReorganize');
    // A block that overran by 45 minutes, and a later block that must therefore shift — the
    // same shape `day-loop.test.ts` uses to prove a drifted day gets re-cut.
    const overrunning = block({
      title: 'Ran long',
      start: at(13 * 60),
      end: at(15 * 60),
    });
    const later = block({
      title: 'Pushed back',
      start: at(15 * 60),
      end: at(16 * 60),
    });
    const now = new Date(at(15 * 60 + 45));
    const context = buildContext(hubId, userId, [overrunning, later]);

    // The directive row must already exist for `reorganizeRemainingDay`'s update to have
    // anything to stamp — in the real flow it is always created first by a `GET /directive`
    // or `/day-start` read, which this direct-service test skips.
    await ensureDayDirective(db, { hubId, date: DATE, timezone: TZ, directiveId: genId() });
    const before = await db
      .select({ at: schema.dayDirective.lastReorganizedAt })
      .from(schema.dayDirective)
      .where(eq(schema.dayDirective.hubId, hubId));
    expect(before).toHaveLength(1);
    expect(before[0]?.at).toBeNull();

    const outcome = await reorganizeRemainingDay(db, context, now);

    expect(outcome.driftMinutes).toBe(45);
    expect(outcome.moves.length + outcome.displaced.length).toBeGreaterThan(0);

    const after = await db
      .select({ at: schema.dayDirective.lastReorganizedAt })
      .from(schema.dayDirective)
      .where(eq(schema.dayDirective.hubId, hubId));
    expect(after).toHaveLength(1);
    expect(after[0]?.at).not.toBeNull();
  });

  it('leaves lastReorganizedAt untouched on a day that has not drifted', async () => {
    const { hubId, userId } = await seedHub('DirectiveSvcReorganizeNoop');
    const settled = block({ start: at(9 * 60), end: at(11 * 60), done: true });
    const context = buildContext(hubId, userId, [settled]);

    const outcome = await reorganizeRemainingDay(db, context, new Date(at(11 * 60)));
    expect(outcome.moves).toEqual([]);
    expect(outcome.displaced).toEqual([]);

    const rows = await db
      .select({ at: schema.dayDirective.lastReorganizedAt })
      .from(schema.dayDirective)
      .where(eq(schema.dayDirective.hubId, hubId));
    // Nothing moved, so `ensureDayDirective`'s row is never even created by this call.
    expect(rows).toEqual([]);
  });
});

describe('acknowledgeAgenda — the fired-exactly-once race', () => {
  it('reports the original acknowledgement time even when its own read raced a concurrent one', async () => {
    const { hubId, userId } = await seedHub('DirectiveSvcAckRace');
    const readyContext: DayContext = {
      ...buildContext(hubId, userId, [block()]),
      readiness: 'ready',
    };

    const [first, second] = await Promise.all([
      acknowledgeAgenda(db, readyContext, new Date(at(8 * 60))),
      acknowledgeAgenda(db, readyContext, new Date(at(8 * 60 + 1))),
    ]);
    const results = [first, second];

    const acknowledged = results.find((r) => r.status === 'acknowledged');
    const already = results.find((r) => r.status === 'already');
    // Exactly one call fires the signal; the other must see it as already fired — never a
    // second, different signal, and never both refused.
    expect(acknowledged, 'exactly one call should fire the signal').toBeDefined();
    expect(already, 'the other call should observe it as already fired').toBeDefined();
    if (!acknowledged) throw new Error('unreachable');
    if (!already) throw new Error('unreachable');

    expect(already.at.getTime()).toBe(acknowledged.at.getTime());

    const rows = await db
      .select({ at: schema.dayDirective.agendaAcknowledgedAt })
      .from(schema.dayDirective)
      .where(eq(schema.dayDirective.hubId, hubId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.at?.getTime()).toBe(acknowledged.at.getTime());
  });
});

describe('review-step writers refuse a day whose review was never opened', () => {
  it('disposeReviewItem, answerReviewPrompt, and confirmTomorrow all return their not-found result', async () => {
    const { hubId, userId } = await seedHub('DirectiveSvcNoReview');
    const context = buildContext(hubId, userId, [block()]);

    const disposed = await disposeReviewItem(db, {
      hubId,
      date: DATE,
      key: 'whatever',
      disposition: 'completed',
      rescheduledTo: null,
      reason: null,
    });
    expect(disposed).toBe(false);

    const answered = await answerReviewPrompt(db, {
      hubId,
      date: DATE,
      key: 'what_moved',
      answer: 'Nothing — the review was never opened',
    });
    expect(answered).toBe(false);

    const confirmed = await confirmTomorrow(db, context, { acceptedKeys: [], now: new Date() });
    expect(confirmed).toEqual({ status: 'blocked', outstanding: ['reconcile'] });
  });

  it('disposeReviewItem refuses a key that is not part of the opened review', async () => {
    const { hubId, userId } = await seedHub('DirectiveSvcWrongKey');
    const context = buildContext(hubId, userId, [block()]);
    await readDayReview(db, context);

    const disposed = await disposeReviewItem(db, {
      hubId,
      date: DATE,
      key: 'not_a_real_item_key',
      disposition: 'completed',
      rescheduledTo: null,
      reason: null,
    });
    expect(disposed).toBe(false);
  });
});

describe('proposeTomorrow — a carried item with no recorded times', () => {
  it('falls back to a fixed 60-minute slot instead of computing a negative or NaN duration', async () => {
    const { hubId, userId } = await seedHub('DirectiveSvcProposeFallback');
    const untimedBlock = block({ title: 'No recorded time', start: at(9 * 60), end: at(10 * 60) });
    const context = buildContext(hubId, userId, [untimedBlock]);

    const opened = await readDayReview(db, context);
    const item = opened.items.find((i) => i.calendarItemId === untimedBlock.calendarItemId);
    expect(item).toBeDefined();

    const tomorrowDate = opened.tomorrowDate;
    const [reviewRow] = await db
      .select()
      .from(schema.dayReview)
      .where(eq(schema.dayReview.hubId, hubId));
    expect(reviewRow).toBeDefined();
    const untimedItems = assertDefined(reviewRow).items.map((i) =>
      i.key === assertDefined(item).key
        ? {
            ...i,
            disposition: 'rescheduled' as const,
            rescheduledTo: tomorrowDate,
            startsAt: null,
            endsAt: null,
          }
        : i,
    );
    await db
      .update(schema.dayReview)
      .set({ items: untimedItems, tomorrowProposals: [] })
      .where(eq(schema.dayReview.id, assertDefined(reviewRow).id));

    const reopened = await readDayReview(db, context);
    const proposal = reopened.tomorrowProposals.find(
      (p) => p.carriedFromKey === assertDefined(item).key,
    );
    expect(proposal).toBeDefined();
    const durationMinutes =
      (new Date(assertDefined(proposal).endsAt).getTime() -
        new Date(assertDefined(proposal).startsAt).getTime()) /
      60_000;
    expect(durationMinutes).toBe(60);
  });
});

describe('decideMorningProposal — two answers given at the same moment', () => {
  it('keeps both decisions rather than letting the later write erase the earlier one', async () => {
    const { hubId, userId } = await seedHub('DirectiveSvcMorningRace');
    const first = block({ title: 'Cut the trailer', start: at(9 * 60), end: at(10 * 60) });
    const second = block({ title: 'Draft the brief', start: at(10 * 60), end: at(11 * 60) });
    const context = buildContext(hubId, userId, [first, second]);
    await ensureDayDirective(db, { hubId, date: DATE, timezone: TZ, directiveId: genId() });

    // Two clients — a phone and a laptop, or simply two tabs — answering different proposals
    // before either write lands. Both calls read the stored array; both write one back.
    const now = new Date(at(9 * 60));
    const [a, b] = await Promise.all([
      decideMorningProposal(db, context, { key: first.calendarItemId, decision: 'keep', now }),
      decideMorningProposal(db, context, { key: second.calendarItemId, decision: 'keep', now }),
    ]);

    // Both were told their answer was recorded, so both answers must actually be there. A
    // decision the person watched being accepted and which then vanished is the worst kind of
    // loss: silent, and contradicted by what they were shown.
    expect(a.status).toBe('recorded');
    expect(b.status).toBe('recorded');

    const [row] = await db
      .select({ morningDecisions: schema.dayDirective.morningDecisions })
      .from(schema.dayDirective)
      .where(eq(schema.dayDirective.hubId, hubId));
    const stored = [...(row?.morningDecisions ?? [])];
    expect(stored.map((d) => d.key).sort()).toEqual(
      [first.calendarItemId, second.calendarItemId].sort(),
    );
    for (const decision of stored) expect(decision.decision).toBe('kept');
  });

  it('re-answering one proposal replaces that answer and leaves the other alone', async () => {
    const { hubId, userId } = await seedHub('DirectiveSvcMorningReplace');
    const first = block({ title: 'Cut the trailer', start: at(9 * 60), end: at(10 * 60) });
    const second = block({ title: 'Draft the brief', start: at(10 * 60), end: at(11 * 60) });
    const context = buildContext(hubId, userId, [first, second]);

    const now = new Date(at(9 * 60));
    await decideMorningProposal(db, context, { key: first.calendarItemId, decision: 'keep', now });
    await decideMorningProposal(db, context, { key: second.calendarItemId, decision: 'keep', now });
    // Changing your mind about one block must not duplicate it, and must not disturb the other.
    await decideMorningProposal(db, context, { key: first.calendarItemId, decision: 'keep', now });

    const [row] = await db
      .select({ morningDecisions: schema.dayDirective.morningDecisions })
      .from(schema.dayDirective)
      .where(eq(schema.dayDirective.hubId, hubId));
    const stored = [...(row?.morningDecisions ?? [])];
    expect(stored).toHaveLength(2);
    expect(stored.map((d) => d.key).sort()).toEqual(
      [first.calendarItemId, second.calendarItemId].sort(),
    );
  });
});
