import type { KeyboardEvent } from 'react';

/** The part of a composer's continuation the chord needs: something to submit. */
export interface ContinueChordTarget {
  /** Submit the draft and keep the composer open for the next one. */
  readonly onSubmit: () => void;
}

/**
 * Fire create-and-continue when the keydown is the Cmd/Ctrl+Shift+Enter chord.
 *
 * Runs in the capture phase so the chord beats the body editor's own Enter handling. A repeat
 * keydown, a composer without continuation, or a draft that cannot be submitted right now all
 * leave the event alone.
 *
 * @param event - The dialog's captured keydown.
 * @param continuation - The composer's continuation, when it offers one.
 * @param submittable - Whether the draft may be submitted at this moment.
 */
export function handleContinueChord(
  event: KeyboardEvent<HTMLElement>,
  continuation: ContinueChordTarget | undefined,
  submittable: boolean,
): void {
  if (
    !continuation ||
    event.key !== 'Enter' ||
    !event.shiftKey ||
    (!event.metaKey && !event.ctrlKey) ||
    event.repeat ||
    !submittable
  ) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  continuation.onSubmit();
}
