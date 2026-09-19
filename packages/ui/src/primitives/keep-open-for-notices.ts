import type * as DialogPrimitive from '@radix-ui/react-dialog';
import type * as React from 'react';

/** Radix's dismiss hook for a pointer or focus move outside a modal. */
type InteractOutsideHandler = NonNullable<
  React.ComponentProps<typeof DialogPrimitive.Content>['onInteractOutside']
>;

/** The attribute the notice stack carries. */
const NOTICE_STACK_SELECTOR = '[data-sonner-toaster]';

/**
 * Compose a modal's `onInteractOutside` so a notice never dismisses it.
 *
 * @remarks
 * The notice stack sits outside every modal, so Radix reads a click on "Try again" as a click
 * outside the dialog and closes it, taking the form that just failed to save along with it. A
 * notice belongs to the whole page, so interacting with it leaves the modal as it is.
 *
 * @param handler - The caller's own handler, run for every other interaction.
 * @returns the handler to pass to `Dialog.Content`.
 */
export function keepOpenForNotices(
  handler: InteractOutsideHandler | undefined,
): InteractOutsideHandler {
  return (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest(NOTICE_STACK_SELECTOR) !== null) {
      event.preventDefault();
      return;
    }
    handler?.(event);
  };
}
