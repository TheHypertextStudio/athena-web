/** Foreground-only browser location evidence for canonical work location. */
import { WorkPlaceId } from '@docket/planning/ids';
import { type WorkLocationObservationCreate } from '@docket/planning/work-location-contract';

import {
  matchWorkPlaceGeofence,
  type GeofencedWorkPlace,
  type LocalPositionEvidence,
} from './geofence-match';

const OBSERVATION_HEARTBEAT_MS = 5 * 60_000;

/** Minimum document surface required to enforce foreground-only watching. */
export interface WorkLocationVisibilitySource {
  readonly visibilityState: 'visible' | 'hidden' | 'prerender';
  addEventListener(name: 'visibilitychange', listener: () => void): void;
  removeEventListener(name: 'visibilitychange', listener: () => void): void;
}

/** Product-owned device evidence failure states. */
export type ForegroundLocationError =
  'permission_denied' | 'position_unavailable' | 'timed_out' | 'delivery_failed';

/** Inputs for one user-gesture-started foreground reporter. */
export interface ForegroundLocationReporterInput {
  readonly geolocation: Pick<Geolocation, 'watchPosition' | 'clearWatch'>;
  readonly visibility: WorkLocationVisibilitySource;
  readonly places: readonly GeofencedWorkPlace[];
  readonly onObservation: (observation: WorkLocationObservationCreate) => Promise<unknown>;
  readonly onError?: (error: ForegroundLocationError) => void;
}

/** Convert browser codes to stable, application-owned states. */
function locationError(error: GeolocationPositionError): ForegroundLocationError {
  if (error.code === 1) return 'permission_denied';
  if (error.code === 3) return 'timed_out';
  return 'position_unavailable';
}

/**
 * Start a visible-document geolocation watch and return its complete cleanup function.
 *
 * @remarks
 * The raw position is consumed only by {@link matchWorkPlaceGeofence}. The callback receives the
 * matched saved-place id and accuracy, never coordinates. The caller must invoke this function
 * from an explicit user gesture; the settings surface stores that opt-in per browser.
 */
export function startForegroundLocationReporter(
  input: ForegroundLocationReporterInput,
): () => void {
  let watchId: number | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let latest: WorkLocationObservationCreate | null = null;
  let lastMatch: string | null = null;

  const deliver = (): void => {
    if (!latest) return;
    void input.onObservation(latest).catch(() => input.onError?.('delivery_failed'));
  };
  const onPosition = (position: GeolocationPosition): void => {
    const evidence: LocalPositionEvidence = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMeters: position.coords.accuracy,
    };
    const match = matchWorkPlaceGeofence(evidence, input.places);
    const changed = match !== lastMatch;
    lastMatch = match;
    latest = match
      ? { placeId: WorkPlaceId.parse(match), accuracyMeters: position.coords.accuracy }
      : null;
    if (changed) deliver();
  };
  const stopVisible = (): void => {
    if (watchId !== null) input.geolocation.clearWatch(watchId);
    if (heartbeat !== null) clearInterval(heartbeat);
    watchId = null;
    heartbeat = null;
  };
  const startVisible = (): void => {
    if (watchId !== null || input.visibility.visibilityState !== 'visible') return;
    watchId = input.geolocation.watchPosition(
      onPosition,
      (error) => input.onError?.(locationError(error)),
      { enableHighAccuracy: false, maximumAge: OBSERVATION_HEARTBEAT_MS, timeout: 30_000 },
    );
    heartbeat = setInterval(deliver, OBSERVATION_HEARTBEAT_MS);
  };
  const onVisibilityChange = (): void => {
    if (input.visibility.visibilityState === 'visible') startVisible();
    else stopVisible();
  };

  input.visibility.addEventListener('visibilitychange', onVisibilityChange);
  startVisible();
  return () => {
    input.visibility.removeEventListener('visibilitychange', onVisibilityChange);
    stopVisible();
  };
}
