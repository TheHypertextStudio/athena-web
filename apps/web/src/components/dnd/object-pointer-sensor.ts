import { PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom';

/** Pointer-specific threshold used to distinguish activation from clicking or scrolling. */
export type DragActivationProfile =
  | { readonly kind: 'distance'; readonly value: number }
  | {
      readonly kind: 'delay';
      readonly value: number;
      readonly tolerance: number;
    };

/** Return the standard association-drag activation rule for one pointer type. */
export function dragActivationProfile(
  pointerType: string,
  spatialAssociation = false,
): DragActivationProfile {
  return pointerType === 'touch'
    ? { kind: 'delay', value: spatialAssociation ? 450 : 250, tolerance: 8 }
    : { kind: 'distance', value: 6 };
}

/** Find the enhanced object root for the pressed element. */
function objectRoot(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-object-id]') : null;
}

/** Whether a nested element owns its pointer gesture and must never start an object drag. */
function isInteractiveDragTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const control = target.closest(
    'a, button, input, textarea, select, [contenteditable="true"], [role="button"], [data-no-drag]',
  );
  return control !== null && !control.hasAttribute('data-object-id');
}

/** Decide whether one pointer press belongs to a nested control or a positioning gesture. */
export function shouldPreventObjectDragActivation(
  event: Pick<PointerEvent, 'target' | 'pointerType' | 'altKey'>,
): boolean {
  const root = objectRoot(event.target);
  if (
    root?.dataset['associationModifier'] === 'alt' &&
    event.pointerType !== 'touch' &&
    !event.altKey
  ) {
    return true;
  }
  return isInteractiveDragTarget(event.target);
}

/** The one pointer sensor used by every association source. */
export const OBJECT_POINTER_SENSOR = PointerSensor.configure({
  activationConstraints: (event) => {
    const spatialAssociation = objectRoot(event.target)?.dataset['associationModifier'] === 'alt';
    const profile = dragActivationProfile(event.pointerType, spatialAssociation);
    return profile.kind === 'distance'
      ? [new PointerActivationConstraints.Distance({ value: profile.value })]
      : [
          new PointerActivationConstraints.Delay({
            value: profile.value,
            tolerance: profile.tolerance,
          }),
        ];
  },
  preventActivation: shouldPreventObjectDragActivation,
});
