'use client';

/** Persistent foreground location matching for the authenticated Docket app. */
import type { WorkLocationObservationCreate } from '@docket/planning/work-location-contract';
import { readStoredBoolean, writeStoredValue } from '@docket/ui/lib/browser-storage';
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { api } from '@/lib/api';
import { queryKeys, useApiListQuery, useApiMutation } from '@/lib/query';

import {
  startForegroundLocationReporter,
  type ForegroundLocationError,
} from './foreground-location-reporter';
import { workLocationPlacesDef } from './work-location-data';

const DEVICE_OPT_IN_KEY = 'docket.work-location.device-opt-in';

/** State and controls exposed to the Places settings surface. */
export interface AutomaticLocationContextValue {
  /** Whether this browser provides the geolocation API. */
  readonly available: boolean;
  /** Whether the person enabled foreground matching for this browser. */
  readonly enabled: boolean;
  /** Current product-owned reporter status. */
  readonly status: string | null;
  /** Persist and apply the person's browser-level preference. */
  readonly setEnabled: (enabled: boolean) => void;
}

const AutomaticLocationContext = createContext<AutomaticLocationContextValue | null>(null);

function deviceErrorCopy(error: ForegroundLocationError): string {
  if (error === 'permission_denied') return 'Location permission is off for this browser.';
  if (error === 'timed_out') return 'This browser could not get a fresh position in time.';
  if (error === 'delivery_failed') return 'Docket could not record the matched place.';
  return 'This browser could not determine its position.';
}

async function recordObservation(observation: WorkLocationObservationCreate): Promise<void> {
  const response: { readonly ok: boolean } = await api.v1.me['work-location'].observations.$post({
    json: observation,
  });
  if (!response.ok) throw new Error('Docket could not record the matched work place');
}

/** Keep an opted-in location watcher alive while any authenticated Docket route is open. */
export function AutomaticLocationProvider(props: { readonly children: ReactNode }): JSX.Element {
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const placesQ = useApiListQuery({
    ...workLocationPlacesDef(),
    enabled: preferenceLoaded && enabled,
  });
  const places = useMemo(() => placesQ.data?.items ?? [], [placesQ.data]);
  const mappedPlaceCount = places.filter((place) => place.geofence !== null).length;
  const observation = useApiMutation({
    mutationFn: recordObservation,
    invalidateKeys: [queryKeys.workLocation()],
  });
  const sendObservation = observation.mutateAsync;

  useEffect(() => {
    const supportsLocation = 'geolocation' in navigator;
    const stored = readStoredBoolean(DEVICE_OPT_IN_KEY) ?? false;
    setAvailable(supportsLocation);
    setEnabledState(supportsLocation && stored);
    setPreferenceLoaded(true);
    if (!supportsLocation) setStatus('This browser does not provide location access.');
  }, []);

  const setEnabled = useCallback(
    (next: boolean): void => {
      if (next && !available) return;
      setEnabledState(next);
      writeStoredValue(DEVICE_OPT_IN_KEY, next);
      setStatus(next ? 'Starting automatic location…' : 'Automatic location is off.');
    },
    [available],
  );

  useEffect(() => {
    if (!enabled || !available || mappedPlaceCount === 0) return;
    setStatus('Automatic location is active while Docket is visible.');
    return startForegroundLocationReporter({
      geolocation: navigator.geolocation,
      visibility: document,
      places,
      onObservation: async (next) => {
        await sendObservation(next);
        setStatus('Current place matched.');
      },
      onError: (error) => {
        setStatus(deviceErrorCopy(error));
        if (error === 'permission_denied') {
          setEnabledState(false);
          writeStoredValue(DEVICE_OPT_IN_KEY, false);
        }
      },
    });
  }, [available, enabled, mappedPlaceCount, places, sendObservation]);

  const value = useMemo<AutomaticLocationContextValue>(
    () => ({ available, enabled, status, setEnabled }),
    [available, enabled, setEnabled, status],
  );
  return (
    <AutomaticLocationContext.Provider value={value}>
      {props.children}
    </AutomaticLocationContext.Provider>
  );
}

/** Read the app-wide foreground location preference and status. */
export function useAutomaticLocation(): AutomaticLocationContextValue {
  const value = useContext(AutomaticLocationContext);
  if (!value) throw new Error('useAutomaticLocation requires AutomaticLocationProvider');
  return value;
}
