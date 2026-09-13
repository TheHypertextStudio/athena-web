/**
 * `domain packages` — temporary and permanent saved-place geocoding contracts.
 */
import { z } from 'zod';

const WorkPlaceGeocodePointFields = {
  latitude: z.number().min(-90).max(90).describe('Latitude in degrees.'),
  longitude: z.number().min(-180).max(180).describe('Longitude in degrees.'),
};

/** Query for temporary saved-place address suggestions. */
export const WorkPlaceGeocodeSearchQuery = z
  .object({
    query: z
      .string()
      .trim()
      .min(3)
      .max(240)
      .refine((query) => !query.includes(';') && query.split(/\s+/u).length <= 20, {
        message: 'Address queries must contain at most 20 words and no semicolons',
      }),
  })
  .strict()
  .meta({
    id: 'WorkPlaceGeocodeSearchQuery',
    description: 'A bounded address-autocomplete query.',
  });
/** Saved-place address query value. */
export type WorkPlaceGeocodeSearchQuery = z.infer<typeof WorkPlaceGeocodeSearchQuery>;

/** One temporary address candidate that the owner may select. */
export const WorkPlaceGeocodeCandidate = z
  .object({
    id: z.string().trim().min(1).max(512).describe('Opaque provider feature identifier.'),
    address: z.string().trim().min(1).max(240).describe('Full display address.'),
    ...WorkPlaceGeocodePointFields,
  })
  .strict()
  .meta({ id: 'WorkPlaceGeocodeCandidate', description: 'One temporary address candidate.' });
/** Temporary address candidate value. */
export type WorkPlaceGeocodeCandidate = z.infer<typeof WorkPlaceGeocodeCandidate>;

/** Temporary autocomplete candidates and the provider attribution they require. */
export const WorkPlaceGeocodeSearchOut = z
  .object({
    items: z.array(WorkPlaceGeocodeCandidate).max(5),
    attribution: z.string().trim().min(1).max(240),
  })
  .strict()
  .meta({ id: 'WorkPlaceGeocodeSearchOut', description: 'Address-autocomplete results.' });
/** Address-autocomplete response value. */
export type WorkPlaceGeocodeSearchOut = z.infer<typeof WorkPlaceGeocodeSearchOut>;

/** Input that permanently resolves one selected provider feature. */
export const WorkPlaceGeocodeResolve = z
  .object({
    id: z.string().trim().min(1).max(512),
    address: z.string().trim().min(1).max(240),
  })
  .strict()
  .meta({ id: 'WorkPlaceGeocodeResolve', description: 'Permanent feature-resolution input.' });
/** Permanent feature-resolution input value. */
export type WorkPlaceGeocodeResolve = z.infer<typeof WorkPlaceGeocodeResolve>;

/** Input that permanently reverse-geocodes one selected point. */
export const WorkPlaceReverseGeocode = z
  .object(WorkPlaceGeocodePointFields)
  .strict()
  .meta({ id: 'WorkPlaceReverseGeocode', description: 'Permanent reverse-geocoding input.' });
/** Reverse-geocoding input value. */
export type WorkPlaceReverseGeocode = z.infer<typeof WorkPlaceReverseGeocode>;

/** Canonical address and point returned by permanent geocoding. */
export const WorkPlaceGeocodeResult = WorkPlaceGeocodeCandidate.meta({
  id: 'WorkPlaceGeocodeResult',
  description: 'A permanently resolved address and point.',
});
/** Permanently resolved address value. */
export type WorkPlaceGeocodeResult = z.infer<typeof WorkPlaceGeocodeResult>;
