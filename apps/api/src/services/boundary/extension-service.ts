/**
 * `@docket/api` — asking for more evening instead of quietly losing the work.
 *
 * @remarks
 * This is the Docket half of the boundary loop. Athena already knows, every five minutes, how the
 * day is going ({@link computeDirectivePosture}) and what the rest of it can no longer hold
 * ({@link assessEveningShortfall}). What she could not do was act on the second fact without
 * making the day worse: the only moves available were to drop work or to weaken the schedule by
 * hand. This module adds the third move — ask the client that owns the boundary, once, within a
 * bound, and take the answer.
 *
 * **Four policies, all load-bearing, none of them decoration:**
 *
 * 1. **Bounded.** The ask is capped at {@link MAX_EVENING_EXTENSION_MINUTES}. The clamp lives in
 *    the pure assessment, and {@link submitExtensionRequest} re-asserts it here rather than
 *    trusting its caller, because this is the function that actually reaches off-box.
 * 2. **The morning boundary is never touched.** Nothing in this module writes an availability
 *    window, a wake time, `agendaAcknowledgedAt`, or a calendar item. The only table it writes is
 *    `day_boundary_extension_request`, and the only field of the day it reads is what will not
 *    fit before the evening ends.
 * 3. **Athena requests; the person's own client decides.** Every terminal answer — including no
 *    answer at all — leaves the plan exactly as it was. There is no "apply the extension" branch,
 *    because a granted extension is a fact about the device's schedule, not about Docket's plan.
 * 4. **A refusal is never a retry.** {@link RESOLVED_STATES} are final per deadline, and
 *    `budget_exhausted` is final for the whole Hub-day: a shared budget that is spent will refuse
 *    the next ask identically, so re-asking is pure noise aimed at a person who already said no.
 */
import type { Database } from '@docket/db';
import { dayBoundaryExtensionRequest } from '@docket/db';
import { and, eq } from 'drizzle-orm';

import type { DayContext } from '../scheduling/directive-service';
import { MAX_EVENING_EXTENSION_MINUTES, assessEveningShortfall } from '../scheduling/day-loop';
import { loadSchedulingPreferences } from '../scheduling/repository';

import type { DayBoundaryPort } from './port';

/**
 * How long a queued request may go unanswered before it stops being worth polling.
 *
 * @remarks
 * A consent prompt nobody answered is not a refusal, but it is not an open question forever
 * either. Ageing it out is what stops a request the client pruned — or one raised while the
 * person was away from the machine — from being polled every five minutes until midnight.
 */
export const REQUEST_EXPIRY_MINUTES = 90;

/** The states that end a request. Nothing re-asks about a deadline that reached one of these. */
export const RESOLVED_STATES = Object.freeze([
  'approved',
  'denied',
  'budget_exhausted',
  'expired',
] as const);

/** One persisted request's state. */
export type ExtensionRequestState = 'pending' | (typeof RESOLVED_STATES)[number];

/** What one pass of {@link advanceEveningExtension} did, for the sweep's counters and for tests. */
export interface ExtensionPassResult {
  /** How many pending requests were polled this pass. */
  readonly polled: number;
  /** How many polls produced a terminal answer. */
  readonly resolved: number;
  /** Whether this pass queued a new request. */
  readonly submitted: boolean;
  /** Why nothing was submitted, when nothing was. Null when a request was submitted. */
  readonly skipped: SkipReason | null;
}

/** The reasons a pass declines to ask. Every one of them is a normal outcome, not a failure. */
export type SkipReason =
  'no_port' | 'no_shortfall' | 'already_requested' | 'budget_exhausted' | 'submit_failed';

/** The sentence a consent prompt shows. Application-owned copy — never a model's, never an error's. */
export function extensionReason(input: {
  readonly minutes: number;
  readonly title: string;
  readonly overflowCount: number;
}): string {
  const others =
    input.overflowCount > 1
      ? ` and ${String(input.overflowCount - 1)} other block${input.overflowCount > 2 ? 's' : ''}`
      : '';
  return (
    `"${input.title}"${others} will not fit in what is left of today's working window. ` +
    `Asking for up to ${String(input.minutes)} more minutes this evening rather than dropping the work. ` +
    `Tomorrow's start time is unaffected.`
  );
}

/**
 * Poll every still-open request for a Hub-day and record whatever came back.
 *
 * @remarks
 * Separated from the submit path because they answer different questions and a pass does both:
 * "did yesterday's question get an answer" has to settle before "should I ask a new one" can be
 * decided at all, or a `budget_exhausted` answer arriving this pass would not seal this pass.
 *
 * @param db - The database client.
 * @param input.hubId - The Hub.
 * @param input.date - The local date.
 * @param input.port - The boundary client.
 * @param input.now - The instant being evaluated.
 * @returns how many rows were polled and how many reached a terminal state.
 */
export async function pollOpenRequests(
  db: Database,
  input: {
    readonly hubId: string;
    readonly date: string;
    readonly port: DayBoundaryPort;
    readonly now: Date;
  },
): Promise<{ polled: number; resolved: number }> {
  const open = await db
    .select()
    .from(dayBoundaryExtensionRequest)
    .where(
      and(
        eq(dayBoundaryExtensionRequest.hubId, input.hubId),
        eq(dayBoundaryExtensionRequest.date, input.date),
        eq(dayBoundaryExtensionRequest.state, 'pending'),
      ),
    );

  let polled = 0;
  let resolved = 0;
  for (const row of open) {
    const agedOut =
      input.now.getTime() - row.submittedAt.getTime() >= REQUEST_EXPIRY_MINUTES * 60_000;

    // A row whose submission never produced a ticket has nothing to poll for; it can only age out.
    if (row.externalRequestId === null) {
      if (agedOut) {
        await resolve(db, {
          id: row.id,
          state: 'expired',
          detail: 'no request id was ever issued',
          now: input.now,
        });
        resolved += 1;
      }
      continue;
    }

    polled += 1;
    const answer = await askForAnswer(input.port, row.externalRequestId);
    const state = answer.state === 'pending' && agedOut ? 'expired' : answer.state;

    if (state === 'pending') {
      await db
        .update(dayBoundaryExtensionRequest)
        .set({ pollCount: row.pollCount + 1, detail: answer.detail })
        .where(eq(dayBoundaryExtensionRequest.id, row.id));
      continue;
    }
    await resolve(db, {
      id: row.id,
      state,
      detail: answer.detail,
      now: input.now,
      pollCount: row.pollCount + 1,
    });
    resolved += 1;
  }
  return { polled, resolved };
}

/**
 * Ask the boundary client what became of one request, treating silence as "still open".
 *
 * @remarks
 * `unavailable` means Docket could not learn the answer, which is not an answer: the row stays
 * open and ages out on its own rather than being recorded as a refusal the person never gave. A
 * client that cannot be reached at all is indistinguishable from one still thinking, so a thrown
 * transport error reads the same way, and the caller's expiry is the backstop for both.
 */
async function askForAnswer(
  port: DayBoundaryPort,
  externalRequestId: string,
): Promise<{ readonly state: ExtensionRequestState; readonly detail: string | null }> {
  try {
    const outcome = await port.pollExtensionRequest(externalRequestId);
    const settled = outcome.state !== 'unavailable' && outcome.state !== 'pending';
    return { state: settled ? outcome.state : 'pending', detail: outcome.detail };
  } catch {
    return { state: 'pending', detail: null };
  }
}

/** Write one request's terminal state. */
async function resolve(
  db: Database,
  outcome: {
    readonly id: string;
    readonly state: ExtensionRequestState;
    readonly detail: string | null;
    readonly now: Date;
    readonly pollCount?: number;
  },
): Promise<void> {
  await db
    .update(dayBoundaryExtensionRequest)
    .set({
      state: outcome.state,
      detail: outcome.detail,
      resolvedAt: outcome.now,
      ...(outcome.pollCount === undefined ? {} : { pollCount: outcome.pollCount }),
    })
    .where(eq(dayBoundaryExtensionRequest.id, outcome.id));
}

/**
 * Settle open requests, then ask for more evening if today still needs it and has not asked yet.
 *
 * @remarks
 * **Why the row is claimed before the port is called.** Submitting first and inserting after
 * leaves a window in which two overlapping sweep passes both see "no row yet" and both raise a
 * consent prompt for the same deadline. So the unique `(hubId, date, deadlineKey)` index is used
 * as the claim: `onConflictDoNothing` returns nothing to the loser, which stops immediately. Only
 * the winner reaches the port. If that call then fails, the claim is released rather than left
 * behind as a phantom pending request — a transport failure should cost one pass, not the day.
 *
 * @param db - The database client.
 * @param context - The Hub-day, as read by `loadDayContext`.
 * @param options.port - The boundary client, or null when this deployment has none.
 * @param options.now - The instant to evaluate at.
 * @returns what the pass did.
 */
export async function advanceEveningExtension(
  db: Database,
  context: DayContext,
  options: { readonly port: DayBoundaryPort | null; readonly now: Date },
): Promise<ExtensionPassResult> {
  const { port, now } = options;
  if (port === null) {
    return { polled: 0, resolved: 0, submitted: false, skipped: 'no_port' };
  }

  const { polled, resolved } = await pollOpenRequests(db, {
    hubId: context.hubId,
    date: context.date,
    port,
    now,
  });

  const existing = await db
    .select({
      deadlineKey: dayBoundaryExtensionRequest.deadlineKey,
      state: dayBoundaryExtensionRequest.state,
    })
    .from(dayBoundaryExtensionRequest)
    .where(
      and(
        eq(dayBoundaryExtensionRequest.hubId, context.hubId),
        eq(dayBoundaryExtensionRequest.date, context.date),
      ),
    );

  // One exhausted budget refuses every later ask identically, so it seals the day, not one row.
  if (existing.some((row) => row.state === 'budget_exhausted')) {
    return { polled, resolved, submitted: false, skipped: 'budget_exhausted' };
  }

  const preferences = await loadSchedulingPreferences(db, context.hubId);
  const shortfall = assessEveningShortfall({
    blocks: context.blocks,
    now,
    date: context.date,
    timezone: context.timezone,
    windows: preferences.windows,
  });
  if (shortfall.deadlineKey === null || shortfall.requestMinutes <= 0) {
    return { polled, resolved, submitted: false, skipped: 'no_shortfall' };
  }

  // Re-assert the ceiling at the boundary that actually reaches off-box, rather than trusting
  // the value that arrived here.
  const minutes = Math.min(shortfall.requestMinutes, MAX_EVENING_EXTENSION_MINUTES);
  const reason = extensionReason({
    minutes,
    title: shortfall.deadlineTitle ?? 'Unfinished work',
    overflowCount: shortfall.overflowCount,
  });

  const claimed = await db
    .insert(dayBoundaryExtensionRequest)
    .values({
      hubId: context.hubId,
      date: context.date,
      deadlineKey: shortfall.deadlineKey,
      requestedMinutes: minutes,
      reason,
      state: 'pending',
      submittedAt: now,
    })
    .onConflictDoNothing({
      target: [
        dayBoundaryExtensionRequest.hubId,
        dayBoundaryExtensionRequest.date,
        dayBoundaryExtensionRequest.deadlineKey,
      ],
    })
    .returning({ id: dayBoundaryExtensionRequest.id });

  const claim = claimed[0];
  // Already asked about this deadline — in any state. A pending row must not be duplicated and a
  // resolved one must not be re-asked, which is the same rule and so it is one branch.
  if (claim === undefined) {
    return { polled, resolved, submitted: false, skipped: 'already_requested' };
  }

  try {
    const submission = await port.submitExtensionRequest({ minutes, reason });
    await db
      .update(dayBoundaryExtensionRequest)
      .set({ externalRequestId: submission.requestId })
      .where(eq(dayBoundaryExtensionRequest.id, claim.id));
    return { polled, resolved, submitted: true, skipped: null };
  } catch {
    // Nothing was queued, so nothing should be remembered as queued. Releasing the claim lets a
    // later pass try again; keeping it would silently retire the deadline on a transport blip.
    await db
      .delete(dayBoundaryExtensionRequest)
      .where(eq(dayBoundaryExtensionRequest.id, claim.id));
    return { polled, resolved, submitted: false, skipped: 'submit_failed' };
  }
}

/** Read a Hub-day's requests, newest submission first — the audit view and the tests' assertion. */
export async function readExtensionRequests(
  db: Database,
  hubId: string,
  date: string,
): Promise<(typeof dayBoundaryExtensionRequest.$inferSelect)[]> {
  return await db
    .select()
    .from(dayBoundaryExtensionRequest)
    .where(
      and(eq(dayBoundaryExtensionRequest.hubId, hubId), eq(dayBoundaryExtensionRequest.date, date)),
    );
}
