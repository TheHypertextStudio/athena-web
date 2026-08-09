/**
 * `@docket/api` — the directive feed and daily loop (TOP-LEVEL, mounted at `/v1/directive`).
 *
 * @remarks
 * A generic read/close-the-loop surface: "what should I be doing right now, is it going badly,
 * and what is this day still waiting on". Per `docs/engineering/specs/curfew-integration.md` §0
 * nothing here names, models, or assumes any particular device-control client — the payload
 * carries a posture, a plain sentence, at most one narrowing recommendation, and the gates the
 * day is holding. What "holding" costs a person is entirely the consumer's decision.
 *
 * This router is Docket's own (cookie-session) half. The same computation backs the MCP-side
 * resource described in the spec; both read one service so a second consumer can never see a
 * different day than the first.
 */
import { db, hub } from '@docket/db';
import {
  AcknowledgeDirectiveInput,
  AcknowledgeDirectiveOutput,
  ConfirmTomorrowInput,
  DayCheckInOut,
  DayCheckInRespondInput,
  DayReviewOut,
  DayStartOut,
  DirectiveOut,
  MorningDecisionInput,
  ReorganizeResultOut,
  ReviewAnswerInput,
  ReviewDispositionInput,
  pageOf,
} from '@docket/types';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError, NotFoundError, ValidationError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
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
  readDayStart,
  recordAcknowledgment,
  reorganizeRemainingDay,
  respondToCheckIn,
} from '../services/scheduling/directive-service';
import { loadSchedulingPreferences } from '../services/scheduling/repository';
import { localDateString } from '../services/scheduling/zoned-time';

/** Resolve (or 404) the caller's Hub. */
async function resolveHub(userId: string): Promise<string> {
  const rows = await db.select({ id: hub.id }).from(hub).where(eq(hub.userId, userId)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Hub not found');
  return row.id;
}

/** Resolve the day being asked about, defaulting to today in the Hub timezone. */
async function resolveDay(
  userId: string,
  explicit: string | undefined,
): Promise<{ hubId: string; userId: string; date: string }> {
  const hubId = await resolveHub(userId);
  const preferences = await loadSchedulingPreferences(db, hubId);
  return { hubId, userId, date: explicit ?? localDateString(new Date(), preferences.timezone) };
}

const dayQuery = z.object({ date: z.iso.date().optional() });
const idParam = z.object({ id: z.string() });

/** Result of firing the morning release signal. */
const DayStartAcknowledgeOut = z
  .object({
    fired: z
      .boolean()
      .describe('True only on the call that actually released the gate; false on a repeat.'),
    acknowledgedAt: z.string().nullable(),
    readiness: z.string().describe('Why the signal was refused, when it was.'),
  })
  .meta({ id: 'DayStartAcknowledgeOut' });

/** Directive-feed router. */
const directive = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Directive',
      summary: 'Read the daily directive',
      response: DirectiveOut,
      description: `Return the caller's directive for a day: the committed plan, an attention summary, a **posture** (\`on_track\` / \`attention_needed\` / \`intervention_recommended\`), a plain-language reason safe to show verbatim, at most one narrowing recommendation, and the **gates** the day is still waiting on.

The posture is a deterministic schedule-adherence check over timeboxes and the wall clock — no model call, no probability. It is not a judgment about whether the work matters, and the copy it produces says so: it names a block and a number of minutes.

**Gates state a condition, never a mechanism.** \`day_start\` holds until the person has been through the morning agenda; \`day_end\` holds until all three steps of the evening review are done, naming which remain. Docket never says what holding should cost — a consumer maps that onto whatever it owns.

**Side effect (small, and the point):** the day's directive row is upserted, and its \`directiveId\` is regenerated **only when the posture actually changes**, so a consumer that acknowledges an id is acknowledging the state it saw and a healthy day produces no churn. Session-only, no capability; 401 when unauthenticated, 404 if the caller has no Hub. Related: \`POST /acknowledge\` to close the loop.`,
    }),
    zQuery(dayQuery),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { date } = c.req.valid('query');
      const scope = await resolveDay(session.user.id, date);
      const context = await loadDayContext(db, scope);
      const payload = await computeDirective(db, context, {});
      return ok(c, DirectiveOut, payload);
    },
  )
  .post(
    '/acknowledge',
    apiDoc({
      tag: 'Directive',
      summary: 'Acknowledge a directive',
      response: AcknowledgeDirectiveOutput,
      description: `Record what a consuming client did with a directive: which posture it acted on, whether it changed device state, and an optional note. This is how a person (and Athena) can see whether a consumer is actually acting on what it is told, rather than assuming it is.

**Idempotent by upsert on \`(hub, directiveId)\`** — a retried call after a dropped connection overwrites the same row rather than appending a duplicate, so \`directiveId\` doubles as the dedupe key and no separate idempotency header is needed.

**Only an id this Hub was issued is accepted.** A \`directiveId\` that never belonged to the caller's Hub — or one superseded by a posture change since the read — returns **404**; re-read the directive and acknowledge the state that stands.

**Side effect:** upserts one \`directive_acknowledgment\` row. Session-only, no capability; 401 when unauthenticated, 404 if the caller has no Hub or the directiveId was never theirs.`,
    }),
    zJson(AcknowledgeDirectiveInput),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const hubId = await resolveHub(session.user.id);
      const receipt = await recordAcknowledgment(db, {
        hubId,
        clientId: null,
        body: c.req.valid('json'),
        userId: session.user.id,
        now: new Date(),
      });
      if (receipt === null) throw new NotFoundError('Directive not found');
      return ok(c, AcknowledgeDirectiveOutput, receipt);
    },
  )
  .get(
    '/day-start',
    apiDoc({
      tag: 'Directive',
      summary: 'Read the start-of-day handshake',
      response: DayStartOut,
      description: `Return whether today's agenda is ready to be presented, the agenda itself, and the start-of-day gate.

**A not-ready day returns a reason, never an empty agenda.** \`readiness\` is \`not_generated\` when no planning run covers today and \`empty_week\` when one does but placed nothing — two genuinely different situations that an empty array would flatten into one, causing a consumer to release its gate on a day that was simply never planned. \`agenda\` is only populated when \`ready\` is true.

Side-effect-free apart from lazily creating the day's directive row. Session-only, no capability; 401 when unauthenticated, 404 if the caller has no Hub. Related: \`POST /day-start/acknowledge\`.`,
    }),
    zQuery(dayQuery),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { date } = c.req.valid('query');
      const scope = await resolveDay(session.user.id, date);
      const context = await loadDayContext(db, scope);
      const payload = await readDayStart(db, context, {});
      return ok(c, DayStartOut, payload);
    },
  )
  .post(
    '/day-start/decide',
    apiDoc({
      tag: 'Directive',
      summary: 'Answer one of the morning’s proposals',
      response: DayStartOut,
      description: `Record what the person decided about one proposed block during the morning walk-through — keep it on today, or move it out — and return the day-start payload as it now stands.

**\`defer\` is a real move, not a label.** The block leaves today for \`deferTo\` (tomorrow by default), keeping its clock time so a deferral across a DST boundary does not silently shift an hour. That is the whole difference between a morning review and a morning reading: a decision that costs the day nothing is theatre, and the morning release signal that follows it would mean nothing either.

**Only Docket's own blocks are deferable.** A block a person placed by hand, or one that arrived from an external calendar, is offered for review but returns **422** on a deferral — moving it would be Docket editing someone else's diary. \`keep\` is accepted for any block.

**Side effects:** moves the block when deferring, and records the decision on \`day_directive.morning_decisions\` so a reload does not lose the walk-through. Decisions are keyed by calendar item id and replace wholesale, so answering twice is idempotent. Session-only, no capability; 401 when unauthenticated, 404 if the caller has no Hub or the key is not in today's proposals.`,
    }),
    zQuery(dayQuery),
    zJson(MorningDecisionInput),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { date } = c.req.valid('query');
      const body = c.req.valid('json');
      const scope = await resolveDay(session.user.id, date);
      const context = await loadDayContext(db, scope);
      const result = await decideMorningProposal(db, context, {
        key: body.key,
        decision: body.decision,
        deferTo: body.deferTo,
        now: new Date(),
      });
      if (result.status === 'not_found') throw new NotFoundError('Proposal not found');
      if (result.status === 'not_deferable') {
        throw new ValidationError([
          {
            path: ['key'],
            message: 'Docket can only move blocks it placed itself.',
          },
        ]);
      }
      // Re-read the day: a deferral just changed what is on it.
      const after = await loadDayContext(db, scope);
      const payload = await readDayStart(db, after, {});
      return ok(c, DayStartOut, payload);
    },
  )
  .post(
    '/day-start/acknowledge',
    apiDoc({
      tag: 'Directive',
      summary: 'Complete the morning agenda review',
      response: DayStartAcknowledgeOut,
      description: `Fire the morning release signal: the person has been through today's agenda.

**It fires exactly once.** The write is conditional on the signal being absent, so a retried or duplicated call returns \`fired: false\` with the original timestamp rather than producing a second signal — which is what lets a consumer treat "the gate released" as an event and not a poll result. A day whose agenda is not \`ready\` is refused with \`fired: false\` and the readiness code, so a client cannot release a gate for a day that was never planned.

**Side effect:** stamps \`day_directive.agenda_acknowledged_at\`. Session-only, no capability; 401 when unauthenticated, 404 if the caller has no Hub.`,
    }),
    zQuery(dayQuery),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { date } = c.req.valid('query');
      const scope = await resolveDay(session.user.id, date);
      const context = await loadDayContext(db, scope);
      const result = await acknowledgeAgenda(db, context, new Date());
      if (result.status === 'not_ready') {
        return ok(c, DayStartAcknowledgeOut, {
          fired: false,
          acknowledgedAt: null,
          readiness: result.readiness,
        });
      }
      return ok(c, DayStartAcknowledgeOut, {
        fired: result.status === 'acknowledged',
        acknowledgedAt: result.at.toISOString(),
        readiness: 'ready',
      });
    },
  )
  .get(
    '/check-ins',
    apiDoc({
      tag: 'Directive',
      summary: "List the day's check-ins",
      response: pageOf(DayCheckInOut),
      description: `Return the day's check-ins in order, each carrying the block it is about, how many of the day's blocks were still unfinished when it came due, application-owned prompt copy, and either the person's answer or the fact that it went unanswered.

**Rows are materialized ahead of time, not derived on read.** That is what makes a *non-response* recordable: a check-in that came due and was never answered is a fact about the day rather than missing data. The schedule is anchored to block boundaries — the honest moment to ask "did that land?" is when something was supposed to finish — and topped up on a cadence, with a floor of three per day so a sparse day still gets asked and a cap of eight so a full one does not become a day of interruptions.

Calling this materializes the day's rows if they do not exist yet. Session-only, no capability; 401 when unauthenticated, 404 if the caller has no Hub. Related: \`POST /check-ins/:id/respond\`.`,
    }),
    zQuery(dayQuery),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { date } = c.req.valid('query');
      const scope = await resolveDay(session.user.id, date);
      const context = await loadDayContext(db, scope);
      await ensureCheckIns(db, context);
      const items = await readCheckIns(db, context, new Date());
      return ok(c, pageOf(DayCheckInOut), { items });
    },
  )
  .post(
    '/check-ins/:id/respond',
    apiDoc({
      tag: 'Directive',
      summary: 'Answer a check-in',
      response: pageOf(DayCheckInOut),
      description: `Record the person's own answer to one check-in — on track, behind, switched to something else, or already done — with an optional note, and return the day's check-ins as they now stand.

The answer is the person's, never inferred. A \`behind\` or \`switched\` answer is what a drift reorganization looks for, so answering honestly is what makes the rest of the day get re-cut rather than silently slip.

**Side effect:** stamps the check-in's response and timestamp. Scoped to the caller's own Hub, so one Hub can never answer another's; a check-in that is not the caller's returns **404**. Session-only, no capability; 401 when unauthenticated.`,
    }),
    zParam(idParam),
    zJson(DayCheckInRespondInput),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const scope = await resolveDay(session.user.id, undefined);
      const answeredDate = await respondToCheckIn(db, {
        checkInId: id,
        hubId: scope.hubId,
        response: body.response,
        note: body.note ?? null,
        now: new Date(),
      });
      if (answeredDate === null) throw new NotFoundError('Check-in not found');
      // Re-read the day the check-in actually belongs to, not whatever "today" happens to be.
      const context = await loadDayContext(db, { ...scope, date: answeredDate });
      const items = await readCheckIns(db, context, new Date());
      return ok(c, pageOf(DayCheckInOut), { items });
    },
  )
  .post(
    '/reorganize',
    apiDoc({
      tag: 'Directive',
      summary: 'Re-cut the remaining day',
      response: ReorganizeResultOut,
      description: `Recompute the rest of today around what actually happened and write the result to the calendar.

**The restraint is the design.** Only blocks that have not started yet *and* that the scheduler itself placed are movable; anything in progress, already done, in the past, hand-placed, or synced from an external calendar is fixed. Movable blocks are re-placed in their original order into whatever availability is genuinely left, keeping their durations and their shape's window rules — so a shoot is never re-cut into desk hours. A schedule that rearranges itself under a person is worse than one that slips, and this will not do it.

Blocks the shortened day can no longer hold are **archived, not deleted**, so the evening review still sees them and the person decides what happens to them.

**Side effects:** updates the moved blocks' times, archives displaced ones, and stamps \`day_directive.last_reorganized_at\` when anything changed. Returns the moves with before/after times and how far the day had slipped. Session-only, no capability; 401 when unauthenticated, 404 if the caller has no Hub.`,
    }),
    zQuery(dayQuery),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { date } = c.req.valid('query');
      const scope = await resolveDay(session.user.id, date);
      const context = await loadDayContext(db, scope);
      const outcome = await reorganizeRemainingDay(db, context, new Date());
      return ok(c, ReorganizeResultOut, {
        date: outcome.date,
        reorganizedAt: outcome.reorganizedAt,
        movedBlocks: outcome.moves,
        displacedBlocks: outcome.displaced,
        driftMinutes: outcome.driftMinutes,
      });
    },
  )
  .get(
    '/review',
    apiDoc({
      tag: 'Directive',
      summary: 'Read the end-of-day review',
      response: DayReviewOut,
      description: `Return the structured end-of-day review: its three steps and whether each is satisfied, every unfinished item awaiting a decision, the fixed reflection questions and their answers, the proposed agenda for tomorrow, and the \`day_end\` gate.

**A defined flow, not a free-text box.** Step one lists every unfinished block and requires a decision on each — done after all, moved to a specific day, or dropped *with a reason*. Step two asks three fixed questions. Step three requires tomorrow to be explicitly confirmed. The gate names whichever steps are outstanding and releases only when none are.

The item list is materialized on first open from whatever is actually unfinished, so a person cannot dodge an item by opening the review early; once materialized it is stable, so a decision already made never reappears.

**Side effect:** creates the review row on first read. Session-only, no capability; 401 when unauthenticated, 404 if the caller has no Hub.`,
    }),
    zQuery(dayQuery),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { date } = c.req.valid('query');
      const scope = await resolveDay(session.user.id, date);
      const context = await loadDayContext(db, scope);
      const payload = await readDayReview(db, context);
      return ok(c, DayReviewOut, payload);
    },
  )
  .post(
    '/review/disposition',
    apiDoc({
      tag: 'Directive',
      summary: 'Decide on one unfinished item',
      response: DayReviewOut,
      description: `Record what happens to one piece of unfinished work: it was \`completed\` after all, it is \`rescheduled\` to a named date, or it is \`dropped\` — which **requires a reason**, because a dropped commitment with no explanation is the thing that makes a review theatre.

The DTO enforces both conditions (a drop without a reason and a reschedule without a date are validation failures, not silently-accepted rows), so the release signal cannot be reached by dispositioning items meaninglessly.

**Side effect:** updates the item inside the day's review row and returns the whole review, so the caller sees the step counters and gate move. Session-only, no capability; 401 when unauthenticated, 404 if the caller has no Hub or the item key is not in this review.`,
    }),
    zQuery(dayQuery),
    zJson(ReviewDispositionInput),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { date } = c.req.valid('query');
      const body = c.req.valid('json');
      const scope = await resolveDay(session.user.id, date);
      const context = await loadDayContext(db, scope);
      await readDayReview(db, context);
      const updated = await disposeReviewItem(db, {
        hubId: scope.hubId,
        date: scope.date,
        key: body.key,
        disposition: body.disposition,
        rescheduledTo: body.rescheduledTo ?? null,
        reason: body.reason ?? null,
      });
      if (!updated) throw new NotFoundError('Review item not found');
      const payload = await readDayReview(db, context);
      return ok(c, DayReviewOut, payload);
    },
  )
  .post(
    '/review/answer',
    apiDoc({
      tag: 'Directive',
      summary: 'Answer one review question',
      response: DayReviewOut,
      description: `Record the answer to one of the three fixed reflection questions — what moved, what got in the way, what should be different tomorrow — and return the review as it now stands.

The questions are a closed set defined by Docket, so a review is comparable day to day rather than being whatever the person felt like writing. Answers are the person's own words and are never shown back as anything but their own.

**Side effect:** updates the review's answer map. Session-only, no capability; 401 when unauthenticated, 404 if the caller has no Hub or no review exists for the day.`,
    }),
    zQuery(dayQuery),
    zJson(ReviewAnswerInput),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { date } = c.req.valid('query');
      const body = c.req.valid('json');
      const scope = await resolveDay(session.user.id, date);
      const context = await loadDayContext(db, scope);
      await readDayReview(db, context);
      const updated = await answerReviewPrompt(db, {
        hubId: scope.hubId,
        date: scope.date,
        key: body.key,
        answer: body.answer,
      });
      if (!updated) throw new NotFoundError('Review not found');
      const payload = await readDayReview(db, context);
      return ok(c, DayReviewOut, payload);
    },
  )
  .post(
    '/review/confirm-tomorrow',
    apiDoc({
      tag: 'Directive',
      summary: "Confirm tomorrow's agenda",
      response: DayReviewOut,
      description: `The last step, and never implicit: the person accepts (a subset of) the proposed agenda for tomorrow, which completes the review and releases the \`day_end\` gate.

**Refused while an earlier step is outstanding.** A call made before every item is dispositioned or every question answered fails validation naming the outstanding steps, so the three steps cannot be completed out of order and a client cannot skip to the end to release the gate. Nothing auto-accepts a proposal — that is the difference between "the system planned tomorrow" and "the person intended tomorrow", and it is the whole reason this step exists.

**Side effects:** stores the accepted proposals, stamps \`tomorrow_confirmed_at\` and \`completed_at\` on the review, and stamps \`review_completed_at\` on the day's directive. Session-only, no capability; 401 when unauthenticated, 404 if the caller has no Hub.`,
    }),
    zQuery(dayQuery),
    zJson(ConfirmTomorrowInput),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { date } = c.req.valid('query');
      const body = c.req.valid('json');
      const scope = await resolveDay(session.user.id, date);
      const context = await loadDayContext(db, scope);
      await readDayReview(db, context);
      const result = await confirmTomorrow(db, context, {
        acceptedKeys: body.acceptedKeys,
        now: new Date(),
      });
      if (result.status === 'blocked') {
        throw new ValidationError([
          {
            path: ['acceptedKeys'],
            message: `Finish these steps first: ${result.outstanding.join(', ')}`,
          },
        ]);
      }
      const payload = await readDayReview(db, context);
      return ok(c, DayReviewOut, payload);
    },
  );

export default directive;
