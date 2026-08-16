'use client';

/** Compact personal settings for saved places, expected schedules, and provider delivery. */
import type {
  WorkLocationAssertionCreate,
  WorkLocationAssertionOut,
  WorkLocationAssertionUpdate,
  WorkLocationOccurrenceException,
  WorkLocationSchedule,
  WorkPlaceOut,
  WorkPlaceUpdate,
} from '@docket/types';
import { Calendar, Google, Home, MapPin, MoreHorizontal, Plus, Target } from '@docket/ui/icons';
import { WriteError } from '@/components/settings/write-error';
import {
  Badge,
  Button,
  DecorativeIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@docket/ui/primitives';
import { EmptyState } from '@docket/ui/components';
import Link from 'next/link';
import { type JSX, useEffect, useMemo, useState } from 'react';

import { readStoredBoolean, writeStoredValue } from '@docket/ui/lib/browser-storage';

import { resolveScheduleTimezone } from '@/components/scheduling';
import {
  startForegroundLocationReporter,
  type ForegroundLocationError,
} from '@/components/work-location/foreground-location-reporter';
import { OccurrenceEditorDialog } from '@/components/work-location/occurrence-editor-dialog';
import {
  PlaceEditorDialog,
  type PlaceEditorValue,
} from '@/components/work-location/place-editor-dialog';
import { ScheduleEditorDialog } from '@/components/work-location/schedule-editor-dialog';
import {
  workLocationAssertionsDef,
  workLocationPlacesDef,
  workLocationPointDef,
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
import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';
import { SettingRow } from '@/components/settings/setting-row';
import { SettingsGroup } from '@/components/settings/settings-group';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';
import { isActionable, syncStateCopy } from '@/components/settings/work-location-copy';

const DEVICE_OPT_IN_KEY = 'docket.work-location.device-opt-in';
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Short owner-facing summary of a canonical assertion schedule. */
function scheduleSummary(schedule: WorkLocationSchedule): string {
  if (schedule.type === 'one_off_all_day') {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${schedule.date}T12:00:00Z`),
    );
  }
  if (schedule.type === 'one_off_timed') {
    const date = new Date(schedule.startsAt);
    const start = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const end = new Date(schedule.endsAt).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${start}–${end}`;
  }
  const days = schedule.weekdays.map((day) => WEEKDAYS[day]).join(', ');
  if (schedule.type === 'weekly_all_day') return `${days} · All day`;
  const time = (minute: number): string =>
    new Date(2000, 0, 1, Math.floor(minute / 60), minute % 60).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  return `${days} · ${time(schedule.startMinute)}–${time(schedule.endMinute)}`;
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
  const [pointAt, setPointAt] = useState(() => new Date().toISOString());
  const placesQ = useApiListQuery(workLocationPlacesDef());
  const assertionsQ = useApiListQuery(workLocationAssertionsDef());
  const pointQ = useApiQuery(workLocationPointDef(pointAt));
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

  const [placeEditorOpen, setPlaceEditorOpen] = useState(false);
  const [editingPlace, setEditingPlace] = useState<WorkPlaceOut | null>(null);
  const [scheduleEditorOpen, setScheduleEditorOpen] = useState(false);
  const [editingAssertion, setEditingAssertion] = useState<WorkLocationAssertionOut | null>(null);
  const [occurrenceAssertion, setOccurrenceAssertion] = useState<WorkLocationAssertionOut | null>(
    null,
  );
  // Both destroy server data — a saved place takes its geofence with it, and a schedule takes
  // its recurrence. Held here rather than per row so one dialog serves every row.
  const [confirmRetire, setConfirmRetire] = useState<WorkPlaceOut | null>(null);
  const [confirmDeleteSchedule, setConfirmDeleteSchedule] =
    useState<WorkLocationAssertionOut | null>(null);
  const [deviceRemembered, setDeviceRemembered] = useState(false);
  const [deviceActive, setDeviceActive] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState<string | null>(null);

  useEffect(() => {
    setDeviceRemembered(readStoredBoolean(DEVICE_OPT_IN_KEY) ?? false);
  }, []);

  const invalidateAll = [queryKeys.workLocation()];
  const createPlace = useApiMutation({
    mutationFn: (input: PlaceEditorValue) =>
      unwrap(
        () =>
          api.v1.me['work-location'].places.$post({
            json: {
              ...input,
              providerMappings: [],
              sort: placesQ.data?.items.length ?? 0,
            },
          }),
        'Could not add that saved place.',
      ),
    invalidateKeys: invalidateAll,
    onSuccess: () => {
      setPlaceEditorOpen(false);
      setEditingPlace(null);
    },
  });
  const updatePlace = useApiMutation({
    mutationFn: ({ id, patch }: { id: WorkPlaceOut['id']; patch: WorkPlaceUpdate }) =>
      unwrap(
        () => api.v1.me['work-location'].places[':id'].$patch({ param: { id }, json: patch }),
        'Could not update that saved place.',
      ),
    invalidateKeys: invalidateAll,
    onSuccess: () => {
      setPlaceEditorOpen(false);
      setEditingPlace(null);
    },
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
    onSuccess: () => {
      setScheduleEditorOpen(false);
      setEditingAssertion(null);
    },
  });
  const updateAssertion = useApiMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: WorkLocationAssertionOut['id'];
      input: WorkLocationAssertionUpdate;
    }) =>
      unwrap(
        () =>
          api.v1.me['work-location'].assertions[':id'].$patch({
            param: { id },
            json: input,
          }),
        'Could not update that schedule.',
      ),
    invalidateKeys: invalidateAll,
    onSuccess: () => {
      setScheduleEditorOpen(false);
      setEditingAssertion(null);
    },
  });
  const deleteAssertion = useApiMutation({
    mutationFn: (id: WorkLocationAssertionOut['id']) =>
      noContent(
        () => api.v1.me['work-location'].assertions[':id'].$delete({ param: { id } }),
        'Could not delete that work-location schedule.',
      ),
    invalidateKeys: invalidateAll,
  });
  const setOccurrence = useApiMutation({
    mutationFn: ({
      id,
      date,
      input,
    }: {
      id: WorkLocationAssertionOut['id'];
      date: string;
      input: WorkLocationOccurrenceException;
    }) =>
      unwrap(
        () =>
          api.v1.me['work-location'].assertions[':id'].occurrences[':date'].$put({
            param: { id, date },
            json: input,
          }),
        'Could not update that occurrence.',
      ),
    invalidateKeys: invalidateAll,
    onSuccess: () => {
      setOccurrenceAssertion(null);
    },
  });
  const clearOccurrence = useApiMutation({
    mutationFn: ({ id, date }: { id: WorkLocationAssertionOut['id']; date: string }) =>
      unwrap(
        () =>
          api.v1.me['work-location'].assertions[':id'].occurrences[':date'].$delete({
            param: { id, date },
          }),
        'Could not restore that occurrence.',
      ),
    invalidateKeys: invalidateAll,
    onSuccess: () => {
      setOccurrenceAssertion(null);
    },
  });
  const setCurrent = useApiMutation({
    mutationFn: (placeId: WorkPlaceOut['id']) =>
      noContent(
        () => api.v1.me['work-location'].current.$put({ json: { placeId } }),
        'Could not set your current work location.',
      ),
    invalidateKeys: invalidateAll,
    onSuccess: () => {
      setPointAt(new Date().toISOString());
    },
  });
  const clearCurrent = useApiMutation({
    mutationFn: () =>
      noContent(
        () => api.v1.me['work-location'].current.$delete(),
        'Could not clear your manual work location.',
      ),
    invalidateKeys: invalidateAll,
    onSuccess: () => {
      setPointAt(new Date().toISOString());
    },
  });
  const recordObservation = useApiMutation({
    mutationFn: (observation: { placeId: WorkPlaceOut['id']; accuracyMeters: number }) =>
      noContent(
        () => api.v1.me['work-location'].observations.$post({ json: observation }),
        'Could not record the matched place.',
      ),
    invalidateKeys: invalidateAll,
    onSuccess: () => {
      setPointAt(new Date().toISOString());
    },
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
    setDeviceStatus('Automatic location is active while Docket is visible.');
    return startForegroundLocationReporter({
      geolocation: navigator.geolocation,
      visibility: document,
      places,
      onObservation: async (observation) => {
        await sendObservation(observation);
        setDeviceStatus('Current place matched.');
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
  const currentPlaceId = pointQ.data?.current.place?.id ?? null;
  const manualCurrent = pointQ.data?.current.source === 'manual';
  const hasMappedPlace = places.some((place) => place.geofence !== null);

  const openNewPlace = (): void => {
    setEditingPlace(null);
    setPlaceEditorOpen(true);
  };
  const openNewSchedule = (): void => {
    setEditingAssertion(null);
    setScheduleEditorOpen(true);
  };

  return (
    <SettingsSectionPage
      sectionKey="work-locations"
      action={
        places.length > 0 ? (
          <Button onClick={openNewPlace}>
            <Plus aria-hidden="true" />
            Add place
          </Button>
        ) : undefined
      }
    >
      {loading ? (
        <div className="flex flex-col gap-3" aria-label="Loading work locations">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : loadError || !placesQ.data || !assertionsQ.data ? (
        <WriteError
          message={userErrorMessage(loadError, 'Could not load work-location settings.')}
        />
      ) : (
        <>
          <SettingsGroup title="Saved places" body="rows">
            {places.length === 0 ? (
              <EmptyState
                icon={MapPin}
                title="No saved places yet"
                body="Save the places you work from so schedules and calendar sync can use them."
                frame="none"
                cta={{ label: 'Add place', onClick: openNewPlace }}
              />
            ) : (
              places.map((place) => {
                const isHome = placesQ.data.profile.homePlaceId === place.id;
                const isCurrent = currentPlaceId === place.id;
                const currentAction =
                  isCurrent && manualCurrent
                    ? 'Clear current location'
                    : `Set ${place.name} as current location`;
                return (
                  <div
                    key={place.id}
                    className="hover:bg-surface-container flex min-h-16 items-center gap-3 px-4 py-3 transition-colors"
                  >
                    <span className="bg-surface-container-high text-on-surface-variant flex size-10 shrink-0 items-center justify-center rounded-md">
                      {isHome ? <Home aria-hidden="true" /> : <MapPin aria-hidden="true" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <p className="text-on-surface text-title-small min-w-0 truncate">
                          {place.name}
                        </p>
                        {isHome ? <Badge variant="outline">Home</Badge> : null}
                        {isCurrent ? <Badge variant="outline">Current</Badge> : null}
                        {place.providerMappings.map((mapping) => (
                          <Badge
                            key={`${mapping.connectionId}:${mapping.classification}`}
                            variant="outline"
                          >
                            {mapping.provider === 'google' ? 'Google' : mapping.provider}
                          </Badge>
                        ))}
                      </div>
                      {place.address ? (
                        <p className="text-on-surface-variant text-body-small truncate">
                          {place.address}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-10"
                            aria-label={currentAction}
                            onClick={() => {
                              if (isCurrent && manualCurrent) clearCurrent.mutate(undefined);
                              else setCurrent.mutate(place.id);
                            }}
                          >
                            <Target aria-hidden="true" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{currentAction}</TooltipContent>
                      </Tooltip>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-10"
                            aria-label={`Actions for ${place.name}`}
                            title="Place actions"
                          >
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" width="sm">
                          <DropdownMenuItem
                            onSelect={() => {
                              setEditingPlace(place);
                              setPlaceEditorOpen(true);
                            }}
                          >
                            Edit place
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => {
                              setProfile.mutate(isHome ? null : place.id);
                            }}
                          >
                            {isHome ? 'Clear home' : 'Make home'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-error focus:text-error"
                            onSelect={() => {
                              setConfirmRetire(place);
                            }}
                          >
                            Retire place
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })
            )}
          </SettingsGroup>

          <SettingsGroup
            title="Schedule"
            body="rows"
            action={
              assertionsQ.data.items.length > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={places.length === 0}
                  onClick={openNewSchedule}
                >
                  <Plus aria-hidden="true" />
                  Add schedule
                </Button>
              ) : undefined
            }
          >
            {assertionsQ.data.items.length === 0 ? (
              <EmptyState
                icon={Calendar}
                title="No schedule yet"
                body="Tell Docket where you usually work on which days."
                frame="none"
                cta={{ label: 'Add schedule', onClick: openNewSchedule }}
              />
            ) : (
              assertionsQ.data.items.map((assertion) => {
                const place = places.find((candidate) => candidate.id === assertion.placeId);
                const placeName = place?.name ?? 'Saved place';
                const weekly =
                  assertion.schedule.type === 'weekly_all_day' ||
                  assertion.schedule.type === 'weekly_timed';
                return (
                  <div
                    key={assertion.id}
                    className="hover:bg-surface-container flex min-h-16 items-center gap-3 px-4 py-3 transition-colors"
                  >
                    <span className="bg-surface-container-high text-on-surface-variant flex size-10 shrink-0 items-center justify-center rounded-md">
                      <Calendar aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <p className="text-on-surface text-label-large truncate">{placeName}</p>
                        {assertion.origin === 'provider' ? (
                          <Badge variant="outline">Imported</Badge>
                        ) : null}
                      </div>
                      <p className="text-on-surface-variant text-body-small truncate">
                        {scheduleSummary(assertion.schedule)}
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-10"
                          aria-label={`Actions for ${placeName} schedule`}
                          title="Schedule actions"
                        >
                          <MoreHorizontal aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" width="sm">
                        <DropdownMenuItem
                          onSelect={() => {
                            setEditingAssertion(assertion);
                            setScheduleEditorOpen(true);
                          }}
                        >
                          Edit schedule
                        </DropdownMenuItem>
                        {weekly ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              setOccurrenceAssertion(assertion);
                            }}
                          >
                            Change one occurrence
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-error focus:text-error"
                          onSelect={() => {
                            setConfirmDeleteSchedule(assertion);
                          }}
                        >
                          Delete schedule
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })
            )}
          </SettingsGroup>

          {schedulingQ.data?.commitments.length ? (
            <SettingsGroup title="Planned work" body="rows">
              {schedulingQ.data.commitments.map((commitment) => (
                <div
                  key={commitment.id}
                  className="hover:bg-surface-container flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-on-surface text-label-large truncate">{commitment.title}</p>
                    <p className="text-on-surface-variant text-body-small">
                      {commitment.sessionsPerWeek} session
                      {commitment.sessionsPerWeek === 1 ? '' : 's'} per week
                    </p>
                  </div>
                  <Select
                    aria-label={`Place for ${commitment.title}`}
                    className="w-full @xl:w-56"
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
                </div>
              ))}
            </SettingsGroup>
          ) : null}

          <SettingsGroup title="Automatic location" body="rows">
            <SettingRow
              leading={<DecorativeIcon icon={Target} />}
              label="Use this device while Docket is open"
              description={
                <span role="status">
                  {deviceStatus ??
                    (!hasMappedPlace
                      ? 'Choose a map location for a place first.'
                      : deviceRemembered
                        ? 'Ready when you start it.'
                        : 'Matches your position to saved places on this device.')}
                </span>
              }
              trailing={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasMappedPlace}
                  onClick={() => {
                    const next = !deviceActive;
                    setDeviceActive(next);
                    setDeviceRemembered(next);
                    writeStoredValue(DEVICE_OPT_IN_KEY, next);
                    if (!next) setDeviceStatus('Automatic location is off.');
                  }}
                >
                  {deviceActive ? 'Stop' : 'Start'}
                </Button>
              }
            />
          </SettingsGroup>

          <SettingsGroup
            title="Calendar sync"
            description="Google work locations appear as public calendar events."
            body="rows"
          >
            {(syncQ.data?.accounts ?? []).map((account) => (
              <div
                key={account.connectionId}
                className="hover:bg-surface-container flex min-h-16 items-center gap-3 px-4 py-3 transition-colors"
              >
                <span className="bg-surface-container-high text-on-surface-variant flex size-10 shrink-0 items-center justify-center rounded-md">
                  {account.provider === 'google' ? (
                    <Google aria-hidden="true" />
                  ) : (
                    <Calendar aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-on-surface text-label-large truncate">
                    {account.accountLabel ?? account.provider}
                  </p>
                  <p className="text-on-surface-variant text-body-small">
                    {syncStateCopy(account.state, account.reason)}
                  </p>
                </div>
                {isActionable(account.state, account.reason) ? (
                  <Button asChild variant="ghost">
                    <Link href="/settings/connections/google-calendar">Review</Link>
                  </Button>
                ) : null}
              </div>
            ))}
            {syncQ.data?.accounts.length === 0 ? (
              <EmptyState
                icon={Google}
                title="No linked calendar accounts"
                body="Link a Google account to publish your work location to its calendar."
                frame="none"
                action={
                  <Button asChild variant="ghost" size="sm">
                    <Link href="/settings/connections/google-calendar">Link a Google account</Link>
                  </Button>
                }
              />
            ) : null}
          </SettingsGroup>
        </>
      )}

      <PlaceEditorDialog
        open={placeEditorOpen}
        onOpenChange={(open) => {
          setPlaceEditorOpen(open);
          if (!open) setEditingPlace(null);
        }}
        place={editingPlace}
        pending={createPlace.isPending || updatePlace.isPending}
        onSave={(value) => {
          if (editingPlace) updatePlace.mutate({ id: editingPlace.id, patch: value });
          else createPlace.mutate(value);
        }}
      />
      <ScheduleEditorDialog
        open={scheduleEditorOpen}
        onOpenChange={(open) => {
          setScheduleEditorOpen(open);
          if (!open) setEditingAssertion(null);
        }}
        places={places}
        timezone={timezone}
        assertion={editingAssertion}
        pending={createAssertion.isPending || updateAssertion.isPending}
        onSave={(value) => {
          if (editingAssertion) {
            updateAssertion.mutate({ id: editingAssertion.id, input: value });
          } else createAssertion.mutate(value);
        }}
      />
      <OccurrenceEditorDialog
        open={occurrenceAssertion !== null}
        onOpenChange={(open) => {
          if (!open) setOccurrenceAssertion(null);
        }}
        assertion={occurrenceAssertion}
        places={places}
        pending={setOccurrence.isPending || clearOccurrence.isPending}
        onSet={(id, date, input) => {
          setOccurrence.mutate({ id, date, input });
        }}
        onRestore={(id, date) => {
          clearOccurrence.mutate({ id, date });
        }}
      />

      <ConfirmDestructiveDialog
        open={confirmRetire !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmRetire(null);
        }}
        title={`Retire ${confirmRetire?.name ?? 'this place'}?`}
        description="Schedules that point at it stop matching. Location history already recorded is unchanged."
        confirmLabel="Retire place"
        pending={retirePlace.isPending}
        onConfirm={() => {
          if (confirmRetire) retirePlace.mutate(confirmRetire.id);
          setConfirmRetire(null);
        }}
      />

      <ConfirmDestructiveDialog
        open={confirmDeleteSchedule !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteSchedule(null);
        }}
        title="Delete this schedule?"
        description="The expected location stops applying from now on. Days already recorded are unchanged."
        confirmLabel="Delete schedule"
        pending={deleteAssertion.isPending}
        onConfirm={() => {
          if (confirmDeleteSchedule) deleteAssertion.mutate(confirmDeleteSchedule.id);
          setConfirmDeleteSchedule(null);
        }}
      />

      {mutationError ? (
        <p role="alert" className="text-error text-body-small">
          {userErrorMessage(mutationError, 'Could not save that work-location change.')}
        </p>
      ) : null}
    </SettingsSectionPage>
  );
}
