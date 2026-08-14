import { describe, expect, it } from 'vitest';

import { matchWorkPlaceGeofence } from '@/components/work-location/geofence-match';

const POSITION = { latitude: 36.1699, longitude: -115.1398, accuracyMeters: 20 };

describe('matchWorkPlaceGeofence', () => {
  it('accepts only when distance plus reported accuracy fits within the radius', () => {
    expect(
      matchWorkPlaceGeofence(POSITION, [
        {
          id: 'inside',
          geofence: { latitude: 36.1699, longitude: -115.1398, radiusMeters: 20 },
        },
      ]),
    ).toBe('inside');

    expect(
      matchWorkPlaceGeofence(POSITION, [
        {
          id: 'outside',
          geofence: { latitude: 36.1702, longitude: -115.1398, radiusMeters: 50 },
        },
      ]),
    ).toBeNull();
  });

  it('chooses the smallest qualifying radius when regular places overlap', () => {
    expect(
      matchWorkPlaceGeofence(POSITION, [
        {
          id: 'broad-campus',
          geofence: { latitude: 36.1699, longitude: -115.1398, radiusMeters: 500 },
        },
        {
          id: 'reading-room',
          geofence: { latitude: 36.1699, longitude: -115.1398, radiusMeters: 75 },
        },
        { id: 'no-geofence', geofence: null },
      ]),
    ).toBe('reading-room');
  });
});
