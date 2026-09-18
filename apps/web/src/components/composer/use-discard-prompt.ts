import { type RefObject, useRef, useState } from 'react';

/** What the discard prompt needs to know about the composer it guards. */
export interface DiscardPromptOptions {
  /** Whether a create is in flight, during which the dialog cannot be dismissed at all. */
  readonly creating: boolean;
  /** Whether the host has locked the draft's content for a reason of its own. */
  readonly contentDisabled: boolean;
  /** Whether the host considers the draft complete enough to submit. */
  readonly canSubmit: boolean;
  /** Whether the draft holds typed text worth protecting. */
  readonly isDirty: boolean;
  /** The dialog's open-state setter; called with `false` when a close goes ahead. */
  readonly onOpenChange: (open: boolean) => void;
  /** The host's title input ref, when it keeps one; otherwise the hook supplies its own. */
  readonly titleInputRef?: RefObject<HTMLInputElement | null> | undefined;
}

/** The prompt's state and the three answers a person can give it. */
export interface DiscardPrompt {
  /** Whether the prompt is replacing the composer's ordinary actions right now. */
  readonly confirming: boolean;
  /** Whether the draft's fields are locked: during a create, by the host, or under the prompt. */
  readonly editDisabled: boolean;
  /** One answer for every submit path: the button, Enter in a field, and the continue chord. */
  readonly submittable: boolean;
  /** The ref to bind to the title input, so "Keep editing" can hand focus back to it. */
  readonly titleRef: RefObject<HTMLInputElement | null>;
  /** Gate every dismiss path (Escape, backdrop, X): prompt when dirty, close when not. */
  readonly requestClose: () => void;
  /** Confirm discarding the draft and close. */
  readonly discard: () => void;
  /** Dismiss the prompt and return focus to the title, where the person was writing. */
  readonly keepEditing: () => void;
  /**
   * The dialog's Escape handler: a second Escape while the prompt is up answers it with "Keep
   * editing", and an Escape inside the body editor's table toolbar stays with the table.
   */
  readonly onEscapeKeyDown: (event: KeyboardEvent) => void;
}

/**
 * Own the "Discard this draft?" prompt a composer shows when a dirty draft is about to be closed.
 *
 * The prompt is a mode, not a dialog: while it is up the draft's fields are disabled and every
 * submit path is refused, so nothing behind the prompt can create the object it has visually
 * replaced. This hook is where that mode is entered and left, and where those two gates are
 * decided.
 */
export function useDiscardPrompt({
  creating,
  contentDisabled,
  canSubmit,
  isDirty,
  onOpenChange,
  titleInputRef,
}: DiscardPromptOptions): DiscardPrompt {
  const [confirming, setConfirming] = useState(false);
  const fallbackTitleRef = useRef<HTMLInputElement>(null);
  const titleRef = titleInputRef ?? fallbackTitleRef;
  const editDisabled = creating || contentDisabled || confirming;
  const submittable = canSubmit && !creating && !confirming;

  const requestClose = (): void => {
    if (creating) return;
    if (isDirty) {
      setConfirming(true);
      return;
    }
    onOpenChange(false);
  };

  const discard = (): void => {
    setConfirming(false);
    onOpenChange(false);
  };

  const keepEditing = (): void => {
    setConfirming(false);
    // The title is disabled until the prompt's state change commits; focus it on the next frame.
    requestAnimationFrame(() => {
      titleRef.current?.focus();
    });
  };

  const onEscapeKeyDown = (event: KeyboardEvent): void => {
    if (confirming) {
      event.preventDefault();
      keepEditing();
      return;
    }
    // Radix sees Escape at the document before the portaled table toolbar can return focus to
    // its editor. Keep that first Escape inside the table editing interaction.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('[data-table-controls]') !== null) {
      event.preventDefault();
    }
  };

  return {
    confirming,
    editDisabled,
    submittable,
    titleRef,
    requestClose,
    discard,
    keepEditing,
    onEscapeKeyDown,
  };
}
