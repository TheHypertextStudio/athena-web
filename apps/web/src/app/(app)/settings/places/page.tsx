'use client';

/** Personal settings for saved places, provider aliases, and foreground location matching. */
import type {
  WorkPlaceOut,
  WorkPlaceUpdate,
  WorkScheduleChangeOut,
  WorkScheduleChangeResolution,
} from '@docket/planning/work-location-contract';
import { WorkScheduleUnmatchedPlacePayload } from '@docket/planning/work-location-contract';
import { Home, MapPin, MoreHorizontal, Plus, Target } from '@docket/ui/icons';
import { ConfirmDestructiveDialog, EmptyState } from '@docket/ui/components';
import {
  Badge,
  Button,
  DecorativeIcon,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  Switch,
} from '@docket/ui/primitives';
import { type JSX, useMemo, useState } from 'react';

import { SETTINGS_NODES } from '@/components/settings/settings-capabilities';
import { SettingsGroup } from '@/components/settings/settings-group';
import { LoadFailure } from '@/components/settings/load-failure';
import { SettingRow } from '@/components/settings/setting-row';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';
import { useAutomaticLocation } from '@/components/work-location/automatic-location-provider';
import {
  PlaceEditorDialog,
  type PlaceEditorValue,
} from '@/components/work-location/place-editor-dialog';
import {
  workLocationPlacesDef,
  workLocationPointDef,
  workScheduleChangesDef,
} from '@/components/work-location/work-location-data';
import { api } from '@/lib/api';
import { toUserFacingError, UserFacingError, userErrorMessage } from '@/lib/problem';
import { queryKeys, unwrap, useApiListQuery, useApiMutation, useApiQuery } from '@/lib/query';

function firstPresent(values: readonly unknown[]): unknown {
  return values.find((value) => value !== null && value !== undefined);
}

function mutationMessage(error: unknown, fallback: string): string | null {
  return error ? userErrorMessage(error, fallback) : null;
}

function hiddenResolutionError(
  resolvingChange: WorkScheduleChangeOut | null,
  error: unknown,
): unknown {
  return resolvingChange ? null : error;
}

function itemsOrEmpty<T>(items: readonly T[] | undefined): readonly T[] {
  return items ?? [];
}

function valueOrNull<T>(value: T | undefined): T | null {
  return value ?? null;
}

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

function SavedPlaceRow(props: {
  readonly place: WorkPlaceOut;
  readonly isHome: boolean;
  readonly isCurrent: boolean;
  readonly manualCurrent: boolean;
  readonly onEdit: (place: WorkPlaceOut) => void;
  readonly onSetHome: (placeId: WorkPlaceOut['id'] | null) => void;
  readonly onSetCurrent: (placeId: WorkPlaceOut['id']) => void;
  readonly onClearCurrent: () => void;
  readonly onRetire: (place: WorkPlaceOut) => void;
}): JSX.Element {
  const toggleCurrent = (): void => {
    if (props.isCurrent && props.manualCurrent) props.onClearCurrent();
    else props.onSetCurrent(props.place.id);
  };
  return (
    <SettingRow
      leading={<DecorativeIcon icon={props.isHome ? Home : MapPin} />}
      label={
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="text-on-surface text-label-large truncate">{props.place.name}</span>
          {props.isHome ? <Badge variant="outline">Home</Badge> : null}
          {props.isCurrent ? <Badge variant="outline">Current</Badge> : null}
          {props.place.geofence ? <Badge variant="outline">Mapped</Badge> : null}
        </span>
      }
      description={props.place.address ?? 'No address'}
      trailing={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${props.place.name}`}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" width="sm">
            <DropdownMenuItem
              onSelect={() => {
                props.onEdit(props.place);
              }}
            >
              Edit place
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                props.onSetHome(props.isHome ? null : props.place.id);
              }}
            >
              {props.isHome ? 'Clear home' : 'Make home'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={toggleCurrent}>
              {props.isCurrent && props.manualCurrent
                ? 'Clear current place'
                : 'Set as current place'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              onSelect={() => {
                props.onRetire(props.place);
              }}
            >
              Retire place
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  );
}

function SavedPlacesGroup(props: {
  readonly places: readonly WorkPlaceOut[];
  readonly homePlaceId: WorkPlaceOut['id'] | null;
  readonly currentPlaceId: WorkPlaceOut['id'] | null;
  readonly manualCurrent: boolean;
  readonly onAdd: () => void;
  readonly onEdit: (place: WorkPlaceOut) => void;
  readonly onSetHome: (placeId: WorkPlaceOut['id'] | null) => void;
  readonly onSetCurrent: (placeId: WorkPlaceOut['id']) => void;
  readonly onClearCurrent: () => void;
  readonly onRetire: (place: WorkPlaceOut) => void;
}): JSX.Element {
  return (
    <SettingsGroup capability={SETTINGS_NODES.placesSaved} body="rows">
      {props.places.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="No saved places"
          body="Save a place before you use it in your work schedule."
          frame="none"
          cta={{ label: 'Add place', onClick: props.onAdd }}
        />
      ) : (
        props.places.map((place) => (
          <SavedPlaceRow
            key={place.id}
            place={place}
            isHome={props.homePlaceId === place.id}
            isCurrent={props.currentPlaceId === place.id}
            manualCurrent={props.manualCurrent}
            onEdit={props.onEdit}
            onSetHome={props.onSetHome}
            onSetCurrent={props.onSetCurrent}
            onClearCurrent={props.onClearCurrent}
            onRetire={props.onRetire}
          />
        ))
      )}
    </SettingsGroup>
  );
}

function UnmatchedNamesGroup(props: {
  readonly changes: readonly WorkScheduleChangeOut[];
  readonly places: readonly WorkPlaceOut[];
  readonly onResolve: (change: WorkScheduleChangeOut, initialPlaceId: string) => void;
}): JSX.Element | null {
  const unmatched = props.changes.flatMap((change) => {
    const payload = WorkScheduleUnmatchedPlacePayload.safeParse(change.payload);
    return payload.success ? [{ change, payload: payload.data }] : [];
  });
  if (unmatched.length === 0) return null;
  return (
    <SettingsGroup capability={SETTINGS_NODES.placesUnmatchedNames} body="rows">
      {unmatched.map(({ change, payload }) => {
        return (
          <SettingRow
            key={change.id}
            leading={<DecorativeIcon icon={MapPin} />}
            label={payload.label}
            description={
              change.accountLabel ? `From ${change.accountLabel}` : 'From a connected account'
            }
            trailing={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  props.onResolve(change, props.places[0]?.id ?? '');
                }}
              >
                Resolve
              </Button>
            }
          />
        );
      })}
    </SettingsGroup>
  );
}

function AutomaticLocationGroup(props: {
  readonly mappedPlaceCount: number;
  readonly available: boolean;
  readonly enabled: boolean;
  readonly status: string | null;
  readonly onSetUp: () => void;
  readonly onToggle: (enabled: boolean) => void;
}): JSX.Element {
  if (props.mappedPlaceCount === 0) {
    return (
      <SettingsGroup capability={SETTINGS_NODES.placesAutomatic} body="rows">
        <SettingRow
          leading={<DecorativeIcon icon={Target} />}
          label="Automatic location is not set up"
          description="Choose a saved place, then add its location on the map."
          trailingLayout="stacked-on-narrow"
          trailing={
            <Button variant="outline" size="sm" onClick={props.onSetUp}>
              Set up automatic location
            </Button>
          }
        />
      </SettingsGroup>
    );
  }
  const availableCopy = `${String(props.mappedPlaceCount)} mapped ${props.mappedPlaceCount === 1 ? 'place' : 'places'} available.`;
  const description =
    props.status ?? (props.enabled ? 'Automatic location is active.' : availableCopy);
  return (
    <SettingsGroup capability={SETTINGS_NODES.placesAutomatic} body="rows">
      <SettingRow
        leading={<DecorativeIcon icon={Target} />}
        label="Use this device while Docket is open"
        description={<span role="status">{description}</span>}
        trailing={
          <Switch
            aria-label="Automatic location"
            checked={props.enabled}
            disabled={!props.available}
            onCheckedChange={props.onToggle}
          />
        }
      />
    </SettingsGroup>
  );
}

function PlacesContent(props: {
  readonly places: readonly WorkPlaceOut[];
  readonly changes: readonly WorkScheduleChangeOut[];
  readonly homePlaceId: WorkPlaceOut['id'] | null;
  readonly currentPlaceId: WorkPlaceOut['id'] | null;
  readonly manualCurrent: boolean;
  readonly mappedPlaceCount: number;
  readonly automaticAvailable: boolean;
  readonly automaticEnabled: boolean;
  readonly deviceStatus: string | null;
  readonly onAdd: () => void;
  readonly onEdit: (place: WorkPlaceOut) => void;
  readonly onSetHome: (placeId: WorkPlaceOut['id'] | null) => void;
  readonly onSetCurrent: (placeId: WorkPlaceOut['id']) => void;
  readonly onClearCurrent: () => void;
  readonly onRetire: (place: WorkPlaceOut) => void;
  readonly onResolve: (change: WorkScheduleChangeOut, initialPlaceId: string) => void;
  readonly onSetUpAutomatic: () => void;
  readonly onToggleAutomatic: (active: boolean) => void;
}): JSX.Element {
  return (
    <>
      <SavedPlacesGroup {...props} />
      <UnmatchedNamesGroup
        changes={props.changes}
        places={props.places}
        onResolve={props.onResolve}
      />
      <AutomaticLocationGroup
        mappedPlaceCount={props.mappedPlaceCount}
        available={props.automaticAvailable}
        enabled={props.automaticEnabled}
        status={props.deviceStatus}
        onSetUp={props.onSetUpAutomatic}
        onToggle={props.onToggleAutomatic}
      />
    </>
  );
}

function PlacesDialogs(props: {
  readonly placeEditorOpen: boolean;
  readonly editingPlace: WorkPlaceOut | null;
  readonly suggestedPlaceName: string | undefined;
  readonly places: readonly WorkPlaceOut[];
  readonly resolvingChange: WorkScheduleChangeOut | null;
  readonly resolutionPlaceId: string;
  readonly confirmRetire: WorkPlaceOut | null;
  readonly placePending: boolean;
  readonly placeError: string | null;
  readonly resolvePending: boolean;
  readonly resolveError: string | null;
  readonly retirePending: boolean;
  readonly retireError: string | null;
  readonly onEditorOpenChange: (open: boolean) => void;
  readonly onSavePlace: (value: PlaceEditorValue) => void;
  readonly onResolveOpenChange: (open: boolean) => void;
  readonly onResolutionPlaceChange: (placeId: string) => void;
  readonly onIgnoreName: () => void;
  readonly onCreateName: () => void;
  readonly onResolveName: () => void;
  readonly onRetireOpenChange: (open: boolean) => void;
  readonly onRetire: () => void;
}): JSX.Element {
  const resolvedLabel = WorkScheduleUnmatchedPlacePayload.safeParse(props.resolvingChange?.payload)
    .data?.label;
  return (
    <>
      <PlaceEditorDialog
        open={props.placeEditorOpen}
        onOpenChange={props.onEditorOpenChange}
        place={props.editingPlace}
        {...(props.suggestedPlaceName === undefined
          ? {}
          : { initialName: props.suggestedPlaceName })}
        pending={props.placePending}
        error={props.placeError}
        onSave={props.onSavePlace}
      />
      <Dialog open={props.resolvingChange !== null} onOpenChange={props.onResolveOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve {resolvedLabel ?? 'place name'}</DialogTitle>
            <DialogDescription>
              Choose the saved place that this connected-account name means.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <label className="text-on-surface-variant text-label-medium flex flex-col gap-1">
              Saved place
              <Select
                aria-label="Saved place"
                value={props.resolutionPlaceId}
                onChange={(event) => {
                  props.onResolutionPlaceChange(event.target.value);
                }}
              >
                <option value="">Choose a place</option>
                {props.places.map((place) => (
                  <option key={place.id} value={place.id}>
                    {place.name}
                  </option>
                ))}
              </Select>
            </label>
            {props.resolveError ? (
              <p role="alert" className="text-error text-body-small">
                {props.resolveError}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" disabled={props.resolvePending} onClick={props.onIgnoreName}>
              Ignore name
            </Button>
            <Button variant="outline" disabled={props.resolvePending} onClick={props.onCreateName}>
              Create new place
            </Button>
            <DialogClose asChild>
              <Button variant="ghost" disabled={props.resolvePending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              disabled={!props.resolutionPlaceId || props.resolvePending}
              onClick={props.onResolveName}
            >
              Resolve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDestructiveDialog
        open={props.confirmRetire !== null}
        onOpenChange={props.onRetireOpenChange}
        title={`Retire ${props.confirmRetire?.name ?? 'this place'}?`}
        description="Your schedule must stop using this place before you can retire it. Existing history remains unchanged."
        confirmLabel="Retire place"
        pending={props.retirePending}
        error={props.retireError}
        onConfirm={props.onRetire}
      />
    </>
  );
}

/** The user-owned Places settings destination. */
export default function PlacesSettingsPage(): JSX.Element {
  const [pointAt, setPointAt] = useState(() => new Date().toISOString());
  const placesQ = useApiListQuery(workLocationPlacesDef());
  const changesQ = useApiListQuery(workScheduleChangesDef());
  const pointQ = useApiQuery(workLocationPointDef(pointAt));
  const [placeEditorOpen, setPlaceEditorOpen] = useState(false);
  const [editingPlace, setEditingPlace] = useState<WorkPlaceOut | null>(null);
  const [confirmRetire, setConfirmRetire] = useState<WorkPlaceOut | null>(null);
  const [resolvingChange, setResolvingChange] = useState<WorkScheduleChangeOut | null>(null);
  const [creatingForChange, setCreatingForChange] = useState<WorkScheduleChangeOut | null>(null);
  const [resolutionPlaceId, setResolutionPlaceId] = useState('');
  const automaticLocation = useAutomaticLocation();
  const invalidateKeys = [queryKeys.workLocation()];

  const createPlace = useApiMutation({
    mutationFn: (value: PlaceEditorValue) =>
      unwrap(
        () =>
          api.v1.me['work-location'].places.$post({
            json: {
              ...value,
              providerMappings: [],
              sort: placesQ.data?.items.length ?? 0,
            },
          }),
        'Could not add that saved place.',
      ),
    invalidateKeys,
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
    invalidateKeys,
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
    invalidateKeys,
    onSuccess: () => {
      setConfirmRetire(null);
    },
  });
  const setHome = useApiMutation({
    mutationFn: (homePlaceId: WorkPlaceOut['id'] | null) =>
      unwrap(
        () => api.v1.me['work-location'].profile.$put({ json: { homePlaceId } }),
        'Could not update your home designation.',
      ),
    invalidateKeys,
  });
  const setCurrent = useApiMutation({
    mutationFn: (placeId: WorkPlaceOut['id']) =>
      noContent(
        () => api.v1.me['work-location'].current.$put({ json: { placeId } }),
        'Could not set your current work location.',
      ),
    invalidateKeys,
    onSuccess: () => {
      setPointAt(new Date().toISOString());
    },
  });
  const clearCurrent = useApiMutation({
    mutationFn: () =>
      noContent(
        () => api.v1.me['work-location'].current.$delete(),
        'Could not clear your current work location.',
      ),
    invalidateKeys,
    onSuccess: () => {
      setPointAt(new Date().toISOString());
    },
  });
  const resolveChange = useApiMutation({
    mutationFn: ({
      id,
      resolution,
    }: {
      id: WorkScheduleChangeOut['id'];
      resolution: WorkScheduleChangeResolution;
    }) =>
      noContent(
        () =>
          api.v1.me['work-location'].changes[':id'].resolve.$post({
            param: { id },
            json: resolution,
          }),
        'Could not resolve that provider place name.',
      ),
    invalidateKeys,
    onSuccess: () => {
      setResolvingChange(null);
    },
  });

  const places = useMemo(() => itemsOrEmpty(placesQ.data?.items), [placesQ.data]);
  const changes = useMemo(() => itemsOrEmpty(changesQ.data?.items), [changesQ.data]);
  const mappedPlaces = places.filter((place) => place.geofence !== null);
  const currentPlaceId = pointQ.data?.current.place?.id ?? null;
  const manualCurrent = pointQ.data?.current.source === 'manual';

  const openNewPlace = (): void => {
    setCreatingForChange(null);
    setEditingPlace(null);
    setPlaceEditorOpen(true);
  };
  const openPlaceEditor = (place: WorkPlaceOut): void => {
    setCreatingForChange(null);
    setEditingPlace(place);
    setPlaceEditorOpen(true);
  };
  const setUpAutomaticLocation = (): void => {
    setCreatingForChange(null);
    setEditingPlace(places.find((place) => place.geofence === null) ?? null);
    setPlaceEditorOpen(true);
  };
  const savePlace = (value: PlaceEditorValue): void => {
    if (editingPlace) updatePlace.mutate({ id: editingPlace.id, patch: value });
    else if (creatingForChange) {
      const change = creatingForChange;
      void createPlace
        .mutateAsync(value)
        .then((result) => {
          setCreatingForChange(null);
          resolveChange.mutate({
            id: change.id,
            resolution: { action: 'link_place', placeId: result.place.id },
          });
        })
        .catch(() => undefined);
    } else createPlace.mutate(value);
  };
  const resolveName = (): void => {
    if (!resolvingChange) return;
    const place = places.find((candidate) => candidate.id === resolutionPlaceId);
    if (!place) return;
    resolveChange.mutate({
      id: resolvingChange.id,
      resolution: { action: 'link_place', placeId: place.id },
    });
  };

  const loadError = firstPresent([placesQ.error, changesQ.error, pointQ.error]);
  const loading = [placesQ.isPending, changesQ.isPending].some(Boolean);
  const mutationError = firstPresent([
    setHome.error,
    setCurrent.error,
    clearCurrent.error,
    hiddenResolutionError(resolvingChange, resolveChange.error),
  ]);

  return (
    <SettingsSectionPage
      sectionKey="places"
      loading={loading}
      action={
        loadError ? null : (
          <Button onClick={openNewPlace}>
            <Plus aria-hidden="true" />
            Add place
          </Button>
        )
      }
    >
      {loadError ? (
        <div className="flex flex-col items-start gap-3">
          <LoadFailure message={userErrorMessage(loadError, 'Could not load your saved places.')} />
          <Button
            variant="outline"
            onClick={() => {
              void Promise.all([placesQ.refetch(), changesQ.refetch(), pointQ.refetch()]);
            }}
          >
            Try again
          </Button>
        </div>
      ) : (
        <PlacesContent
          places={places}
          changes={changes}
          homePlaceId={valueOrNull(placesQ.data?.profile.homePlaceId)}
          currentPlaceId={currentPlaceId}
          manualCurrent={manualCurrent}
          mappedPlaceCount={mappedPlaces.length}
          automaticAvailable={automaticLocation.available}
          automaticEnabled={automaticLocation.enabled}
          deviceStatus={automaticLocation.status}
          onAdd={openNewPlace}
          onEdit={openPlaceEditor}
          onSetHome={(placeId) => {
            setHome.mutate(placeId);
          }}
          onSetCurrent={(placeId) => {
            setCurrent.mutate(placeId);
          }}
          onClearCurrent={() => {
            clearCurrent.mutate(undefined);
          }}
          onRetire={setConfirmRetire}
          onResolve={(change, initialPlaceId) => {
            setResolutionPlaceId(initialPlaceId);
            setResolvingChange(change);
          }}
          onSetUpAutomatic={setUpAutomaticLocation}
          onToggleAutomatic={automaticLocation.setEnabled}
        />
      )}
      <PlacesDialogs
        placeEditorOpen={placeEditorOpen}
        editingPlace={editingPlace}
        suggestedPlaceName={
          creatingForChange
            ? WorkScheduleUnmatchedPlacePayload.safeParse(creatingForChange.payload).data?.label
            : undefined
        }
        places={places}
        resolvingChange={resolvingChange}
        resolutionPlaceId={resolutionPlaceId}
        confirmRetire={confirmRetire}
        placePending={createPlace.isPending || updatePlace.isPending}
        placeError={mutationMessage(
          firstPresent([createPlace.error, updatePlace.error]),
          'Could not save that place.',
        )}
        resolvePending={resolveChange.isPending}
        resolveError={mutationMessage(
          resolveChange.error,
          'Could not resolve that provider place name.',
        )}
        retirePending={retirePlace.isPending}
        retireError={mutationMessage(retirePlace.error, 'Could not retire that saved place.')}
        onEditorOpenChange={(open) => {
          setPlaceEditorOpen(open);
          if (!open) {
            setEditingPlace(null);
            setCreatingForChange(null);
          }
        }}
        onSavePlace={savePlace}
        onResolveOpenChange={(open) => {
          if (!open) setResolvingChange(null);
        }}
        onResolutionPlaceChange={setResolutionPlaceId}
        onIgnoreName={() => {
          if (!resolvingChange) return;
          resolveChange.mutate({
            id: resolvingChange.id,
            resolution: { action: 'ignore' },
          });
        }}
        onCreateName={() => {
          if (!resolvingChange) return;
          setCreatingForChange(resolvingChange);
          setResolvingChange(null);
          setEditingPlace(null);
          setPlaceEditorOpen(true);
        }}
        onResolveName={resolveName}
        onRetireOpenChange={(open) => {
          if (!open) setConfirmRetire(null);
        }}
        onRetire={() => {
          if (confirmRetire) retirePlace.mutate(confirmRetire.id);
        }}
      />

      {mutationError ? (
        <p role="alert" className="text-error text-body-small">
          {userErrorMessage(mutationError, 'Could not save that place change.')}
        </p>
      ) : null}
    </SettingsSectionPage>
  );
}
