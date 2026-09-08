'use client';

/** Name-first add/edit dialog for one arbitrary saved work place. */
import type {
  WorkPlaceGeocodeResult,
  WorkPlaceGeofence,
  WorkPlaceOut,
} from '@docket/planning/work-location-contract';
import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@docket/ui/primitives';
import { type JSX, type SubmitEventHandler, useEffect, useRef, useState } from 'react';

import { userErrorMessage } from '@/lib/problem';

import { PlaceAddressAutocomplete } from './place-address-autocomplete';
import { PlaceMapPicker, type PlaceMapPoint } from './place-map-picker';
import { usePlaceReverseGeocode } from './use-place-reverse-geocode';

const PLACE_MATCH_RADIUS_METERS = 250;

function editorTitle(intent: PlaceEditorIntent, place: WorkPlaceOut | null): string {
  if (intent === 'automatic-setup') return 'Set up automatic location';
  return place ? 'Edit place' : 'Add place';
}

function submitLabel(intent: PlaceEditorIntent, place: WorkPlaceOut | null): string {
  if (intent === 'automatic-setup') return 'Save and turn on';
  return place ? 'Save changes' : 'Save place';
}

function placePoint(place: WorkPlaceOut | null): PlaceMapPoint | null {
  return place?.geofence
    ? { latitude: place.geofence.latitude, longitude: place.geofence.longitude }
    : null;
}

function resultMatchesPoint(result: WorkPlaceGeocodeResult, point: PlaceMapPoint | null): boolean {
  return point?.latitude === result.latitude && point.longitude === result.longitude;
}

function ReverseAddressSuggestion(props: {
  readonly suggestion: WorkPlaceGeocodeResult | null;
  readonly onKeep: () => void;
  readonly onUse: (result: WorkPlaceGeocodeResult) => void;
}): JSX.Element | null {
  if (!props.suggestion) return null;
  return (
    <div className="border-outline-variant bg-surface-container-low flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-on-surface text-body-small">{props.suggestion.address}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={props.onKeep}>
          Keep current address
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            if (props.suggestion) props.onUse(props.suggestion);
          }}
        >
          Use suggested address
        </Button>
      </div>
    </div>
  );
}

/** Value emitted by the place editor. */
export interface PlaceEditorValue {
  readonly name: string;
  readonly address: string | null;
  readonly geofence: WorkPlaceGeofence | null;
}

/** The workflow that opened the place editor. */
export type PlaceEditorIntent = 'standard' | 'automatic-setup';

/** Props for {@link PlaceEditorDialog}. */
export interface PlaceEditorDialogProps {
  /** Whether the dialog is visible. */
  readonly open: boolean;
  /** Receive open-state changes from Cancel, Escape, or overlay dismissal. */
  readonly onOpenChange: (open: boolean) => void;
  /** Place being edited, or null for creation. */
  readonly place: WorkPlaceOut | null;
  /** Proposed name used when a connected account introduced an unmatched place. */
  readonly initialName?: string;
  /** Workflow-specific validation and completion copy. */
  readonly intent?: PlaceEditorIntent;
  /** Disable dismissal and submission while the canonical mutation is pending. */
  readonly pending: boolean;
  /** Application-owned failure copy that remains visible beside the form. */
  readonly error?: string | null;
  /** Save the normalized editor value. */
  readonly onSave: (value: PlaceEditorValue) => void;
}

/** Render one synchronized address and map editor without a separate map disclosure state. */
export function PlaceEditorDialog({
  open,
  onOpenChange,
  place,
  initialName,
  intent = 'standard',
  pending,
  error,
  onSave,
}: PlaceEditorDialogProps): JSX.Element {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [addressConfirmed, setAddressConfirmed] = useState(true);
  const [point, setPoint] = useState<PlaceMapPoint | null>(null);
  const latestPointRef = useRef<PlaceMapPoint | null>(null);
  const [addressSuggestion, setAddressSuggestion] = useState<WorkPlaceGeocodeResult | null>(null);
  const reverse = usePlaceReverseGeocode((result) => {
    if (resultMatchesPoint(result, latestPointRef.current)) setAddressSuggestion(result);
  });

  useEffect(() => {
    if (!open) return;
    const initialPoint = placePoint(place);
    setName(place?.name ?? initialName ?? '');
    setAddress(place?.address ?? '');
    setAddressConfirmed(true);
    setPoint(initialPoint);
    latestPointRef.current = initialPoint;
    setAddressSuggestion(null);
  }, [initialName, open, place]);

  const addressNeedsSelection = address.trim().length > 0 && !addressConfirmed;
  const pointRequired = intent === 'automatic-setup' && point === null;
  const cannotSave = !name.trim() || addressNeedsSelection || pointRequired || pending;

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName || cannotSave) return;
    onSave({
      name: normalizedName,
      address: address.trim() || null,
      geofence: point ? { ...point, radiusMeters: PLACE_MATCH_RADIUS_METERS } : null,
    });
  };

  const resolveAddress = (result: WorkPlaceGeocodeResult): void => {
    const resolvedPoint = { latitude: result.latitude, longitude: result.longitude };
    setAddress(result.address);
    setAddressConfirmed(true);
    setPoint(resolvedPoint);
    latestPointRef.current = resolvedPoint;
    setAddressSuggestion(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent presentation={{ kind: 'centered', size: 'large', height: 'content' }}>
        <DialogHeader>
          <DialogTitle>{editorTitle(intent, place)}</DialogTitle>
        </DialogHeader>
        <form className="contents" onSubmit={submit}>
          <DialogBody className="flex flex-col gap-4">
            <label className="text-on-surface-variant text-label-medium flex flex-col gap-1">
              Name
              <Input
                autoFocus
                maxLength={120}
                value={name}
                placeholder="Main library"
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </label>
            <PlaceAddressAutocomplete
              value={address}
              disabled={pending}
              onValueChange={(next) => {
                setAddress(next);
                setAddressConfirmed(next.trim().length === 0);
                setAddressSuggestion(null);
              }}
              onResolved={resolveAddress}
            />
            {addressNeedsSelection ? (
              <p className="text-on-surface-variant text-body-small" role="status">
                Choose an address suggestion before saving this address.
              </p>
            ) : null}
            <PlaceMapPicker
              value={point}
              onChange={(next) => {
                setPoint(next);
                latestPointRef.current = next;
                setAddressSuggestion(null);
                reverse.mutate(next);
              }}
            />
            {reverse.isPending ? (
              <p className="text-on-surface-variant text-body-small" role="status">
                Looking up this point…
              </p>
            ) : null}
            <ReverseAddressSuggestion
              suggestion={addressSuggestion}
              onKeep={() => {
                setAddressSuggestion(null);
              }}
              onUse={resolveAddress}
            />
            {reverse.error ? (
              <p role="alert" className="text-error text-body-small">
                {userErrorMessage(
                  reverse.error,
                  'Docket could not suggest an address for that point.',
                )}
              </p>
            ) : null}
            {pointRequired ? (
              <p className="text-on-surface-variant text-body-small">
                Automatic location needs a point on the map.
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-error text-body-small">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={cannotSave}>
              {submitLabel(intent, place)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
