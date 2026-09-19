import type {
  WorkPlaceMutationOut,
  WorkPlaceOut,
  WorkPlaceUpdate,
  WorkScheduleChangeOut,
  WorkScheduleChangeResolution,
} from '@docket/planning/work-location-contract';

import type { PlaceEditorValue } from '@/components/work-location/place-editor-dialog';
import { toUserFacingError, UserFacingError } from '@/lib/problem';

/** Return the first value that represents settled query data. */
export function firstPresent(values: readonly unknown[]): unknown {
  return values.find((value) => value !== null && value !== undefined);
}

/** Normalize deferred query results for list consumers. */
export function itemsOrEmpty<T>(items: readonly T[] | undefined): readonly T[] {
  return items ?? [];
}

/** Normalize deferred query results for nullable editor values. */
export function valueOrNull<T>(value: T | undefined): T | null {
  return value ?? null;
}

/** Convert a no-content mutation response into the shared user-facing error contract. */
export async function noContent(
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

/** Build the saved-place resolution only when both the change and place still exist. */
export function linkPlaceResolution(
  change: WorkScheduleChangeOut | null,
  places: readonly WorkPlaceOut[],
  placeId: string,
): {
  readonly id: WorkScheduleChangeOut['id'];
  readonly resolution: WorkScheduleChangeResolution;
} | null {
  if (!change) return null;
  const place = places.find((candidate) => candidate.id === placeId);
  return place ? { id: change.id, resolution: { action: 'link_place', placeId: place.id } } : null;
}

interface SavePlaceHandlerInput {
  readonly editingPlace: WorkPlaceOut | null;
  readonly creatingForChange: WorkScheduleChangeOut | null;
  readonly enableAutomatic: boolean;
  readonly create: (value: PlaceEditorValue) => Promise<WorkPlaceMutationOut>;
  readonly update: (input: {
    readonly id: WorkPlaceOut['id'];
    readonly patch: WorkPlaceUpdate;
  }) => Promise<unknown>;
  readonly resolve: (input: {
    readonly id: WorkScheduleChangeOut['id'];
    readonly resolution: WorkScheduleChangeResolution;
  }) => void;
  readonly clearCreatingForChange: () => void;
  readonly enableAutomaticLocation: () => void;
}

/** Create the post-save workflow for edits, schedule resolutions, and ordinary additions. */
export function createSavePlaceHandler(
  input: SavePlaceHandlerInput,
): (value: PlaceEditorValue) => void {
  const finishAutomaticSetup = (): void => {
    if (input.enableAutomatic) input.enableAutomaticLocation();
  };
  return (value) => {
    if (input.editingPlace) {
      void input
        .update({ id: input.editingPlace.id, patch: value })
        .then(finishAutomaticSetup)
        .catch(() => undefined);
      return;
    }
    if (input.creatingForChange) {
      const change = input.creatingForChange;
      void input
        .create(value)
        .then((result) => {
          input.clearCreatingForChange();
          input.resolve({
            id: change.id,
            resolution: { action: 'link_place', placeId: result.place.id },
          });
        })
        .catch(() => undefined);
      return;
    }
    void input
      .create(value)
      .then(finishAutomaticSetup)
      .catch(() => undefined);
  };
}
