/**
 * `@docket/api` — the proactive day cadence: check-ins that fire, and drift that gets re-cut.
 *
 * @remarks
 * The daily loop was written as pure decisions (`day-loop.ts`) meeting the database
 * (`directive-service.ts`), and until this sweep existed **nothing called the proactive half of
 * it.** `ensureCheckIns` only ran when someone opened the check-ins list, so a day nobody looked
 * at had no check-ins at all; `dayCheckIn.firedAt` was written by no code path in the repository,
 * so a check-in never announced itself; `reorganizeRemainingDay` had exactly one caller, a button;
 * and `checkInSignalsDrift` had none. That is the difference between a chief of staff and a
 * reference manual, and this file is the caller that closes it.
 *
 * **One pass, three things, in this order and for a reason.**
 *
 * 1. **Materialize** the day's check-ins if they do not exist yet, so the rhythm belongs to the
 *    day rather than to whoever happened to open a page.
 * 2. **Re-cut** the remainder when the day has genuinely drifted ({@link assessDrift}) and the Hub
 *    has not turned that off. This happens *before* the check-ins fire so the question a person is
 *    asked is about the day as it now stands, not the one that already slipped away from them.
 * 3. **Fire** every check-in that has come due, each exactly once, as a notification they can act
 *    on.
 *
 * **Nothing here is silent.** A re-cut that actually moved something announces itself; a check-in
 * that fires sends a notification and stamps `fired_at` only when the claim succeeded. A pass that
 * changes nothing sends nothing, which is what makes a five-minute cadence liveable.
 *
 * **Scoping.** Hubs are read through {@link hubsWithSchedulingConfigured}, which is the same
 * per-Hub predicate the posture sweep uses; every read and write below is keyed by that Hub's own
 * `hubId` and its owner's `userId`, and the calendar writes go through the repository helpers that
 * additionally require `origin = 'scheduler'`. The Hub island is deliberately cross-workspace —
 * a week is planned for a person, not for a workspace — so organization scoping rides on the
 * calendar items themselves, exactly as it does everywhere else in this island.
 *
 * `now` is a parameter, never a module-scope clock, so every branch here is reachable from a test.
 */
import type { dayCheckIn } from '@docket/db';
import { db, genId } from '@docket/db';
import type { CheckInResponse } from '@docket/planning/scheduling-directive-contract';

import { dispatchSystemUserNotification } from '../services/notifications/system';
import {
  assessDrift,
  computeDirectivePosture,
  type DriftTrigger,
} from '../services/scheduling/day-loop';
import {
  checkInPrompt,
  ensureCheckIns,
  loadDayContext,
  reorganizeRemainingDay,
  type DayContext,
  type ReorganizeOutcome,
} from '../services/scheduling/directive-service';
import {
  claimCheckInFire,
  ensureDayDirective,
  hubToday,
  hubsWithSchedulingConfigured,
  loadCheckIns,
  loadSchedulingPreferences,
} from '../services/scheduling/repository';

/** One check-in row, as this sweep reads it. */
type CheckInRow = typeof dayCheckIn.$inferSelect;

/**
 * How long after its scheduled time a check-in is still worth firing.
 *
 * @remarks
 * Past this it is not a check-in, it is an interruption about a moment that has gone — and the
 * row is left unfired on purpose, because "came due and was never asked" is the honest record of
 * a day the sweep was not running for. It also stops a deployment that was down for three hours
 * from waking someone with three hours of backlog the moment it returns.
 */
export const CHECK_IN_FIRE_WINDOW_MINUTES = 30;

/** What one day-cadence pass did. */
export interface DayCadenceSweepResult {
  /** Configured Hubs evaluated. */
  readonly hubs: number;
  /** Hubs skipped because today was never planned (or the plan placed nothing). */
  readonly skipped: number;
  /** Check-in rows materialized this pass. */
  readonly materialized: number;
  /** Check-ins that came due and were announced, each exactly once. */
  readonly fired: number;
  /** Days whose remainder was re-cut because they had drifted. */
  readonly reorganized: number;
  /** Blocks moved by those re-cuts. */
  readonly movedBlocks: number;
  /** Blocks the shortened days could no longer hold. */
  readonly displacedBlocks: number;
  /** Hubs that tripped a drift trigger but were inside their re-cut cooldown. */
  readonly cooledDown: number;
  /** Hubs that failed; each is logged and the sweep moves on. */
  readonly failed: number;
}

/** The running totals of a pass, before they are frozen into a result. */
interface Totals {
  skipped: number;
  materialized: number;
  fired: number;
  reorganized: number;
  movedBlocks: number;
  displacedBlocks: number;
  cooledDown: number;
  failed: number;
}

/**
 * Run one proactive pass over every configured Hub's local today.
 *
 * @param now - The instant to evaluate at (request time, never module scope).
 * @returns what the pass actually did; see {@link DayCadenceSweepResult}.
 */
export async function sweepDayCadence(now: Date): Promise<DayCadenceSweepResult> {
  const hubs = await hubsWithSchedulingConfigured(db);
  const totals: Totals = {
    skipped: 0,
    materialized: 0,
    fired: 0,
    reorganized: 0,
    movedBlocks: 0,
    displacedBlocks: 0,
    cooledDown: 0,
    failed: 0,
  };

  for (const entry of hubs) {
    try {
      await sweepOneHub(entry, now, totals);
    } catch (err) {
      // One Hub's failure must not starve every Hub after it; the scheduler retries the sweep.
      totals.failed += 1;
      console.error(`day-cadence sweep failed for hub ${entry.hubId}:`, err);
    }
  }

  return { hubs: hubs.length, ...totals };
}

/** One Hub's pass, folded into the running totals. */
async function sweepOneHub(
  entry: { readonly hubId: string; readonly userId: string; readonly timezone: string },
  now: Date,
  totals: Totals,
): Promise<void> {
  const date = hubToday(entry.timezone, now);
  let context = await loadDayContext(db, {
    hubId: entry.hubId,
    userId: entry.userId,
    date,
  });

  // A day that was never planned has no goals to check progress against, and asking about one
  // would be Docket inventing a commitment the person never made.
  if (context.readiness !== 'ready') {
    totals.skipped += 1;
    return;
  }

  totals.materialized += await ensureCheckIns(db, context);

  const preferences = await loadSchedulingPreferences(db, entry.hubId);
  const directive = await ensureDayDirective(db, {
    hubId: entry.hubId,
    date,
    timezone: context.timezone,
    directiveId: genId(),
  });
  const checkIns = await loadCheckIns(db, entry.hubId, date);

  const verdict = assessDrift({
    posture: computeDirectivePosture({ blocks: context.blocks, now, timezone: context.timezone })
      .posture,
    checkIns: checkIns.map((c) => ({
      response: (c.response as CheckInResponse | null) ?? null,
      respondedAt: c.respondedAt,
    })),
    lastReorganizedAt: directive.lastReorganizedAt,
    now,
  });
  if (verdict.cooledDown) totals.cooledDown += 1;

  let outcome: ReorganizeOutcome | null = null;
  if (verdict.shouldReorganize && preferences.autoReorganizeOnDrift) {
    outcome = await reorganizeRemainingDay(db, context, now);
    if (outcome.moves.length > 0 || outcome.displaced.length > 0) {
      totals.reorganized += 1;
      totals.movedBlocks += outcome.moves.length;
      totals.displacedBlocks += outcome.displaced.length;
      await announceReorganization(entry.userId, context, outcome, verdict.trigger);
      // Re-read so the check-ins about to fire describe the day as it now stands.
      context = await loadDayContext(db, {
        hubId: entry.hubId,
        userId: entry.userId,
        date,
      });
    } else {
      outcome = null;
    }
  }

  totals.fired += await fireDueCheckIns(entry, context, checkIns, outcome, now);
}

/** The check-ins that have come due, are unfired, and are still recent enough to be worth asking. */
function dueForFiring(checkIns: readonly CheckInRow[], now: Date): readonly CheckInRow[] {
  const floor = now.getTime() - CHECK_IN_FIRE_WINDOW_MINUTES * 60_000;
  return checkIns.filter(
    (c) =>
      c.firedAt === null &&
      c.scheduledAt.getTime() <= now.getTime() &&
      c.scheduledAt.getTime() > floor,
  );
}

/** Claim and announce every check-in that has come due. Returns how many actually fired. */
async function fireDueCheckIns(
  entry: { readonly hubId: string; readonly userId: string },
  context: DayContext,
  checkIns: readonly CheckInRow[],
  reorganized: ReorganizeOutcome | null,
  now: Date,
): Promise<number> {
  let fired = 0;
  for (const checkIn of dueForFiring(checkIns, now)) {
    const claimed = await claimCheckInFire(db, {
      checkInId: checkIn.id,
      hubId: entry.hubId,
      at: now,
    });
    // Another tick got there first. Not an error, and emphatically not a second notification.
    if (!claimed) continue;
    await dispatchSystemUserNotification(db, {
      userId: entry.userId,
      category: 'workflow',
      priority: 'normal',
      channels: ['web'],
      subject: checkInPrompt(checkIn.blockTitle),
      body: { text: checkInBody(context, now, reorganized) },
      webUrl: '/today',
      // The check-in id is the natural dedupe key: one row is one moment in one day.
      idempotencyKey: `day-check-in:${checkIn.id}`,
    });
    fired += 1;
  }
  return fired;
}

/**
 * The check-in's body copy.
 *
 * @remarks
 * Application-owned in full — no provider text, no model sentence, nothing that could carry an
 * exception message to a person. It states the two facts a check-in is for: how much of the day's
 * committed plan is still outstanding, and whether the rest of the day was just re-cut underneath
 * it. The second sentence exists because a schedule that changed without saying so is worse than
 * one that slipped.
 *
 * **Every number comes from `context`, read at `now`.** `day_check_in.outstanding_goals` is frozen
 * when the day's check-ins are materialized and is never revised — deliberately, because it is the
 * record of what the rhythm was set against. Reading it here mixed a count from that moment with a
 * total and a done-count from this one, and the two stopped agreeing the instant the day changed
 * shape: a re-cut that displaces two blocks shrinks the total while the frozen count still counts
 * them, and the sentence claims more work than the day it is describing contains. Refreshing the
 * column was the alternative and is worse — it would rewrite the materialized schedule the
 * check-ins API reports, to fix a sentence. So the live day is authoritative, and because `done`
 * and `ahead` are disjoint subsets of the same list, their sum cannot exceed the total it states.
 */
function checkInBody(
  context: DayContext,
  now: Date,
  reorganized: ReorganizeOutcome | null,
): string {
  const done = context.blocks.filter((b) => b.done).length;
  const ahead = context.blocks.filter((b) => !b.done && b.end > now.getTime()).length;
  const progress =
    context.blocks.length === 0
      ? 'Nothing is blocked out for today.'
      : `${String(done)} of ${String(context.blocks.length)} blocks done, ${String(ahead)} still ahead of you.`;
  if (reorganized === null) return progress;
  return `${progress} The rest of today was just re-cut around a ${String(reorganized.driftMinutes)}-minute slip.`;
}

/** Tell the person their calendar moved. A re-cut nobody is told about is a calendar you cannot trust. */
async function announceReorganization(
  userId: string,
  context: DayContext,
  outcome: ReorganizeOutcome,
  trigger: DriftTrigger | null,
): Promise<void> {
  const moved = outcome.moves.length;
  const displaced = outcome.displaced.length;
  const because =
    trigger === 'check_in'
      ? 'You said the day had got away from you, so'
      : `Today had slipped ${String(outcome.driftMinutes)} minutes, so`;
  const movedCopy = moved === 1 ? '1 block moved' : `${String(moved)} blocks moved`;
  const displacedCopy =
    displaced === 0
      ? ''
      : displaced === 1
        ? ' 1 block no longer fits today and is waiting in tonight’s review.'
        : ` ${String(displaced)} blocks no longer fit today and are waiting in tonight’s review.`;
  await dispatchSystemUserNotification(db, {
    userId,
    category: 'workflow',
    priority: 'normal',
    channels: ['web'],
    subject: 'The rest of today has been re-cut',
    body: { text: `${because} ${movedCopy}.${displacedCopy}` },
    webUrl: '/today',
    // One announcement per re-cut: the stamped instant is what makes two re-cuts two events.
    idempotencyKey: `day-recut:${context.hubId}:${outcome.reorganizedAt}`,
  });
}
