'use client';

/** Personal saved places, expected-location schedules, device evidence, and provider sync. */
import type {
  WorkLocationAssertionCreate,
  WorkLocationOccurrenceException,
  WorkLocationSchedule,
  WorkPlaceOut,
  WorkPlaceUpdate,
} from '@docket/types';
import { Badge, Button, Input, Select, Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX, type SubmitEventHandler, useEffect, useMemo, useState } from 'react';

import { readStoredBoolean, writeStoredValue } from '@docket/ui/lib/browser-storage';

import { CalendarTimeField } from '@/components/calendar/calendar-time-field';
import {
  fromLocalInputValue,
  type LocalInputOccurrence,
  localInputResolutionError,
} from '@/components/calendar/datetime-input';
import { DatePicker } from '@/components/date-picker';
import { scheduleInstantAt, resolveScheduleTimezone } from '@/components/scheduling';
import { SectionHeader } from '@/components/settings/section-header';
import {
  startForegroundLocationReporter,
  type ForegroundLocationError,
} from '@/components/work-location/foreground-location-reporter';
import {
  workLocationAssertionsDef,
  workLocationPlacesDef,
  workLocationSyncDef,
} from '@/components/work-location/work-location-data';
import { api } from '@/lib/api';
import { UserFacingError, toUserFacingError, userErrorMessage } from '@/lib/problem';
import {
  apiQueryOptions,
  queryKeys,
  STALE,
  unwrap,
  useApiListQuery,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';

const DEVICE_OPT_IN_KEY = 'docket.work-location.device-opt-in';
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
type ScheduleMode = WorkLocationSchedule['type'];

/** Return a local `HH:mm` value as minutes after midnight. */
function timeMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}

/** Short owner-facing summary of a canonical assertion schedule. */
function scheduleSummary(schedule: WorkLocationSchedule): string {
  if (schedule.type === 'one_off_all_day') return `${schedule.date} · all day`;
  if (schedule.type === 'one_off_timed') {
    return `${new Date(schedule.startsAt).toLocaleString()}–${new Date(schedule.endsAt).toLocaleTimeString()}`;
  }
  const days = schedule.weekdays.map((day) => WEEKDAYS[day]).join(', ');
  if (schedule.type === 'weekly_all_day') return `${days} · all day from ${schedule.effectiveFrom}`;
  const startHour = Math.floor(schedule.startMinute / 60);
  const startMinute = schedule.startMinute % 60;
  const endHour = Math.floor(schedule.endMinute / 60);
  const endMinute = schedule.endMinute % 60;
  return `${days} · ${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}–${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`;
}

/** Humanize provider vocabulary while keeping it visibly provider-owned. */
function providerClassificationLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLocaleLowerCase();
}

/** Execute a response-without-body mutation using only application-owned failure copy. */
async function noContent(
  call: () => Promise<{ readonly ok: boolean; readonly status: number }>,
  fallback: string,
): Promise<void> {
  try {
    const response = await call();
    if (!response.ok) throw new UserFacingError(fallback, { status: response.status });
  } catch (error) {
    throw toUserFacingError(error, fallback);
  }
}

/** Stable application copy for browser geolocation failures. */
function deviceErrorCopy(error: ForegroundLocationError): string {
  if (error === 'permission_denied') return 'Location permission is off for this browser.';
  if (error === 'timed_out') return 'This browser could not get a fresh position in time.';
  if (error === 'delivery_failed') return 'The matched place could not be recorded.';
  return 'This browser could not determine its position.';
}

/** The user-owned Work locations settings destination. */
export default function WorkLocationsSettingsPage(): JSX.Element {
  const placesQ = useApiListQuery(workLocationPlacesDef());
  const assertionsQ = useApiListQuery(workLocationAssertionsDef());
  const syncQ = useApiQuery(workLocationSyncDef());
  const preferencesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.hubPreferences(),
      () => api.v1.hub.preferences.$get(),
      'Could not load your work-location timezone.',
      { staleTime: STALE.standard },
    ),
  );
  const schedulingQ = useApiQuery(
    apiQueryOptions(
      queryKeys.schedulePreferences(),
      () => api.v1['schedule-week'].preferences.$get(),
      'Could not load standing commitments.',
      { staleTime: STALE.standard },
    ),
  );
  const timezone = resolveScheduleTimezone(preferencesQ.data?.timezone);

  const [newPlaceName, setNewPlaceName] = useState('');
  const [placeNames, setPlaceNames] = useState<Record<string, string>>({});
  const [radii, setRadii] = useState<Record<string, number>>({});
  const [placeId, setPlaceId] = useState('');
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('one_off_all_day');
  const [date, setDate] = useState('');
  const [effectiveUntil, setEffectiveUntil] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [startOccurrence, setStartOccurrence] = useState<LocalInputOccurrence | null>(null);
  const [endOccurrence, setEndOccurrence] = useState<LocalInputOccurrence | null>(null);
  const [weekdays, setWeekdays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [occurrenceDates, setOccurrenceDates] = useState<Record<string, string>>({});
  const [occurrencePlaces, setOccurrencePlaces] = useState<Record<string, string>>({});
  const [seriesPlaces, setSeriesPlaces] = useState<Record<string, string>>({});
  const [deviceOptedIn, setDeviceOptedIn] = useState(false);
  const [deviceActive, setDeviceActive] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  useEffect(() => {
    setDeviceOptedIn(readStoredBoolean(DEVICE_OPT_IN_KEY) ?? false);
  }, []);
  useEffect(() => {
    if (!placesQ.data) return;
    setPlaceNames(Object.fromEntries(placesQ.data.items.map((place) => [place.id, place.name])));
    setRadii(
      Object.fromEntries(
        placesQ.data.items.map((place) => [place.id, place.geofence?.radiusMeters ?? 250]),
      ),
    );
    setPlaceId((current) => (current.length > 0 ? current : (placesQ.data.items[0]?.id ?? '')));
    setOccurrencePlaces((current) =>
      Object.fromEntries(
        assertionsQ.data?.items.map((assertion) => [
          assertion.id,
          current[assertion.id] ?? assertion.placeId,
        ]) ?? [],
      ),
    );
    setSeriesPlaces((current) =>
      Object.fromEntries(
        assertionsQ.data?.items.map((assertion) => [
          assertion.id,
          current[assertion.id] ?? assertion.placeId,
        ]) ?? [],
      ),
    );
  }, [assertionsQ.data?.items, placesQ.data]);

  const invalidateAll = [queryKeys.workLocation()];
  const createPlace = useApiMutation({
    mutationFn: (name: string) =>
      unwrap(
        () =>
          api.v1.me['work-location'].places.$post({
            json: { name, geofence: null, providerMappings: [], sort: 0 },
          }),
        'Could not add that saved place.',
      ),
    invalidateKeys: invalidateAll,
    onSuccess: () => {
      setNewPlaceName('');
    },
  });
  const updatePlace = useApiMutation({
    mutationFn: ({ id, patch }: { id: WorkPlaceOut['id']; patch: WorkPlaceUpdate }) =>
      unwrap(
        () => api.v1.me['work-location'].places[':id'].$patch({ param: { id }, json: patch }),
        'Could not update that saved place.',
      ),
    invalidateKeys: invalidateAll,
  });
  const retirePlace = useApiMutation({
    mutationFn: (id: WorkPlaceOut['id']) =>
      noContent(
        () => api.v1.me['work-location'].places[':id'].$delete({ param: { id } }),
        'Could not retire that saved place.',
      ),
    invalidateKeys: invalidateAll,
  });
  const setProfile = useApiMutation({
    mutationFn: (homePlaceId: WorkPlaceOut['id'] | null) =>
      unwrap(
        () => api.v1.me['work-location'].profile.$put({ json: { homePlaceId } }),
        'Could not update your home designation.',
      ),
    invalidateKeys: invalidateAll,
  });
  const createAssertion = useApiMutation({
    mutationFn: (input: WorkLocationAssertionCreate) =>
      unwrap(
        () => api.v1.me['work-location'].assertions.$post({ json: input }),
        'Could not add that work-location schedule.',
      ),
    invalidateKeys: invalidateAll,
  });
  const updateAssertion = useApiMutation({
    mutationFn: ({ id, nextPlaceId }: { id: string; nextPlaceId: WorkPlaceOut['id'] }) =>
      unwrap(
        () =>
          api.v1.me['work-location'].assertions[':id'].$patch({
            param: { id },
            json: { placeId: nextPlaceId },
          }),
        'Could not update that whole series.',
      ),
    invalidateKeys: invalidateAll,
  });
  const deleteAssertion = useApiMutation({
    mutationFn: (id: string) =>
      noContent(
        () => api.v1.me['work-location'].assertions[':id'].$delete({ param: { id } }),
        'Could not delete that work-location schedule.',
      ),
    invalidateKeys: invalidateAll,
  });
  const setOccurrence = useApiMutation({
    mutationFn: ({
      id,
      date: occurrenceDate,
      input,
    }: {
      id: string;
      date: string;
      input: WorkLocationOccurrenceException;
    }) =>
      unwrap(
        () =>
          api.v1.me['work-location'].assertions[':id'].occurrences[':date'].$put({
            param: { id, date: occurrenceDate },
            json: input,
          }),
        'Could not update that occurrence.',
      ),
    invalidateKeys: invalidateAll,
  });
  const clearOccurrence = useApiMutation({
    mutationFn: ({ id, date: occurrenceDate }: { id: string; date: string }) =>
      unwrap(
        () =>
          api.v1.me['work-location'].assertions[':id'].occurrences[':date'].$delete({
            param: { id, date: occurrenceDate },
          }),
        'Could not restore that occurrence.',
      ),
    invalidateKeys: invalidateAll,
  });
  const setCurrent = useApiMutation({
    mutationFn: (nextPlaceId: WorkPlaceOut['id']) =>
      noContent(
        () => api.v1.me['work-location'].current.$put({ json: { placeId: nextPlaceId } }),
        'Could not set your current work location.',
      ),
    invalidateKeys: invalidateAll,
  });
  const clearCurrent = useApiMutation({
    mutationFn: () =>
      noContent(
        () => api.v1.me['work-location'].current.$delete(),
        'Could not clear your manual work location.',
      ),
    invalidateKeys: invalidateAll,
  });
  const recordObservation = useApiMutation({
    mutationFn: (observation: { placeId: WorkPlaceOut['id']; accuracyMeters: number }) =>
      noContent(
        () => api.v1.me['work-location'].observations.$post({ json: observation }),
        'Could not record the matched place.',
      ),
    invalidateKeys: invalidateAll,
  });
  const saveCommitmentPlace = useApiMutation({
    mutationFn: async ({
      commitmentId,
      nextPlaceId,
    }: {
      commitmentId: string;
      nextPlaceId: WorkPlaceOut['id'] | null;
    }) => {
      const preferences = schedulingQ.data;
      if (!preferences) throw new UserFacingError('Standing commitments are not ready yet.');
      const nextPlace = placesQ.data?.items.find((place) => place.id === nextPlaceId);
      return unwrap(
        () =>
          api.v1['schedule-week'].preferences.$put({
            json: {
              commitments: preferences.commitments.map((commitment) => ({
                ...commitment,
                workPlaceId: commitment.id === commitmentId ? nextPlaceId : commitment.workPlaceId,
                location:
                  commitment.id === commitmentId && nextPlace
                    ? nextPlace.name
                    : commitment.location,
              })),
            },
          }),
        'Could not update that standing commitment.',
      );
    },
    invalidateKeys: [queryKeys.schedulePreferences(), queryKeys.workLocation()],
  });

  const places = useMemo(() => placesQ.data?.items ?? [], [placesQ.data]);
  const sendObservation = recordObservation.mutateAsync;
  useEffect(() => {
    if (!deviceActive || !('geolocation' in navigator)) return;
    setDeviceStatus('Using this device while Docket is visible.');
    return startForegroundLocationReporter({
      geolocation: navigator.geolocation,
      visibility: document,
      places,
      onObservation: async (observation) => {
        await sendObservation(observation);
        setDeviceStatus('Matched place evidence is fresh.');
      },
      onError: (error) => {
        setDeviceStatus(deviceErrorCopy(error));
      },
    });
  }, [deviceActive, places, sendObservation]);

  const mutationError =
    createPlace.error ??
    updatePlace.error ??
    retirePlace.error ??
    setProfile.error ??
    createAssertion.error ??
    updateAssertion.error ??
    deleteAssertion.error ??
    setOccurrence.error ??
    clearOccurrence.error ??
    setCurrent.error ??
    clearCurrent.error ??
    recordObservation.error ??
    saveCommitmentPlace.error;
  const loadError = placesQ.error ?? assertionsQ.error ?? syncQ.error ?? preferencesQ.error;
  const loading = placesQ.isPending || assertionsQ.isPending || preferencesQ.isPending;

  const submitPlace: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const name = newPlaceName.trim();
    if (name) createPlace.mutate(name);
  };
  const submitAssertion: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const selectedPlace = places.find((place) => place.id === placeId);
    const startMinute = timeMinutes(startTime);
    const endMinute = timeMinutes(endTime);
    if (!selectedPlace || !date || weekdays.length === 0) return;
    let schedule: WorkLocationSchedule | null = null;
    if (scheduleMode === 'one_off_all_day') {
      schedule = { type: scheduleMode, date, timezone };
    } else if (scheduleMode === 'one_off_timed' && startMinute !== null && endMinute !== null) {
      const startsAtInput = `${date}T${startTime}`;
      const endsAtInput = `${date}T${endTime}`;
      const resolutionError =
        localInputResolutionError(startsAtInput, timezone, startOccurrence, 'start') ??
        localInputResolutionError(endsAtInput, timezone, endOccurrence, 'end');
      if (resolutionError) {
        setActionStatus(resolutionError);
        return;
      }
      const startsAt = fromLocalInputValue(startsAtInput, timezone, startOccurrence);
      const endsAt = fromLocalInputValue(endsAtInput, timezone, endOccurrence);
      if (startsAt && endsAt && Date.parse(endsAt) > Date.parse(startsAt)) {
        schedule = { type: scheduleMode, startsAt, endsAt, timezone };
      }
    } else if (scheduleMode === 'weekly_all_day') {
      schedule = {
        type: scheduleMode,
        effectiveFrom: date,
        effectiveUntil: effectiveUntil || null,
        weekdays,
        timezone,
      };
    } else if (startMinute !== null && endMinute !== null && endMinute > startMinute) {
      schedule = {
        type: 'weekly_timed',
        effectiveFrom: date,
        effectiveUntil: effectiveUntil || null,
        weekdays,
        startMinute,
        endMinute,
        timezone,
      };
    }
    if (!schedule) {
      setActionStatus('Choose a valid date and time range.');
      return;
    }
    setActionStatus(null);
    createAssertion.mutate({ placeId: selectedPlace.id, schedule });
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Work locations"
        description="Name every regular place you use, plan where work happens, and keep linked calendars in step."
      />

      {loading ? (
        <div className="flex flex-col gap-3" aria-label="Loading work locations">
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-56 w-full rounded-lg" />
        </div>
      ) : loadError || !placesQ.data || !assertionsQ.data ? (
        <p role="alert" className="text-error text-body-medium">
          {userErrorMessage(loadError, 'Could not load work-location settings.')}
        </p>
      ) : (
        <>
          <section className="flex flex-col gap-3" aria-labelledby="saved-places-heading">
            <div>
              <h3 id="saved-places-heading" className="text-on-surface text-sm font-semibold">
                Regular places
              </h3>
              <p className="text-on-surface-variant text-body-small">
                Add as many places as your work actually uses. Home is an optional designation, not
                a place type.
              </p>
            </div>
            <form onSubmit={submitPlace} className="flex flex-wrap items-end gap-2">
              <label className="text-on-surface-variant flex min-w-56 flex-1 flex-col gap-1 text-xs">
                Place name
                <Input
                  value={newPlaceName}
                  placeholder="Main library, north campus, client site…"
                  onChange={(event) => {
                    setNewPlaceName(event.target.value);
                  }}
                />
              </label>
              <Button
                type="submit"
                variant="outline"
                disabled={!newPlaceName.trim() || createPlace.isPending}
              >
                Add place
              </Button>
            </form>
            <div className="border-outline-variant divide-outline-variant overflow-hidden rounded-xl border">
              {places.length === 0 ? (
                <p className="text-on-surface-variant p-4 text-sm">No regular places yet.</p>
              ) : (
                places.map((place) => {
                  const isHome = placesQ.data.profile.homePlaceId === place.id;
                  return (
                    <div
                      key={place.id}
                      className="bg-surface-container-low flex flex-col gap-3 border-b p-4 last:border-b-0"
                    >
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="text-on-surface-variant flex min-w-48 flex-1 flex-col gap-1 text-xs">
                          Name
                          <Input
                            value={placeNames[place.id] ?? place.name}
                            onChange={(event) => {
                              setPlaceNames((current) => ({
                                ...current,
                                [place.id]: event.target.value,
                              }));
                            }}
                          />
                        </label>
                        <Button
                          variant="outline"
                          disabled={
                            !placeNames[place.id]?.trim() ||
                            placeNames[place.id]?.trim() === place.name
                          }
                          onClick={() => {
                            const name = placeNames[place.id]?.trim();
                            if (!name) return;
                            updatePlace.mutate({ id: place.id, patch: { name } });
                          }}
                        >
                          Save name
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setProfile.mutate(isHome ? null : place.id);
                          }}
                        >
                          {isHome ? 'Clear home' : 'Designate home'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setCurrent.mutate(place.id);
                          }}
                        >
                          I’m here now
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="text-on-surface-variant flex w-32 flex-col gap-1 text-xs">
                          Geofence radius
                          <Input
                            type="number"
                            min={50}
                            max={2000}
                            value={radii[place.id] ?? 250}
                            onChange={(event) => {
                              setRadii((current) => ({
                                ...current,
                                [place.id]: Number(event.target.value),
                              }));
                            }}
                          />
                        </label>
                        <Button
                          variant="outline"
                          onClick={() => {
                            if (!('geolocation' in navigator)) {
                              setActionStatus('This browser does not offer location access.');
                              return;
                            }
                            navigator.geolocation.getCurrentPosition(
                              (position) => {
                                updatePlace.mutate({
                                  id: place.id,
                                  patch: {
                                    geofence: {
                                      latitude: position.coords.latitude,
                                      longitude: position.coords.longitude,
                                      radiusMeters: Math.min(
                                        2000,
                                        Math.max(50, radii[place.id] ?? 250),
                                      ),
                                    },
                                  },
                                });
                                setActionStatus('Saved this position as the geofence center.');
                              },
                              () => {
                                setActionStatus('This browser could not use the current position.');
                              },
                            );
                          }}
                        >
                          Use current position
                        </Button>
                        {place.geofence ? (
                          <Button
                            variant="outline"
                            onClick={() => {
                              updatePlace.mutate({ id: place.id, patch: { geofence: null } });
                            }}
                          >
                            Clear geofence
                          </Button>
                        ) : null}
                        {place.geofence ? <Badge variant="outline">Geofence saved</Badge> : null}
                        <Button
                          variant="outline"
                          onClick={() => {
                            retirePlace.mutate(place.id);
                          }}
                        >
                          Retire
                        </Button>
                      </div>
                      {place.providerMappings.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5" aria-label="Provider mappings">
                          {place.providerMappings.map((mapping) => (
                            <Badge
                              key={`${mapping.connectionId}:${mapping.classification}`}
                              variant="outline"
                            >
                              {mapping.provider === 'google' ? 'Google' : mapping.provider} ·{' '}
                              {providerClassificationLabel(mapping.classification)}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  clearCurrent.mutate(undefined);
                }}
              >
                Clear manual current location
              </Button>
            </div>
          </section>

          <section
            className="border-outline-variant bg-surface-container-low flex flex-col gap-3 rounded-xl border p-4"
            aria-labelledby="device-location-heading"
          >
            <div>
              <h3 id="device-location-heading" className="text-on-surface text-sm font-semibold">
                This browser
              </h3>
              <p className="text-on-surface-variant text-body-small">
                Coordinates are matched here and never sent. Docket receives only a saved-place ID
                and accuracy while this tab is visible.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                disabled={places.every((place) => !place.geofence)}
                onClick={() => {
                  const next = !deviceActive;
                  setDeviceActive(next);
                  if (next) {
                    setDeviceOptedIn(true);
                    writeStoredValue(DEVICE_OPT_IN_KEY, true);
                  }
                }}
              >
                {deviceActive ? 'Stop using this device' : 'Use this device while Docket is open'}
              </Button>
              {deviceOptedIn && !deviceActive ? (
                <span className="text-on-surface-variant text-xs">
                  Remembered on this browser; start each session with the button.
                </span>
              ) : null}
              {deviceOptedIn ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDeviceActive(false);
                    setDeviceOptedIn(false);
                    writeStoredValue(DEVICE_OPT_IN_KEY, false);
                    setDeviceStatus(null);
                  }}
                >
                  Forget this browser
                </Button>
              ) : null}
            </div>
            {deviceStatus ? (
              <p role="status" className="text-on-surface-variant text-xs">
                {deviceStatus}
              </p>
            ) : null}
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="location-schedule-heading">
            <div>
              <h3 id="location-schedule-heading" className="text-on-surface text-sm font-semibold">
                Expected locations
              </h3>
              <p className="text-on-surface-variant text-body-small">
                Plan a full day, part of a day, or a recurring week. Timed plans take precedence
                over all-day plans.
              </p>
            </div>
            <form
              onSubmit={submitAssertion}
              className="border-outline-variant grid gap-3 rounded-xl border p-4 @2xl:grid-cols-2"
            >
              <label className="text-on-surface-variant flex flex-col gap-1 text-xs">
                Place
                <Select
                  value={placeId}
                  onChange={(event) => {
                    setPlaceId(event.target.value);
                  }}
                >
                  {places.map((place) => (
                    <option key={place.id} value={place.id}>
                      {place.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="text-on-surface-variant flex flex-col gap-1 text-xs">
                Schedule
                <Select
                  value={scheduleMode}
                  onChange={(event) => {
                    setScheduleMode(event.target.value as ScheduleMode);
                  }}
                >
                  <option value="one_off_all_day">One day · all day</option>
                  <option value="one_off_timed">One day · part day</option>
                  <option value="weekly_all_day">Weekly · all day</option>
                  <option value="weekly_timed">Weekly · part day</option>
                </Select>
              </label>
              <div className="text-on-surface-variant flex flex-col gap-1 text-xs">
                <span>{scheduleMode.startsWith('weekly') ? 'Effective from' : 'Date'}</span>
                <DatePicker
                  ariaLabel={scheduleMode.startsWith('weekly') ? 'Effective from' : 'Date'}
                  placeholder="Pick a day"
                  triggerVariant="outline"
                  value={date || null}
                  max={effectiveUntil || undefined}
                  onChange={(nextDate) => {
                    setDate(nextDate ?? '');
                    setStartOccurrence(null);
                    setEndOccurrence(null);
                  }}
                />
              </div>
              {scheduleMode.startsWith('weekly') ? (
                <div className="text-on-surface-variant flex flex-col gap-1 text-xs">
                  <span>Optional end date</span>
                  <DatePicker
                    ariaLabel="Optional end date"
                    placeholder="No end date"
                    triggerVariant="outline"
                    value={effectiveUntil || null}
                    min={date || undefined}
                    onChange={(nextDate) => {
                      setEffectiveUntil(nextDate ?? '');
                    }}
                  />
                </div>
              ) : null}
              {scheduleMode.endsWith('timed') ? (
                <>
                  <CalendarTimeField
                    label="Start"
                    inputType="time"
                    date={date}
                    value={startTime}
                    displayTimezone={timezone}
                    occurrence={startOccurrence}
                    onValueChange={(value) => {
                      setStartTime(value);
                      setStartOccurrence(null);
                    }}
                    onOccurrenceChange={setStartOccurrence}
                  />
                  <CalendarTimeField
                    label="End"
                    inputType="time"
                    date={date}
                    value={endTime}
                    displayTimezone={timezone}
                    occurrence={endOccurrence}
                    onValueChange={(value) => {
                      setEndTime(value);
                      setEndOccurrence(null);
                    }}
                    onOccurrenceChange={setEndOccurrence}
                  />
                </>
              ) : null}
              {scheduleMode.startsWith('weekly') ? (
                <fieldset className="flex flex-wrap gap-3 @2xl:col-span-2">
                  <legend className="text-on-surface-variant mb-1 text-xs">Weekdays</legend>
                  {WEEKDAYS.map((label, day) => (
                    <label key={label} className="text-on-surface flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={weekdays.includes(day)}
                        onChange={(event) => {
                          setWeekdays((current) =>
                            event.target.checked
                              ? [...current, day].sort()
                              : current.filter((value) => value !== day),
                          );
                        }}
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <div className="@2xl:col-span-2">
                <Button type="submit" disabled={!placeId || !date || createAssertion.isPending}>
                  Add expected location
                </Button>
              </div>
            </form>

            <div className="flex flex-col gap-3">
              {assertionsQ.data.items.map((assertion) => {
                const place = places.find((candidate) => candidate.id === assertion.placeId);
                const occurrenceDate = occurrenceDates[assertion.id] ?? '';
                const replacementId = occurrencePlaces[assertion.id] ?? assertion.placeId;
                return (
                  <article
                    key={assertion.id}
                    className="border-outline-variant bg-surface-container-low flex flex-col gap-3 rounded-xl border p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h4 className="text-on-surface text-sm font-medium">
                          {place?.name ?? 'Saved place'}
                        </h4>
                        <p className="text-on-surface-variant text-xs">
                          {scheduleSummary(assertion.schedule)} ·{' '}
                          {assertion.origin === 'provider' ? 'Imported' : 'Docket'}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => {
                          deleteAssertion.mutate(assertion.id);
                        }}
                      >
                        Delete schedule
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="text-on-surface-variant flex min-w-44 flex-col gap-1 text-xs">
                        Move whole series
                        <Select
                          value={seriesPlaces[assertion.id] ?? assertion.placeId}
                          onChange={(event) => {
                            setSeriesPlaces((current) => ({
                              ...current,
                              [assertion.id]: event.target.value,
                            }));
                          }}
                        >
                          {places.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.name}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <Button
                        variant="outline"
                        onClick={() => {
                          const nextPlaceId = places.find(
                            (candidate) => candidate.id === seriesPlaces[assertion.id],
                          )?.id;
                          if (nextPlaceId)
                            updateAssertion.mutate({ id: assertion.id, nextPlaceId });
                        }}
                      >
                        Change whole series
                      </Button>
                    </div>
                    {assertion.schedule.type === 'weekly_all_day' ||
                    assertion.schedule.type === 'weekly_timed' ? (
                      <div className="border-outline-variant flex flex-wrap items-end gap-2 border-t pt-3">
                        <div className="text-on-surface-variant flex flex-col gap-1 text-xs">
                          <span>One occurrence</span>
                          <DatePicker
                            ariaLabel="One occurrence"
                            placeholder="Pick a day"
                            triggerVariant="outline"
                            value={occurrenceDate || null}
                            onChange={(nextDate) => {
                              setOccurrenceDates((current) => ({
                                ...current,
                                [assertion.id]: nextDate ?? '',
                              }));
                            }}
                          />
                        </div>
                        <label className="text-on-surface-variant flex min-w-44 flex-col gap-1 text-xs">
                          Replacement place
                          <Select
                            value={replacementId}
                            onChange={(event) => {
                              setOccurrencePlaces((current) => ({
                                ...current,
                                [assertion.id]: event.target.value,
                              }));
                            }}
                          >
                            {places.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.name}
                              </option>
                            ))}
                          </Select>
                        </label>
                        <Button
                          variant="outline"
                          disabled={!occurrenceDate}
                          onClick={() => {
                            setOccurrence.mutate({
                              id: assertion.id,
                              date: occurrenceDate,
                              input: { action: 'cancel', date: occurrenceDate },
                            });
                          }}
                        >
                          Cancel occurrence
                        </Button>
                        <Button
                          variant="outline"
                          disabled={!occurrenceDate}
                          onClick={() => {
                            const replacement = places.find(
                              (candidate) => candidate.id === replacementId,
                            );
                            if (!replacement || !occurrenceDate) return;
                            let replacementSchedule: Extract<
                              WorkLocationOccurrenceException,
                              { action: 'replace' }
                            >['schedule'];
                            const seriesSchedule = assertion.schedule;
                            if (seriesSchedule.type === 'weekly_all_day')
                              replacementSchedule = {
                                type: 'one_off_all_day',
                                date: occurrenceDate,
                                timezone: seriesSchedule.timezone,
                              };
                            else if (seriesSchedule.type === 'weekly_timed') {
                              const startsAt = scheduleInstantAt(
                                occurrenceDate,
                                seriesSchedule.startMinute,
                                seriesSchedule.timezone,
                              );
                              const endsAt = scheduleInstantAt(
                                occurrenceDate,
                                seriesSchedule.endMinute,
                                seriesSchedule.timezone,
                              );
                              if (!startsAt || !endsAt) return;
                              replacementSchedule = {
                                type: 'one_off_timed',
                                startsAt,
                                endsAt,
                                timezone: seriesSchedule.timezone,
                              };
                            } else return;
                            setOccurrence.mutate({
                              id: assertion.id,
                              date: occurrenceDate,
                              input: {
                                action: 'replace',
                                date: occurrenceDate,
                                placeId: replacement.id,
                                schedule: replacementSchedule,
                              },
                            });
                          }}
                        >
                          Replace occurrence
                        </Button>
                        <Button
                          variant="outline"
                          disabled={!occurrenceDate}
                          onClick={() => {
                            if (!occurrenceDate) return;
                            clearOccurrence.mutate({ id: assertion.id, date: occurrenceDate });
                          }}
                        >
                          Restore occurrence
                        </Button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="standing-commitments-heading">
            <div>
              <h3
                id="standing-commitments-heading"
                className="text-on-surface text-sm font-semibold"
              >
                Standing commitments
              </h3>
              <p className="text-on-surface-variant text-body-small">
                Bind recurring planned work to any regular place so generated blocks carry both its
                canonical ID and current label.
              </p>
            </div>
            {schedulingQ.isPending ? (
              <Skeleton className="h-20 w-full rounded-lg" />
            ) : schedulingQ.isError ? (
              <p role="alert" className="text-error text-sm">
                Could not load standing commitments.
              </p>
            ) : schedulingQ.data.commitments.length ? (
              <div className="border-outline-variant divide-outline-variant overflow-hidden rounded-xl border">
                {schedulingQ.data.commitments.map((commitment) => (
                  <div
                    key={commitment.id}
                    className="bg-surface-container-low flex flex-wrap items-center justify-between gap-3 border-b p-4 last:border-b-0"
                  >
                    <div>
                      <p className="text-on-surface text-sm font-medium">{commitment.title}</p>
                      <p className="text-on-surface-variant text-xs">
                        {commitment.sessionsPerWeek} session
                        {commitment.sessionsPerWeek === 1 ? '' : 's'} per week
                      </p>
                    </div>
                    <label className="text-on-surface-variant flex min-w-48 flex-col gap-1 text-xs">
                      Saved place
                      <Select
                        value={commitment.workPlaceId ?? ''}
                        onChange={(event) => {
                          const nextPlaceId =
                            places.find((place) => place.id === event.target.value)?.id ?? null;
                          saveCommitmentPlace.mutate({ commitmentId: commitment.id, nextPlaceId });
                        }}
                      >
                        <option value="">No saved place</option>
                        {places.map((place) => (
                          <option key={place.id} value={place.id}>
                            {place.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-on-surface-variant text-sm">No standing commitments yet.</p>
            )}
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="location-sync-heading">
            <div>
              <h3 id="location-sync-heading" className="text-on-surface text-sm font-semibold">
                Calendar accounts
              </h3>
              <p className="text-on-surface-variant text-body-small">
                Expected locations sync independently to every supported account. Current device
                evidence does not become a Google schedule event.
              </p>
              <p className="text-on-surface-variant text-xs">
                Google requires synced working-location events to use public event visibility. Saved
                geofences and current-location evidence are never sent to Google.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {(syncQ.data?.accounts ?? []).map((account) => (
                <div
                  key={account.connectionId}
                  className="border-outline-variant bg-surface-container-low flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
                >
                  <div>
                    <p className="text-on-surface text-sm font-medium">
                      {account.accountLabel ?? account.provider}
                    </p>
                    <p className="text-on-surface-variant text-xs">
                      {account.state === 'healthy'
                        ? 'Up to date'
                        : account.state === 'pending'
                          ? 'Preparing work-location sync'
                          : account.state === 'retrying'
                            ? 'Retrying safely'
                            : account.reason === 'unsupported_recurrence'
                              ? 'Change the Google recurrence to daily or weekly to continue'
                              : 'Account action is required'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{account.state.replace('_', ' ')}</Badge>
                    {account.state === 'action_required' ? (
                      <Link
                        className="text-primary text-sm underline"
                        href="/settings/connections/google-calendar"
                      >
                        Review account
                      </Link>
                    ) : null}
                  </div>
                </div>
              ))}
              {syncQ.data?.accounts.length === 0 ? (
                <p className="text-on-surface-variant text-sm">
                  No linked calendar accounts. Docket is ready immediately.
                </p>
              ) : null}
            </div>
          </section>
        </>
      )}

      {actionStatus ? (
        <p role="status" className="text-on-surface-variant text-sm">
          {actionStatus}
        </p>
      ) : null}
      {mutationError ? (
        <p role="alert" className="text-error text-sm">
          {userErrorMessage(mutationError, 'Could not save that work-location change.')}
        </p>
      ) : null}
    </div>
  );
}
