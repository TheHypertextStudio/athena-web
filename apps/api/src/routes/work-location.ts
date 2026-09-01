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
  WorkPlaceCreate,
  WorkPlaceListOut,
  WorkPlaceMutationOut,
  WorkPlaceUpdate,
} from '@docket/planning/work-location-contract';
import { WorkLocationAssertionId, WorkPlaceId } from '@docket/planning/ids';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv, AuthSession } from '../context';
import { AuthError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import {
  archiveWorkLocationAssertion,
  archiveWorkPlace,
  clearManualCurrentWorkLocation,
  clearWorkLocationOccurrence,
  createWorkLocationAssertion,
  createWorkPlace,
  enqueuePlaceWorkLocationProjections,
  enqueueProfileWorkLocationProjections,
  enqueueWorkLocationProjection,
  listWorkLocationAssertions,
  listWorkLocationSync,
  listWorkPlaces,
  loadWorkLocationResolutionState,
  recordDeviceWorkLocation,
  resolveWorkLocationHubId,
  setManualCurrentWorkLocation,
  setWorkLocationOccurrence,
  updateWorkLocationAssertion,
  updateWorkLocationProfile,
  updateWorkPlace,
  workLocationProjectionStates,
} from '../services/work-location/repository';
import {
  resolveExpectedWorkLocationRange,
  resolveWorkLocationPoint,
} from '@docket/planning/work-location-resolution';

/** Require the signed-in user on this Hub-owned surface. */
function requireSession(c: { get: (key: 'session') => AuthSession }): NonNullable<AuthSession> {
  const session = c.get('session');
  if (!session?.user) throw new AuthError();
  return session;
}

const placeParam = z.object({ id: WorkPlaceId }).strict();
const assertionParam = z.object({ id: WorkLocationAssertionId }).strict();
const occurrenceParam = z.object({ id: WorkLocationAssertionId, date: DateString }).strict();

/** Resolve the caller-owned Hub without accepting a Hub id from the request. */
async function callerHub(c: { get: (key: 'session') => AuthSession }): Promise<string> {
  return resolveWorkLocationHubId(requireSession(c).user.id);
}

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
  .get(
    '/places',
    apiDoc({
      tag: 'Work location',
      summary: 'List saved work places',
      response: WorkPlaceListOut,
      description:
        'List arbitrary regular places and the independent optional home designation. Places have no fixed home/office kind.',
    }),
    async (c) => ok(c, WorkPlaceListOut, await listWorkPlaces(db, await callerHub(c))),
  )
  .post(
    '/places',
    apiDoc({
      tag: 'Work location',
      summary: 'Create a saved work place',
      response: WorkPlaceMutationOut,
      status: 201,
      description:
        'Create an arbitrary named regular place. Provider classifications are account-aware mappings, not intrinsic place kinds.',
    }),
    zJson(WorkPlaceCreate),
    async (c) => {
      const hubId = await callerHub(c);
      const place = await createWorkPlace(db, hubId, c.req.valid('json'));
      return c.json(
        WorkPlaceMutationOut.parse({
          place,
          projections: await workLocationProjectionStates(db, hubId),
        }),
        201,
      );
    },
  )
  .patch(
    '/places/:id',
    apiDoc({
      tag: 'Work location',
      summary: 'Update a saved work place',
      response: WorkPlaceMutationOut,
      description:
        'Update a saved place and queue new projections for assertions whose rendered provider payload depends on it.',
    }),
    zParam(placeParam),
    zJson(WorkPlaceUpdate),
    async (c) => {
      const hubId = await callerHub(c);
      const { id } = c.req.valid('param');
      const place = await updateWorkPlace(db, hubId, id, c.req.valid('json'));
      return ok(c, WorkPlaceMutationOut, {
        place,
        projections: await enqueuePlaceWorkLocationProjections(db, hubId, id),
      });
    },
  )
  .delete(
    '/places/:id',
    apiDoc({
      tag: 'Work location',
      summary: 'Retire a saved work place',
      status: 204,
      description:
        'Retire an owned place. Active/future assertions and the independent home designation must be moved or cleared first.',
    }),
    zParam(placeParam),
    async (c) => {
      const hubId = await callerHub(c);
      await archiveWorkPlace(db, hubId, c.req.valid('param').id);
      return c.body(null, 204);
    },
  )
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
