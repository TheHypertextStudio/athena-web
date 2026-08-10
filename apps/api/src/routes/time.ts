/**
 * `routes/time` — personal Time Ledger API (mounted at `/v1/time`).
 *
 * @remarks
 * This router is deliberately Hub/session scoped rather than organization scoped. It is the only
 * public API that starts, stops, repairs, contextualizes, or allocates actual tracked time; Tasks,
 * Calendar, Agenda, and agents contribute typed context through this same contract.
 */
import { apiHosts } from '@docket/env/api';
import {
  TimeActiveOut,
  TimeAllocationReplace,
  TimeBreakdownOut,
  TimeBreakdownQuery,
  TimeCategoryCreate,
  TimeCategoryListOut,
  TimeCategoryOut,
  TimeCyclePeriodListOut,
  TimeContextCreate,
  TimeIntervalCreate,
  TimeIntervalRepair,
  TimeMeasuresOut,
  TimeRecordCreate,
  TimeRecordStatusUpdate,
  TimeRecordOut,
  TimeRecordUpdate,
  TimeShareTokenCreate,
  TimeShareTokenCreated,
  TimeShareTokenListOut,
  TimeShareTokenOut,
  TimeSubmissionCreate,
  TimeSubmissionOut,
  TimeTimelineOut,
  TimeTimelineQuery,
} from '@docket/types';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv, AuthSession } from '../context';
import { AuthError, ReauthRequiredError } from '../error';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { SHARED_TIMER_STATUS_PATH, sharedTimerEmbedSnippet } from './time-public';
import {
  addHistoricalInterval,
  addTimeContext,
  createTimeRecord,
  createTimeCategory,
  createTimeShareToken,
  createTimeSubmission,
  getActiveTime,
  getTimeBreakdown,
  getTimeRecord,
  getTimeSummary,
  getTimeSubmission,
  getTimeTimeline,
  listTimeCategories,
  listPersonalTimeCycles,
  listTimeShareTokens,
  pauseTimeRecord,
  removeTimeRecord,
  repairHistoricalInterval,
  removeTimeContext,
  replaceTimeAllocations,
  revokeTimeShareToken,
  startTimeRecord,
  stopTimeRecord,
  updateTimeRecord,
} from '../time/service';

/** Resolve the authenticated caller for this personal Hub surface. */
function requireSession(c: { get: (key: 'session') => AuthSession }): NonNullable<AuthSession> {
  const session = c.get('session');
  if (!session?.user) throw new AuthError();
  return session;
}

/** External credential creation is high-risk and requires passkey step-up within five minutes. */
function requireFreshSession(session: NonNullable<AuthSession>): void {
  const ageMs = Date.now() - new Date(session.session.createdAt).getTime();
  if (ageMs > 5 * 60 * 1000) {
    throw new ReauthRequiredError('Please re-verify your passkey to continue.');
  }
}

const recordParam = z.object({ id: z.string() });
const intervalParam = z.object({ id: z.string(), intervalId: z.string() });
const contextParam = z.object({ id: z.string(), contextId: z.string() });
const submissionParam = z.object({ id: z.string() });

/** Personal Time Ledger routes. */
const time = new Hono<AppEnv>()
  .get(
    '/active',
    apiDoc({
      tag: 'Time',
      summary: 'Get the active tracker',
      response: TimeActiveOut,
      description:
        'Return the caller’s one active human tracker, any caller-visible active agent executions, and the server clock used to render exact elapsed time after a client reload. Session-only; raw time remains personal to the caller’s Hub.',
    }),
    async (c) => {
      const { user } = requireSession(c);
      return ok(c, TimeActiveOut, await getActiveTime(user.id));
    },
  )
  .get(
    '/timeline',
    apiDoc({
      tag: 'Time',
      summary: 'Get a bounded Time Ledger timeline',
      response: TimeTimelineOut,
      description:
        'Return the caller’s personal records whose exact intervals overlap the requested UTC range. The response includes all labeled duration measures and never infers actual work from calendar events or task timeboxes.',
    }),
    zQuery(TimeTimelineQuery),
    async (c) => {
      const { user } = requireSession(c);
      const query = c.req.valid('query');
      return ok(c, TimeTimelineOut, { items: await getTimeTimeline(user.id, query) });
    },
  )
  .get(
    '/summary',
    apiDoc({
      tag: 'Time',
      summary: 'Summarize a bounded Time Ledger range',
      response: TimeMeasuresOut,
      description:
        'Return separately-labeled human, agent, combined, elapsed, and operational-wait measures for the caller’s own records in a bounded range. Parallel agent effort intentionally may exceed elapsed wall-clock time.',
    }),
    zQuery(TimeTimelineQuery),
    async (c) => {
      const { user } = requireSession(c);
      return ok(c, TimeMeasuresOut, await getTimeSummary(user.id, c.req.valid('query')));
    },
  )
  .get(
    '/breakdown',
    apiDoc({
      tag: 'Time',
      summary: 'Break down Time Ledger effort',
      response: TimeBreakdownOut,
      description:
        'Group the caller’s personal Time Ledger by workspace, task, project, program, initiative, category, or actor. Workspace/task/project credit comes from explicit allocations; program and initiative are derived from the tracked task’s place in the work hierarchy (task → project → program, and project/program → initiative). Related context never silently becomes billable or reportable time, and a task with no program/initiative lands in an explicit `unassigned:*` bucket rather than being dropped.',
    }),
    zQuery(TimeBreakdownQuery),
    async (c) => {
      const { user } = requireSession(c);
      return ok(c, TimeBreakdownOut, await getTimeBreakdown(user.id, c.req.valid('query')));
    },
  )
  .get(
    '/cycles',
    apiDoc({
      tag: 'Time',
      summary: 'List personal Time Ledger cycle periods',
      response: TimeCyclePeriodListOut,
      description:
        'List cycle windows only from workspaces where the authenticated caller currently has an active membership. The periods are navigation aids for the caller’s private Time Ledger; this route never returns another person’s time.',
    }),
    async (c) => {
      const { user } = requireSession(c);
      return ok(c, TimeCyclePeriodListOut, { items: await listPersonalTimeCycles(user.id) });
    },
  )
  .get(
    '/categories',
    apiDoc({
      tag: 'Time',
      summary: 'List personal time categories',
      response: TimeCategoryListOut,
      description:
        'List the caller’s Hub-owned category taxonomy for reflection. Categories are optional and never required to begin tracking.',
    }),
    async (c) => {
      const { user } = requireSession(c);
      return ok(c, TimeCategoryListOut, {
        items: await listTimeCategories(user.id),
      });
    },
  )
  .post(
    '/categories',
    apiDoc({
      status: 201,
      tag: 'Time',
      summary: 'Create a personal time category',
      response: TimeCategoryOut,
      description:
        'Create a Hub-owned category. Categories remain personal metadata; creating one does not alter any workspace taxonomy or linked task.',
    }),
    zJson(TimeCategoryCreate),
    async (c) => {
      const { user } = requireSession(c);
      return created(c, TimeCategoryOut, await createTimeCategory(user.id, c.req.valid('json')));
    },
  )
  .post(
    '/submissions',
    apiDoc({
      status: 201,
      tag: 'Time',
      summary: 'Submit an explicit time report snapshot',
      response: TimeSubmissionOut,
      description:
        'Create an immutable, recipient-scoped snapshot of selected caller-owned Time Records. Every record must have explicit allocations; the chosen measure, timezone, and rounding policy are preserved with the snapshot rather than retroactively changing a report.',
    }),
    zJson(TimeSubmissionCreate),
    async (c) => {
      const { user } = requireSession(c);
      return created(
        c,
        TimeSubmissionOut,
        await createTimeSubmission(user.id, c.req.valid('json')),
      );
    },
  )
  .get(
    '/submissions/:id',
    apiDoc({
      tag: 'Time',
      summary: 'Get a personal time report snapshot',
      response: TimeSubmissionOut,
      description:
        'Read one report snapshot created by the caller. This personal route does not grant workspace members access to the caller’s raw ledger.',
    }),
    zParam(submissionParam),
    async (c) => {
      const { user } = requireSession(c);
      return ok(c, TimeSubmissionOut, await getTimeSubmission(user.id, c.req.valid('param').id));
    },
  )
  .post(
    '/records',
    apiDoc({
      tag: 'Time',
      summary: 'Create and optionally start a Time Record',
      response: TimeRecordOut,
      description:
        'Create a Hub-owned record from typed context. A live create atomically switches away from the caller’s prior active human interval; a non-live create requires exact historical bounds and is marked manual or reconstructed. Tasks and calendar items are context, never inferred time.',
    }),
    zJson(TimeRecordCreate),
    async (c) => {
      const { user } = requireSession(c);
      return ok(c, TimeRecordOut, await createTimeRecord(user.id, c.req.valid('json')));
    },
  )
  .get(
    '/records/:id',
    apiDoc({
      tag: 'Time',
      summary: 'Read a Time Record',
      response: TimeRecordOut,
      description:
        'Read one Time Record by id, hydrated exactly as the write endpoints return it — status, elapsed time from its interval rows, category, and typed context. This is what `Location` points at after a create, and what to re-read after a `412` when a concurrent edit invalidated an `If-Match`. A record outside the caller’s Hub is 404, not 403, so ownership is never disclosed.',
    }),
    zParam(recordParam),
    async (c) => {
      const { user } = requireSession(c);
      return ok(c, TimeRecordOut, await getTimeRecord(user.id, c.req.valid('param').id));
    },
  )
  .patch(
    '/records/:id',
    apiDoc({
      tag: 'Time',
      summary: 'Edit a Time Record',
      response: TimeRecordOut,
      description:
        'Edit only user-controlled semantic fields such as title and category. Exact duration remains in Time Interval rows and cannot be silently replaced by this endpoint.',
    }),
    zParam(recordParam),
    zJson(TimeRecordUpdate),
    async (c) => {
      const { user } = requireSession(c);
      return ok(
        c,
        TimeRecordOut,
        await updateTimeRecord(user.id, c.req.valid('param').id, c.req.valid('json')),
      );
    },
  )
  .put(
    '/records/:id/status',
    apiDoc({
      tag: 'Time',
      summary: 'Move a Time Record’s timer',
      response: TimeRecordOut,
      description:
        'Set the record’s timer state and return the refreshed record. `running` starts or resumes it on the server clock, atomically closing any other active human interval in the caller’s Hub so a handoff stays exact. `paused` closes the current interval and leaves the record open. `stopped` closes both the interval and the record; an unanchored record must supply `title` here, which creates the task the time is finally credited to. Stopping never changes a linked Task, Daily Plan Item, or Calendar Item state — the ledger records what happened and does not move work on its own. A record outside the caller’s Hub is 404.',
    }),
    zParam(recordParam),
    zJson(TimeRecordStatusUpdate),
    async (c) => {
      const { user } = requireSession(c);
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      if (body.status === 'running') {
        return ok(c, TimeRecordOut, await startTimeRecord(user.id, id));
      }
      if (body.status === 'paused') {
        return ok(c, TimeRecordOut, await pauseTimeRecord(user.id, id));
      }
      return ok(
        c,
        TimeRecordOut,
        await stopTimeRecord(user.id, id, body.title === undefined ? {} : { title: body.title }),
      );
    },
  )
  .post(
    '/records/:id/intervals',
    apiDoc({
      tag: 'Time',
      summary: 'Add exact past time',
      response: TimeRecordOut,
      description:
        'Add a bounded manual or reconstructed human interval. The source label is retained so reflection can distinguish remembered time from live tracking.',
    }),
    zParam(recordParam),
    zJson(TimeIntervalCreate),
    async (c) => {
      const { user } = requireSession(c);
      return ok(
        c,
        TimeRecordOut,
        await addHistoricalInterval(user.id, c.req.valid('param').id, c.req.valid('json')),
      );
    },
  )
  .patch(
    '/records/:id/intervals/:intervalId',
    apiDoc({
      tag: 'Time',
      summary: 'Repair exact past time',
      response: TimeRecordOut,
      description:
        'Replace one completed manual or reconstructed interval while retaining the original as superseded evidence. Live, agent, and submitted time cannot be repaired through this route.',
    }),
    zParam(intervalParam),
    zJson(TimeIntervalRepair),
    async (c) => {
      const { user } = requireSession(c);
      const params = c.req.valid('param');
      return ok(
        c,
        TimeRecordOut,
        await repairHistoricalInterval(user.id, params.id, params.intervalId, c.req.valid('json')),
      );
    },
  )
  .delete(
    '/records/:id',
    apiDoc({
      tag: 'Time',
      summary: 'Remove manual time from personal history',
      response: TimeRecordOut,
      description:
        'Hide an unsubmitted manual or reconstructed record from the caller’s ledger without hard-deleting its audit row. Live, agent, and submitted records remain immutable.',
    }),
    zParam(recordParam),
    async (c) => {
      const { user } = requireSession(c);
      return ok(c, TimeRecordOut, await removeTimeRecord(user.id, c.req.valid('param').id));
    },
  )
  .post(
    '/records/:id/contexts',
    apiDoc({
      status: 201,
      tag: 'Time',
      summary: 'Attach context to a Time Record',
      response: TimeRecordOut,
      description:
        'Attach typed non-counting context such as a task, calendar item, or related work. Context does not make the linked target receive reportable time credit.',
    }),
    zParam(recordParam),
    zJson(TimeContextCreate),
    async (c) => {
      const { user } = requireSession(c);
      return created(
        c,
        TimeRecordOut,
        await addTimeContext(user.id, c.req.valid('param').id, c.req.valid('json')),
      );
    },
  )
  .delete(
    '/records/:id/contexts/:contextId',
    apiDoc({
      tag: 'Time',
      summary: 'Remove Time Record context',
      response: TimeRecordOut,
      description: 'Remove one non-counting context from a record owned by the caller’s Hub.',
    }),
    zParam(contextParam),
    async (c) => {
      const { user } = requireSession(c);
      const params = c.req.valid('param');
      return ok(c, TimeRecordOut, await removeTimeContext(user.id, params.id, params.contextId));
    },
  )
  .get(
    '/share-tokens',
    apiDoc({
      tag: 'Time',
      summary: 'List current-task share tokens',
      response: TimeShareTokenListOut,
      description:
        'List the caller’s revocable share tokens, including when each was last read. The secret itself is shown only once, at mint time, and is not recoverable here.',
    }),
    async (c) => {
      const { user } = requireSession(c);
      return ok(c, TimeShareTokenListOut, { items: await listTimeShareTokens(user.id) });
    },
  )
  .post(
    '/share-tokens',
    apiDoc({
      status: 201,
      tag: 'Time',
      summary: 'Mint a current-task share token',
      response: TimeShareTokenCreated,
      description:
        'Mint one revocable token that lets an external page read what the caller is tracking RIGHT NOW — nothing else. The response carries the raw secret and a copy-pasteable embed snippet exactly once; only a hash is stored. `includeTitle: false` shares that tracking is running while withholding what it is on.',
    }),
    zJson(TimeShareTokenCreate),
    async (c) => {
      const session = requireSession(c);
      requireFreshSession(session);
      const { user } = session;
      const minted = await createTimeShareToken(user.id, c.req.valid('json'));
      // `API_URL` is required, so the configured origin is always present and always authoritative.
      // This used to fall back to the request's own origin for preview and local stacks; those set
      // `API_URL` to their own origin anyway, so the fallback could only ever have restated it.
      const origin = apiHosts.api;
      const statusUrl = `${origin}${SHARED_TIMER_STATUS_PATH}`;
      return created(c, TimeShareTokenCreated, {
        ...minted.stored,
        token: minted.token,
        statusUrl,
        embedSnippet: sharedTimerEmbedSnippet(statusUrl, minted.token),
      });
    },
  )
  .delete(
    '/share-tokens/:id',
    apiDoc({
      tag: 'Time',
      summary: 'Revoke a current-task share token',
      response: TimeShareTokenOut,
      description:
        'Revoke one token immediately. The row is retained, not deleted, so the owner keeps a record of what was shared and when it was last read.',
    }),
    zParam(recordParam),
    async (c) => {
      const { user } = requireSession(c);
      return ok(c, TimeShareTokenOut, await revokeTimeShareToken(user.id, c.req.valid('param').id));
    },
  )
  .put(
    '/records/:id/allocations',
    apiDoc({
      tag: 'Time',
      summary: 'Replace Time Record allocations',
      response: TimeRecordOut,
      description:
        'Replace reportable allocations atomically. When non-empty, allocations must sum to 10,000 basis points; contextual links are intentionally not treated as allocations.',
    }),
    zParam(recordParam),
    zJson(TimeAllocationReplace),
    async (c) => {
      const { user } = requireSession(c);
      return ok(
        c,
        TimeRecordOut,
        await replaceTimeAllocations(user.id, c.req.valid('param').id, c.req.valid('json')),
      );
    },
  );

export default time;
