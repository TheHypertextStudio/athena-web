import { Button } from '@docket/ui/primitives';
import { type JSX, useEffect, useRef } from 'react';

/** Props for {@link ComposerClosePrompt}. */
export interface ComposerClosePromptProps {
  /** Dismiss the prompt and return to editing. */
  readonly onKeepEditing: () => void;
  /** Throw the draft away and close the composer. */
  readonly onDiscard: () => void;
}

/**
 * The row that replaces a composer's actions when a dirty draft is about to be closed.
 *
 * Mounting it moves focus to "Keep editing", the safe answer, so Enter keeps the draft and can
 * never reach the form the prompt has covered. The destructive answer is a deliberate click.
 */
export function ComposerClosePrompt({
  onKeepEditing,
  onDiscard,
}: ComposerClosePromptProps): JSX.Element {
  const keepEditingRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    keepEditingRef.current?.focus();
  }, []);

  return (
    <div className="flex w-full flex-row items-center gap-2">
      <span className="text-on-surface-variant text-body-medium mr-auto">Discard this draft?</span>
      <Button ref={keepEditingRef} type="button" variant="ghost" onClick={onKeepEditing}>
        Keep editing
      </Button>
      <Button type="button" variant="destructive" onClick={onDiscard}>
        Discard
      </Button>
    </div>
  );
}
