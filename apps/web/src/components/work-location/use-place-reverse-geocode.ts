'use client';

/** Permanent reverse-geocoding mutation for a map-selected place point. */
import type { WorkPlaceGeocodeResult } from '@docket/planning/work-location-contract';
import type { DefaultError, UseMutationResult } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { unwrap, useApiMutation } from '@/lib/query';

import type { PlaceMapPoint } from './place-map-picker';

const REVERSE_FAILURE_TITLE = 'Docket could not suggest an address for that point.';

/**
 * Reverse-geocode points and deliver application-safe results to one editor.
 *
 * A failed lookup is presented as a notice by the mutation itself; the editor keeps the point the
 * person chose and shows nothing inline.
 */
export function usePlaceReverseGeocode(
  onResolved: (result: WorkPlaceGeocodeResult) => void,
): UseMutationResult<WorkPlaceGeocodeResult, DefaultError, PlaceMapPoint> {
  return useApiMutation({
    mutationFn: (point: PlaceMapPoint) =>
      unwrap(
        () => api.v1.me['work-location'].places.geocoding.reverse.$post({ json: point }),
        REVERSE_FAILURE_TITLE,
      ),
    failureTitle: REVERSE_FAILURE_TITLE,
    onSuccess: onResolved,
  });
}
