import { afterEach, describe, expect, it, vi } from 'vitest';

import { startForegroundLocationReporter } from '@/components/work-location/foreground-location-reporter';

class FakeVisibility {
  visibilityState: 'visible' | 'hidden' = 'visible';
  private listener: (() => void) | null = null;

  addEventListener(_name: 'visibilitychange', listener: () => void): void {
    this.listener = listener;
  }

  removeEventListener(_name: 'visibilitychange', listener: () => void): void {
    if (this.listener === listener) this.listener = null;
  }

  set(state: 'visible' | 'hidden'): void {
    this.visibilityState = state;
    this.listener?.();
  }
}

describe('startForegroundLocationReporter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('watches only while visible and reports only the matched place plus accuracy', async () => {
    const placeId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const visibility = new FakeVisibility();
    let success: PositionCallback = () => undefined;
    const clearWatch = vi.fn();
    const geolocation = {
      watchPosition: vi.fn((next: PositionCallback) => {
        success = next;
        return 7;
      }),
      clearWatch,
    };
    const onObservation = vi.fn(async () => undefined);
    const stop = startForegroundLocationReporter({
      geolocation,
      visibility,
      places: [
        {
          id: placeId,
          geofence: { latitude: 36.1699, longitude: -115.1398, radiusMeters: 250 },
        },
      ],
      onObservation,
    });

    success({
      coords: {
        latitude: 36.1699,
        longitude: -115.1398,
        accuracy: 15,
      },
    } as GeolocationPosition);
    await Promise.resolve();
    expect(onObservation).toHaveBeenCalledWith({ placeId, accuracyMeters: 15 });
    const sent = (onObservation.mock.calls as unknown as [[Record<string, unknown>]])[0][0];
    expect(sent).not.toHaveProperty('latitude');

    visibility.set('hidden');
    expect(clearWatch).toHaveBeenCalledWith(7);
    visibility.set('visible');
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(2);
    stop();
    expect(clearWatch).toHaveBeenCalledTimes(2);
  });

  it('reports permission denial through application state without sending an observation', () => {
    let failure: PositionErrorCallback = () => undefined;
    const onObservation = vi.fn(async () => undefined);
    const onError = vi.fn();
    const stop = startForegroundLocationReporter({
      geolocation: {
        watchPosition: (_success, nextFailure) => {
          failure = nextFailure ?? (() => undefined);
          return 1;
        },
        clearWatch: vi.fn(),
      },
      visibility: new FakeVisibility(),
      places: [],
      onObservation,
      onError,
    });

    failure({ code: 1 } as GeolocationPositionError);
    expect(onError).toHaveBeenCalledWith('permission_denied');
    expect(onObservation).not.toHaveBeenCalled();
    stop();
  });

  it('refreshes matched evidence every five minutes only while visible', async () => {
    vi.useFakeTimers();
    const visibility = new FakeVisibility();
    let success: PositionCallback = () => undefined;
    const onObservation = vi.fn(async () => undefined);
    const stop = startForegroundLocationReporter({
      geolocation: {
        watchPosition: (next) => {
          success = next;
          return 11;
        },
        clearWatch: vi.fn(),
      },
      visibility,
      places: [
        {
          id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
          geofence: { latitude: 36.1699, longitude: -115.1398, radiusMeters: 250 },
        },
      ],
      onObservation,
    });

    success({
      coords: { latitude: 36.1699, longitude: -115.1398, accuracy: 12 },
    } as GeolocationPosition);
    await Promise.resolve();
    expect(onObservation).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(onObservation).toHaveBeenCalledTimes(2);

    visibility.set('hidden');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(onObservation).toHaveBeenCalledTimes(2);
    stop();
  });
});
