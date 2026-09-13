/** Shared caller and provider boundaries for personal work-location routes. */
import { db } from '@docket/db';

import type { AuthSession } from '../context';
import { AuthError, GeocodingUnavailableError } from '../error';
import { consumeGeocodingRequest } from '../services/work-location/geocoding-rate-limit';
import { PlaceGeocoderUnavailable } from '../services/work-location/place-geocoder';
import { resolveWorkLocationHubId } from '../services/work-location/repository';

/** Require the signed-in user on this Hub-owned surface. */
export function requireSession(c: {
  get: (key: 'session') => AuthSession;
}): NonNullable<AuthSession> {
  const session = c.get('session');
  if (!session?.user) throw new AuthError();
  return session;
}

/** Resolve the caller-owned Hub without accepting a Hub id from the request. */
export async function callerHub(c: { get: (key: 'session') => AuthSession }): Promise<string> {
  return resolveWorkLocationHubId(requireSession(c).user.id);
}

/** Apply the caller-level quota and normalize provider outages for one geocoding request. */
export async function geocodeForUser<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  await consumeGeocodingRequest(db, userId);
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PlaceGeocoderUnavailable) throw new GeocodingUnavailableError();
    throw error;
  }
}
