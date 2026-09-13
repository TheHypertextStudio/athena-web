/** Saved-place and geocoding routes for the personal work-location surface. */
import { db } from '@docket/db';
import {
  WorkPlaceCreate,
  WorkPlaceGeocodeResolve,
  WorkPlaceGeocodeResult,
  WorkPlaceGeocodeSearchOut,
  WorkPlaceGeocodeSearchQuery,
  WorkPlaceListOut,
  WorkPlaceMutationOut,
  WorkPlaceReverseGeocode,
  WorkPlaceUpdate,
} from '@docket/planning/work-location-contract';
import { WorkPlaceId } from '@docket/planning/ids';
import { Hono } from 'hono';
import { z } from 'zod';

import { getContainer } from '../container';
import type { AppEnv } from '../context';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import {
  archiveWorkPlace,
  createWorkPlace,
  enqueuePlaceWorkLocationProjections,
  listWorkPlaces,
  updateWorkPlace,
  workLocationProjectionStates,
} from '../services/work-location/repository';

import { callerHub, geocodeForUser, requireSession } from './work-location-route-context';

const placeParam = z.object({ id: WorkPlaceId }).strict();

/** Saved places mounted inside `/v1/me/work-location`. */
export const workPlaceRoutes = new Hono<AppEnv>()
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
  .get(
    '/places/geocoding/search',
    apiDoc({
      tag: 'Work location',
      summary: 'Search saved-place addresses',
      response: WorkPlaceGeocodeSearchOut,
      description:
        'Return temporary Mapbox autocomplete candidates. A selected candidate must be permanently resolved before storage.',
    }),
    zQuery(WorkPlaceGeocodeSearchQuery),
    async (c) => {
      const userId = requireSession(c).user.id;
      const { query } = c.req.valid('query');
      return ok(
        c,
        WorkPlaceGeocodeSearchOut,
        await geocodeForUser(userId, () => getContainer().placeGeocoder.search(query)),
      );
    },
  )
  .post(
    '/places/geocoding/resolutions',
    apiDoc({
      tag: 'Work location',
      summary: 'Resolve a saved-place address',
      response: WorkPlaceGeocodeResult,
      description: 'Permanently resolve the Mapbox feature selected from temporary search results.',
    }),
    zJson(WorkPlaceGeocodeResolve),
    async (c) => {
      const userId = requireSession(c).user.id;
      const candidate = c.req.valid('json');
      return ok(
        c,
        WorkPlaceGeocodeResult,
        await geocodeForUser(userId, () => getContainer().placeGeocoder.resolve(candidate)),
      );
    },
  )
  .post(
    '/places/geocoding/reverse',
    apiDoc({
      tag: 'Work location',
      summary: 'Suggest an address for a saved-place point',
      response: WorkPlaceGeocodeResult,
      description:
        'Permanently reverse-geocode a map or device point. The client offers the address before replacing saved text.',
    }),
    zJson(WorkPlaceReverseGeocode),
    async (c) => {
      const userId = requireSession(c).user.id;
      const point = c.req.valid('json');
      return ok(
        c,
        WorkPlaceGeocodeResult,
        await geocodeForUser(userId, () => getContainer().placeGeocoder.reverse(point)),
      );
    },
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
        'Retire an owned place. Current and future schedule references and the independent home designation must be moved or cleared first.',
    }),
    zParam(placeParam),
    async (c) => {
      const hubId = await callerHub(c);
      await archiveWorkPlace(db, hubId, c.req.valid('param').id);
      return c.body(null, 204);
    },
  );
