'use client';

/** Name-first add/edit dialog for one arbitrary saved work place. */
import type { WorkPlaceGeofence, WorkPlaceOut } from '@docket/planning/work-location-contract';
import { MapPin } from '@docket/ui/icons';
import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@docket/ui/primitives';
import { type JSX, type SubmitEventHandler, useEffect, useState } from 'react';

import { PlaceMapPicker, type PlaceMapPoint } from './place-map-picker';

const PLACE_MATCH_RADIUS_METERS = 250;

/** Value emitted by the place editor. */
export interface PlaceEditorValue {
  readonly name: string;
  readonly address: string | null;
  readonly geofence: WorkPlaceGeofence | null;
}

/** Props for {@link PlaceEditorDialog}. */
export interface PlaceEditorDialogProps {
  /** Whether the dialog is visible. */
  readonly open: boolean;
  /** Receive open-state changes from Cancel, Escape, or overlay dismissal. */
  readonly onOpenChange: (open: boolean) => void;
  /** Place being edited, or null for creation. */
  readonly place: WorkPlaceOut | null;
  /** Disable dismissal and submission while the canonical mutation is pending. */
  readonly pending: boolean;
  /** Save the normalized editor value. */
  readonly onSave: (value: PlaceEditorValue) => void;
}

/** Render the minimal saved-place flow with map mechanics behind explicit disclosure. */
export function PlaceEditorDialog({
  open,
  onOpenChange,
  place,
  pending,
  onSave,
}: PlaceEditorDialogProps): JSX.Element {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [mapOpen, setMapOpen] = useState(false);
  const [point, setPoint] = useState<PlaceMapPoint | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(place?.name ?? '');
    setAddress(place?.address ?? '');
    setMapOpen(false);
    setPoint(
      place?.geofence
        ? { latitude: place.geofence.latitude, longitude: place.geofence.longitude }
        : null,
    );
  }, [open, place]);

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName || pending) return;
    onSave({
      name: normalizedName,
      address: address.trim() || null,
      geofence: point ? { ...point, radiusMeters: PLACE_MATCH_RADIUS_METERS } : null,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent presentation={{ kind: 'centered', size: 'large', height: 'tall' }}>
        <DialogHeader>
          <DialogTitle>{place ? 'Edit place' : 'Add place'}</DialogTitle>
          <DialogDescription>
            A name is enough. Add an address or map location when it helps you recognize the place.
          </DialogDescription>
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
            <label className="text-on-surface-variant text-label-medium flex flex-col gap-1">
              Address (optional)
              <Input
                maxLength={240}
                value={address}
                placeholder="10 Library Lane"
                onChange={(event) => {
                  setAddress(event.target.value);
                }}
              />
            </label>
            <div className="flex flex-col gap-3">
              <Button
                type="button"
                variant="outline"
                className="self-start"
                onClick={() => {
                  setMapOpen((current) => !current);
                }}
              >
                <MapPin aria-hidden="true" />
                {mapOpen ? 'Hide map' : point ? 'Change map location' : 'Choose on map'}
              </Button>
              {mapOpen ? <PlaceMapPicker value={point} onChange={setPoint} /> : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!name.trim() || pending}>
              {place ? 'Save changes' : 'Save place'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
