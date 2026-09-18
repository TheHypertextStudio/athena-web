import { Button } from '@docket/ui/primitives';
import { type JSX, useEffect, useRef } from 'react';

/** Props for {@link ComposerClosePrompt}. */
export interface ComposerClosePromptProps {
  /** Dismiss the prompt and return to editing. */
  readonly onKeepEditing: () => void;
  /** Throw the draft away and close the composer. */
  readonly onDiscard: () => void;
  /**
   * Keep the draft for later and close the composer. When a composer saves drafts this is the
   * prompt's primary answer; a composer without draft persistence omits it.
   */
  readonly onSave?: (() => void) | undefined;
}

/**
 * The row that replaces a composer's actions when a dirty draft is about to be closed.
 *
 * Mounting it moves focus to the safe answer, so Enter never reaches the form the prompt has
 * covered: "Save draft" when the composer keeps drafts, "Keep editing" otherwise. The
 * destructive answer is a deliberate click either way.
 */
export function ComposerClosePrompt({
  onKeepEditing,
  onDiscard,
  onSave,
}: ComposerClosePromptProps): JSX.Element {
  const safeAnswerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    safeAnswerRef.current?.focus();
  }, []);

  if (onSave) {
    return (
      <div className="flex w-full flex-row items-center gap-2">
        <span className="text-on-surface-variant text-body-medium mr-auto">Save this draft?</span>
        <Button type="button" variant="destructive" onClick={onDiscard}>
          Discard
        </Button>
        <Button type="button" variant="ghost" onClick={onKeepEditing}>
          Keep editing
        </Button>
        <Button ref={safeAnswerRef} type="button" onClick={onSave}>
          Save draft
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-row items-center gap-2">
      <span className="text-on-surface-variant text-body-medium mr-auto">Discard this draft?</span>
      <Button ref={safeAnswerRef} type="button" variant="ghost" onClick={onKeepEditing}>
        Keep editing
      </Button>
      <Button type="button" variant="destructive" onClick={onDiscard}>
        Discard
      </Button>
    </div>
  );
}
