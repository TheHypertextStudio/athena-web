/**
 * `domain packages` — arbitrary user-owned saved-place contracts.
 */
import { z } from 'zod';

import { CalendarConnectionId, WorkPlaceId } from '../ids';

export {
  WorkPlaceGeocodeCandidate,
  WorkPlaceGeocodeResolve,
  WorkPlaceGeocodeResult,
  WorkPlaceGeocodeSearchOut,
  WorkPlaceGeocodeSearchQuery,
  WorkPlaceReverseGeocode,
} from './work-place-geocode';

/** A user-authorized geofence stored as part of a saved-place definition. */
export const WorkPlaceGeofence = z
  .object({
    latitude: z.number().min(-90).max(90).describe('Geofence-center latitude in degrees.'),
    longitude: z.number().min(-180).max(180).describe('Geofence-center longitude in degrees.'),
    radiusMeters: z.number().min(50).max(2_000).describe('Matching radius in meters.'),
  })
  .strict()
  .meta({ id: 'WorkPlaceGeofence', description: 'A user-authorized saved-place geofence.' });
/** Saved-place geofence value. */
export type WorkPlaceGeofence = z.infer<typeof WorkPlaceGeofence>;

/** Provider-owned classification and place identifiers for one linked account. */
export const WorkPlaceProviderMapping = z
  .object({
    provider: z.string().min(1).describe('Provider id owning this mapping.'),
    connectionId: CalendarConnectionId.describe('Linked provider account owning this mapping.'),
    classification: z
      .string()
      .min(1)
      .describe('Provider-native classification, never a Docket place type.'),
    providerPlaceId: z.string().min(1).nullable().describe('Provider-native place identifier.'),
    metadata: z
      .record(z.string(), z.string())
      .describe('Provider-native string metadata needed to preserve the mapping.'),
  })
  .strict()
  .meta({
    id: 'WorkPlaceProviderMapping',
    description: 'An account-aware provider mapping for an arbitrary Docket saved place.',
  });
/** Saved-place provider-mapping value. */
export type WorkPlaceProviderMapping = z.infer<typeof WorkPlaceProviderMapping>;

const WorkPlaceFieldSchemas = {
  name: z.string().trim().min(1).max(120).describe('User-defined saved-place name.'),
  address: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .nullable()
    .describe('Optional private owner-facing address; never provider-projected.'),
  geofence: WorkPlaceGeofence.nullable().describe('Optional user-authorized geofence.'),
  providerMappings: z
    .array(WorkPlaceProviderMapping)
    .describe('Account-aware provider mappings; these do not classify the core place.'),
  sort: z.number().int().nonnegative().describe('Stable personal display order.'),
};

const WorkPlaceFields = {
  ...WorkPlaceFieldSchemas,
  address: WorkPlaceFieldSchemas.address.default(null),
  geofence: WorkPlaceFieldSchemas.geofence.default(null),
  providerMappings: WorkPlaceFieldSchemas.providerMappings.default([]),
  sort: WorkPlaceFieldSchemas.sort.default(0),
};

/** Input for creating one arbitrary named place; a name alone is sufficient. */
export const WorkPlaceCreate = z
  .object(WorkPlaceFields)
  .strict()
  .meta({ id: 'WorkPlaceCreate', description: 'Input for creating a saved work place.' });
/** Saved-place creation value. */
export type WorkPlaceCreate = z.input<typeof WorkPlaceCreate>;

/** Input for changing a saved place. */
export const WorkPlaceUpdate = z
  .object(WorkPlaceFieldSchemas)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one saved-place field is required')
  .meta({ id: 'WorkPlaceUpdate', description: 'A non-empty saved-place update.' });
/** Saved-place update value. */
export type WorkPlaceUpdate = z.infer<typeof WorkPlaceUpdate>;

/** Complete owner-visible saved-place representation. */
export const WorkPlaceOut = z
  .object({
    id: WorkPlaceId.describe('Saved-place id.'),
    ...WorkPlaceFields,
    archivedAt: z.iso.datetime().nullable().describe('Retirement time; null while active.'),
    createdAt: z.iso.datetime().describe('Saved-place creation time.'),
    updatedAt: z.iso.datetime().describe('Saved-place last-change time.'),
  })
  .strict()
  .meta({ id: 'WorkPlaceOut', description: 'One user-owned saved work place.' });
/** Saved-place output value. */
export type WorkPlaceOut = z.infer<typeof WorkPlaceOut>;

/** Minimal place identity safe to embed in resolved-location responses. */
export const WorkPlaceSummary = z
  .object({ id: WorkPlaceId, name: z.string() })
  .strict()
  .meta({ id: 'WorkPlaceSummary', description: 'Compact place identity without geofence.' });
/** Compact saved-place value. */
export type WorkPlaceSummary = z.infer<typeof WorkPlaceSummary>;
