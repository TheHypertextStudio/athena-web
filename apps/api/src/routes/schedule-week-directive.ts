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
} from '@docket/planning/scheduling-directive-contract';
import { pageOf } from '../contracts/pagination';
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
import { localDateString } from '@docket/planning/zoned-time';

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
      description: `Return the caller's committed plan and attention status for one day. \`posture\` is \`on_track\`, \`attention_needed\`, or \`intervention_recommended\`. The response includes a reason, at most one recommendation, and any incomplete day-start or day-end gates.

Docket calculates posture from scheduled timeboxes and the current time. It does not use a model or assign a probability. Reading the directive creates the day's directive when needed. Its \`directiveId\` changes only when posture changes, so \`POST /acknowledge\` can acknowledge the exact state the caller read.`,
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
      description: `Record how a client handled a directive, including the posture it used, whether it changed device state, and an optional note.

\`directiveId\` is the deduplication key. Repeating the request replaces the existing acknowledgment instead of creating another one, so this operation does not use \`Idempotency-Key\`. Docket returns 404 when the directive was never issued to this caller or a posture change has replaced it. Read the current directive and acknowledge its new ID before retrying.`,
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
      description: `Return the start-of-day gate, readiness state, and agenda. \`readiness: "not_generated"\` means no planning run covers today. \`readiness: "empty_week"\` means a planning run exists but placed no blocks. \`agenda\` is populated only when \`ready\` is true.

Reading this operation creates the day's directive when it does not exist. It does not change the agenda or release the gate. Use \`POST /day-start/acknowledge\` after presenting the agenda.`,
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
      description: `Keep or defer one block from the morning review and return the updated day-start response. \`keep\` leaves the block on the selected day. \`defer\` moves it to \`deferTo\`, or to tomorrow when \`deferTo\` is omitted, while preserving its local clock time.

Only blocks created by Docket's scheduler can be deferred. A hand-created or externally synced block returns 422 for \`defer\`, but it may be kept. Docket records the decision so later day-start reads return the same result. Repeating the same decision is safe. An unknown proposal returns 404.`,
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
      description: `Return the day's check-ins in scheduled order. Each item identifies its calendar block, reports how many blocks remained unfinished when it became due, includes display-ready prompt text, and contains either the caller's response or an unanswered state.

Docket schedules check-ins at block boundaries and adds enough evenly spaced check-ins to produce between three and eight per day. Reading the collection creates any missing check-ins for the day, which allows an unanswered check-in to remain visible later. Use \`POST /check-ins/:id/respond\` to answer one.`,
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
      description: `Reschedule the remaining Docket-planned blocks for today around the time that is still available. Docket moves only future blocks created by its scheduler. It does not move blocks that have started, finished, were created by the person, or came from an external calendar. Moved blocks keep their duration, order, and work-shape restrictions.

Blocks that no longer fit are archived rather than deleted, so the evening review can still include them. The response lists moved blocks with their previous and new times, displaced blocks, and \`driftMinutes\`. When anything changes, Docket records \`lastReorganizedAt\`.`,
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
      description: `Return the end-of-day review, including its three steps, unfinished items, reflection questions and answers, proposed agenda for tomorrow, and the \`day_end\` gate.

Step one requires a decision for each unfinished block: mark it done, move it to a date, or drop it with a reason. Step two contains three fixed reflection questions. Step three requires explicit confirmation of tomorrow's agenda. The gate lists incomplete steps and releases when all three are complete.

The first read creates a stable review from the day's unfinished items. Items do not disappear from that review after later schedule changes, and completed decisions do not reappear.`,
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
      description: `Record what happened to one unfinished item: it was \`completed\`, it is \`rescheduled\` to a named date, or it is \`dropped\`. Dropping an item requires a reason.

Dropping without a reason or rescheduling without a date returns a validation error. The day cannot be released until every unfinished item has a valid disposition.

The response contains the complete updated review, including its step counts and release state. Session-only, no capability. Returns 401 when unauthenticated and 404 when the caller has no Hub or the item key is not in this review.`,
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
