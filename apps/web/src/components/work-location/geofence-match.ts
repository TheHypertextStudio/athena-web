/** Browser-only saved-place geofence matching. */

/** A foreground position reading that never leaves the browser. */
export interface LocalPositionEvidence {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters: number;
}

/** The private geofence portion of one saved place. */
export interface GeofencedWorkPlace {
  readonly id: string;
  readonly geofence: {
    readonly latitude: number;
    readonly longitude: number;
    readonly radiusMeters: number;
  } | null;
}

const EARTH_RADIUS_METERS = 6_371_000;

/** Convert degrees to radians for the Haversine distance calculation. */
function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Return the great-circle distance between two latitude/longitude points in meters. */
function distanceMeters(
  left: Pick<LocalPositionEvidence, 'latitude' | 'longitude'>,
  right: Pick<LocalPositionEvidence, 'latitude' | 'longitude'>,
): number {
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const leftLatitude = radians(left.latitude);
  const rightLatitude = radians(right.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Match raw browser coordinates to one saved place without exposing coordinates to the service.
 *
 * @remarks
 * A reading qualifies only when its whole reported uncertainty circle fits within the geofence.
 * When geofences overlap, the smallest qualifying radius is the most specific regular place.
 */
export function matchWorkPlaceGeofence(
  position: LocalPositionEvidence,
  places: readonly GeofencedWorkPlace[],
): string | null {
  return (
    places
      .filter(
        (
          place,
        ): place is GeofencedWorkPlace & {
          geofence: NonNullable<GeofencedWorkPlace['geofence']>;
        } => {
          if (!place.geofence) return false;
          return (
            distanceMeters(position, place.geofence) + position.accuracyMeters <=
            place.geofence.radiusMeters
          );
        },
      )
      .sort((left, right) => left.geofence.radiusMeters - right.geofence.radiusMeters)[0]?.id ??
    null
  );
}
