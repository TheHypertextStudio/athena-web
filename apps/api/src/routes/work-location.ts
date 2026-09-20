/** Authenticated personal work-location source-of-truth routes. */
import { db } from '@docket/db';
import { DateString } from '@docket/planning/date-time';
import {
  WorkLocationAssertionCreate,
  WorkLocationAssertionListOut,
  WorkLocationAssertionMutationOut,
  WorkLocationAssertionUpdate,
  WorkLocationCurrentUpdate,
  WorkLocationObservationCreate,
  WorkLocationOccurrenceException,
  WorkLocationPointOut,
  WorkLocationPointQuery,
  WorkLocationProfileMutationOut,
  WorkLocationProfileUpdate,
  WorkLocationRangeOut,
  WorkLocationRangeQuery,
  WorkLocationSyncOut,
  WorkScheduleChangeListOut,
  WorkScheduleChangeResolution,
  WorkScheduleExceptionCreate,
  WorkScheduleExceptionOut,
  WorkScheduleOut,
  WorkSchedulePlanCreate,
  WorkSchedulePlanOut,
} from '@docket/planning/work-location-contract';
import { WorkLocationAssertionId, WorkScheduleChangeId } from '@docket/planning/ids';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { conditionalWriteFor } from '../lib/work-schedule-conditional';
import {
  archiveWorkLocationAssertion,
  clearManualCurrentWorkLocation,
  clearWorkLocationOccurrence,
  createWorkLocationAssertion,
  enqueueProfileWorkLocationProjections,
  enqueueWorkLocationProjection,
  listWorkLocationAssertions,
  listWorkLocationSync,
  loadWorkLocationResolutionState,
  recordDeviceWorkLocation,
  setManualCurrentWorkLocation,
  setWorkLocationOccurrence,
  updateWorkLocationAssertion,
  updateWorkLocationProfile,
} from '../services/work-location/repository';
import {
  ignoreWorkScheduleChange,
  listWorkScheduleChanges,
  linkWorkPlaceAlias,
  readVersionedWorkSchedule,
  replaceWorkSchedulePlan,
  resolveWorkScheduleConflict,
  setWorkScheduleException,
} from '../services/work-location/schedule-repository';
import {
  resolveExpectedWorkLocationRange,
  resolveWorkLocationPoint,
} from '@docket/planning/work-location-resolution';
import { callerHub } from './work-location-route-context';
import { workPlaceRoutes } from './work-place-routes';

const assertionParam = z.object({ id: WorkLocationAssertionId }).strict();
const occurrenceParam = z.object({ id: WorkLocationAssertionId, date: DateString }).strict();
const scheduleDateParam = z.object({ date: DateString }).strict();
const scheduleChangeParam = z.object({ id: WorkScheduleChangeId }).strict();

/** Personal canonical work-location routes mounted at `/v1/me/work-location`. */
const workLocation = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Work location',
      summary: 'Resolve current and expected work location',
      response: WorkLocationPointOut,
      description:
        'Return independent current and expected answers at an RFC 3339 instant. The caller-owned personal Hub is the only authority; provider rows are evidence and projections, never an alternate read model.',
    }),
    zQuery(WorkLocationPointQuery),
    async (c) => {
      const at = new Date(c.req.valid('query').at ?? Date.now());
      const hubId = await callerHub(c);
      const state = await loadWorkLocationResolutionState(db, hubId);
      return ok(c, WorkLocationPointOut, resolveWorkLocationPoint({ at, state }));
    },
  )
  .get(
    '/range',
    apiDoc({
      tag: 'Work location',
      summary: 'Resolve an expected-location range',
      response: WorkLocationRangeOut,
      description:
        'Return ordered, non-overlapping expected-location segments across a half-open instant range, including explicitly unknown gaps.',
    }),
    zQuery(WorkLocationRangeQuery),
    async (c) => {
      const query = c.req.valid('query');
      const hubId = await callerHub(c);
      const state = await loadWorkLocationResolutionState(db, hubId);
      return ok(
        c,
        WorkLocationRangeOut,
        resolveExpectedWorkLocationRange({
          start: new Date(query.start),
          end: new Date(query.end),
          state,
        }),
      );
    },
  )
  .route('/', workPlaceRoutes)
  .put(
    '/profile',
    apiDoc({
      tag: 'Work location',
      summary: 'Set work-location designations',
      response: WorkLocationProfileMutationOut,
      description:
        'Set or clear the singular home place independently of saved-place identity, then re-project affected assertions.',
    }),
    zJson(WorkLocationProfileUpdate),
    async (c) => {
      const hubId = await callerHub(c);
      const profile = await updateWorkLocationProfile(db, hubId, c.req.valid('json'));
      return ok(c, WorkLocationProfileMutationOut, {
        profile,
        projections: await enqueueProfileWorkLocationProjections(db, hubId),
      });
    },
  )
  .get(
    '/changes',
    apiDoc({
      tag: 'Work location',
      summary: 'List unresolved work-schedule changes',
      response: WorkScheduleChangeListOut,
      description:
        'Return provider and migration changes that still need an owner decision. Recognized provider changes never appear here.',
    }),
    async (c) =>
      ok(c, WorkScheduleChangeListOut, await listWorkScheduleChanges(db, await callerHub(c))),
  )
  .patch(
    '/changes/:id',
    apiDoc({
      tag: 'Work location',
      summary: 'Resolve one work-schedule change',
      status: 204,
      description:
        'Link or ignore an unmatched provider label, preserve a newer Docket date, or accept the connected-account version of that date.',
    }),
    zParam(scheduleChangeParam),
    zJson(WorkScheduleChangeResolution),
    async (c) => {
      const hubId = await callerHub(c);
      const { id } = c.req.valid('param');
      const resolution = c.req.valid('json');
      if (resolution.action === 'link_place') {
        await linkWorkPlaceAlias(db, hubId, id, resolution.placeId);
      } else if (resolution.action === 'keep_docket' || resolution.action === 'use_provider') {
        await resolveWorkScheduleConflict(db, hubId, id, resolution.action);
      } else {
        await ignoreWorkScheduleChange(db, hubId, id);
      }
      return c.body(null, 204);
    },
  )
  .get(
    '/schedule',
    apiDoc({
      tag: 'Work location',
      summary: 'List the default work schedule',
      response: WorkScheduleOut,
      description:
        'Return effective-dated default plan versions and complete dated replacements for the caller-owned personal Hub.',
    }),
    async (c) => {
      const result = await readVersionedWorkSchedule(db, await callerHub(c));
      c.header('ETag', result.etag);
      return ok(c, WorkScheduleOut, result.value);
    },
  )
  .put(
    '/schedule',
    conditionalWriteFor('work-schedule'),
    apiDoc({
      tag: 'Work location',
      summary: 'Start a new default work-schedule version',
      response: WorkSchedulePlanOut,
      description:
        'Create a complete plan version from its effective date and close the preceding version without changing historical dates.',
    }),
    zJson(WorkSchedulePlanCreate),
    async (c) =>
      ok(
        c,
        WorkSchedulePlanOut,
        await replaceWorkSchedulePlan(
          db,
          await callerHub(c),
          c.req.valid('json'),
          c.req.header('If-Match'),
        ),
      ),
  )
  .put(
    '/schedule/dates/:date',
    conditionalWriteFor('work-schedule'),
    apiDoc({
      tag: 'Work location',
      summary: 'Replace one date in the default work schedule',
      response: WorkScheduleExceptionOut,
      description:
        'Replace every generated work segment on one civil date, including an empty replacement for a day off.',
    }),
    zParam(scheduleDateParam),
    zJson(WorkScheduleExceptionCreate),
    async (c) => {
      const date = c.req.valid('param').date;
      const input = c.req.valid('json');
      if (input.date !== date) throw new ConflictError('Schedule date does not match the route');
      return ok(
        c,
        WorkScheduleExceptionOut,
        await setWorkScheduleException(db, await callerHub(c), input, c.req.header('If-Match')),
      );
    },
  )
  .get(
    '/assertions',
    apiDoc({
      tag: 'Work location',
      summary: 'List explicit work-location assertions',
      response: WorkLocationAssertionListOut,
    }),
    async (c) =>
      ok(c, WorkLocationAssertionListOut, await listWorkLocationAssertions(db, await callerHub(c))),
  )
  .post(
    '/assertions',
    apiDoc({
      tag: 'Work location',
      summary: 'Create a work-location assertion',
      response: WorkLocationAssertionMutationOut,
      status: 201,
      description:
        'Create a one-off or weekly canonical assertion immediately; linked-provider delivery is eventually consistent and reported per account.',
    }),
    zJson(WorkLocationAssertionCreate),
    async (c) => {
      const hubId = await callerHub(c);
      const assertion = await createWorkLocationAssertion(db, hubId, c.req.valid('json'));
      return c.json(
        WorkLocationAssertionMutationOut.parse({
          assertion,
          projections: await enqueueWorkLocationProjection(db, hubId, assertion, 'create'),
        }),
        201,
      );
    },
  )
  .patch(
    '/assertions/:id',
    apiDoc({
      tag: 'Work location',
      summary: 'Update a work-location assertion',
      response: WorkLocationAssertionMutationOut,
    }),
    zParam(assertionParam),
    zJson(WorkLocationAssertionUpdate),
    async (c) => {
      const hubId = await callerHub(c);
      const assertion = await updateWorkLocationAssertion(
        db,
        hubId,
        c.req.valid('param').id,
        c.req.valid('json'),
      );
      return ok(c, WorkLocationAssertionMutationOut, {
        assertion,
        projections: await enqueueWorkLocationProjection(db, hubId, assertion, 'update'),
      });
    },
  )
  .delete(
    '/assertions/:id',
    apiDoc({
      tag: 'Work location',
      summary: 'Delete a work-location assertion',
      status: 204,
      description: 'Archive the canonical assertion immediately and fan out provider deletes.',
    }),
    zParam(assertionParam),
    async (c) => {
      const hubId = await callerHub(c);
      const assertion = await archiveWorkLocationAssertion(db, hubId, c.req.valid('param').id);
      await enqueueWorkLocationProjection(db, hubId, assertion, 'delete');
      return c.body(null, 204);
    },
  )
  .put(
    '/assertions/:id/occurrences/:date',
    apiDoc({
      tag: 'Work location',
      summary: 'Cancel or replace one weekly occurrence',
      response: WorkLocationAssertionMutationOut,
    }),
    zParam(occurrenceParam),
    zJson(WorkLocationOccurrenceException),
    async (c) => {
      const hubId = await callerHub(c);
      const params = c.req.valid('param');
      const assertion = await setWorkLocationOccurrence(
        db,
        hubId,
        params.id,
        params.date,
        c.req.valid('json'),
      );
      return ok(c, WorkLocationAssertionMutationOut, {
        assertion,
        projections: await enqueueWorkLocationProjection(
          db,
          hubId,
          assertion,
          'update',
          params.date,
        ),
      });
    },
  )
  .delete(
    '/assertions/:id/occurrences/:date',
    apiDoc({
      tag: 'Work location',
      summary: 'Restore one weekly occurrence',
      response: WorkLocationAssertionMutationOut,
    }),
    zParam(occurrenceParam),
    async (c) => {
      const hubId = await callerHub(c);
      const params = c.req.valid('param');
      const assertion = await clearWorkLocationOccurrence(db, hubId, params.id, params.date);
      return ok(c, WorkLocationAssertionMutationOut, {
        assertion,
        projections: await enqueueWorkLocationProjection(
          db,
          hubId,
          assertion,
          'update',
          params.date,
        ),
      });
    },
  )
  .put(
    '/current',
    apiDoc({
      tag: 'Work location',
      summary: 'Set a manual current-location override',
      status: 204,
      description:
        'Set a time-bounded manual current location. Omitted expiry defaults to the end of the Hub-local day and is not projected as Google schedule.',
    }),
    zJson(WorkLocationCurrentUpdate),
    async (c) => {
      await setManualCurrentWorkLocation(db, await callerHub(c), c.req.valid('json'));
      return c.body(null, 204);
    },
  )
  .delete(
    '/current',
    apiDoc({
      tag: 'Work location',
      summary: 'Clear a manual current-location override',
      status: 204,
    }),
    async (c) => {
      await clearManualCurrentWorkLocation(db, await callerHub(c));
      return c.body(null, 204);
    },
  )
  .post(
    '/observations',
    apiDoc({
      tag: 'Work location',
      summary: 'Record matched foreground-device evidence',
      status: 204,
      description:
        'Accept only a user-owned saved-place id and reported accuracy. The strict body rejects coordinates structurally; raw observations never cross this boundary.',
    }),
    zJson(WorkLocationObservationCreate),
    async (c) => {
      await recordDeviceWorkLocation(db, await callerHub(c), c.req.valid('json'));
      return c.body(null, 204);
    },
  )
  .get(
    '/sync-state',
    apiDoc({
      tag: 'Work location',
      summary: 'Get linked-account work-location sync state',
      response: WorkLocationSyncOut,
      description:
        'Return provider capability, bootstrap, queued delivery, unsupported, and action-required state independently for every linked account.',
    }),
    async (c) => ok(c, WorkLocationSyncOut, await listWorkLocationSync(db, await callerHub(c))),
  );

export default workLocation;
