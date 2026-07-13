/**
 * `routes/time` — personal Time Ledger API (mounted at `/v1/time`).
 *
 * @remarks
 * This router is deliberately Hub/session scoped rather than organization scoped. It is the only
 * public API that starts, stops, repairs, contextualizes, or allocates actual tracked time; Tasks,
 * Calendar, Agenda, and agents contribute typed context through this same contract.
 */
import {
  TimeActiveOut,
  TimeAllocationReplace,
  TimeBreakdownOut,
  TimeBreakdownQuery,
  TimeCategoryCreate,
  TimeCategoryListOut,
  TimeCategoryOut,
  TimeContextCreate,
  TimeIntervalCreate,
  TimeMeasuresOut,
  TimeRecordCreate,
  TimeRecordOut,
  TimeRecordUpdate,
  TimeSubmissionCreate,
  TimeSubmissionOut,
  TimeTimelineOut,
  TimeTimelineQuery,
} from '@docket/types';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv, AuthSession } from '../context';
import { AuthError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import {
  addHistoricalInterval,
  addTimeContext,
  createTimeRecord,
  createTimeCategory,
  createTimeSubmission,
  getActiveTime,
  getTimeBreakdown,
  getTimeSummary,
  getTimeSubmission,
  getTimeTimeline,
  listTimeCategories,
  pauseTimeRecord,
  removeTimeContext,
  replaceTimeAllocations,
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

const recordParam = z.object({ id: z.string() });
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
        'Group the caller’s personal Time Ledger by workspace, task, project, category, or actor. Workspace/task/project credit comes only from explicit allocations; related context never silently becomes billable or reportable time.',
    }),
    zQuery(TimeBreakdownQuery),
    async (c) => {
      const { user } = requireSession(c);
      return ok(c, TimeBreakdownOut, await getTimeBreakdown(user.id, c.req.valid('query')));
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
      tag: 'Time',
      summary: 'Create a personal time category',
      response: TimeCategoryOut,
      description:
        'Create a Hub-owned category. Categories remain personal metadata; creating one does not alter any workspace taxonomy or linked task.',
    }),
    zJson(TimeCategoryCreate),
    async (c) => {
      const { user } = requireSession(c);
      return ok(c, TimeCategoryOut, await createTimeCategory(user.id, c.req.valid('json')));
    },
  )
  .post(
    '/submissions',
    apiDoc({
      tag: 'Time',
      summary: 'Submit an explicit time report snapshot',
      response: TimeSubmissionOut,
      description:
        'Create an immutable, recipient-scoped snapshot of selected caller-owned Time Records. Every record must have explicit allocations; the chosen measure, timezone, and rounding policy are preserved with the snapshot rather than retroactively changing a report.',
    }),
    zJson(TimeSubmissionCreate),
    async (c) => {
      const { user } = requireSession(c);
      return ok(c, TimeSubmissionOut, await createTimeSubmission(user.id, c.req.valid('json')));
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
  .post(
    '/records/:id/start',
    apiDoc({
      tag: 'Time',
      summary: 'Start or resume a Time Record',
      response: TimeRecordOut,
      description:
        'Start or resume a paused record with the server clock. The command atomically closes any other active human interval in the caller’s Hub, preserving an exact handoff.',
    }),
    zParam(recordParam),
    async (c) => {
      const { user } = requireSession(c);
      return ok(c, TimeRecordOut, await startTimeRecord(user.id, c.req.valid('param').id));
    },
  )
  .post(
    '/records/:id/pause',
    apiDoc({
      tag: 'Time',
      summary: 'Pause a Time Record',
      response: TimeRecordOut,
      description:
        'Close the caller’s active human interval while preserving the record for a later resume. Agent executions remain independently measured.',
    }),
    zParam(recordParam),
    async (c) => {
      const { user } = requireSession(c);
      return ok(c, TimeRecordOut, await pauseTimeRecord(user.id, c.req.valid('param').id));
    },
  )
  .post(
    '/records/:id/stop',
    apiDoc({
      tag: 'Time',
      summary: 'Stop a Time Record',
      response: TimeRecordOut,
      description:
        'Close the caller’s human interval and record. Stopping time never changes a linked Task, Daily Plan Item, or Calendar Item state.',
    }),
    zParam(recordParam),
    async (c) => {
      const { user } = requireSession(c);
      return ok(c, TimeRecordOut, await stopTimeRecord(user.id, c.req.valid('param').id));
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
  .post(
    '/records/:id/contexts',
    apiDoc({
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
      return ok(
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
