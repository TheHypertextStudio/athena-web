'use client';

/**
 * `components/plan-canvas/plan-commit-text` — a text field that commits on blur or Enter.
 *
 * @remarks
 * Escape restores the committed value. A live field also commits while typing, after a short
 * pause, so the canvas shows a title as it forms; a value that changes underneath a focused field
 * never erases keystrokes, because the field's own draft wins until it blurs. Filled, so the
 * field stands off the floating panel it sits on.
 */
import { Input, Textarea } from '@docket/ui/primitives';
import { type JSX, useEffect, useRef, useState } from 'react';

/** How long typing pauses before a live field commits what it holds so far. */
const LIVE_COMMIT_MS = 400;

/** Props for {@link CommitText}. */
export interface CommitTextProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly multiline?: boolean;
  readonly placeholder: string;
  readonly disabled: boolean;
  /** Take focus on mount with the text selected, so typing replaces it. */
  readonly autoFocus?: boolean;
  /** Also commit while typing, after a short pause, so the canvas shows the new text as it forms. */
  readonly live?: boolean;
  readonly onCommit: (next: string) => void;
}

/** The draft the field holds and the handlers that commit it. */
interface CommitDraft {
  readonly draft: string;
  readonly setDraft: (next: string) => void;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
  readonly reset: () => void;
}

/** Hold a draft of `value`, commit it on blur or on a pause while live, and reset on demand. */
function useCommitDraft(
  value: string,
  live: boolean,
  onCommit: (next: string) => void,
): CommitDraft {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  useEffect(() => {
    if (!live || !focused.current) return undefined;
    const trimmed = draft.trim();
    if (trimmed.length === 0 || trimmed === value) return undefined;
    const timer = window.setTimeout(() => {
      onCommit(trimmed);
    }, LIVE_COMMIT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [draft, live, onCommit, value]);
  return {
    draft,
    setDraft,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      const trimmed = draft.trim();
      if (trimmed !== value) onCommit(trimmed);
    },
    reset: () => {
      setDraft(value);
    },
  };
}

/** A text field that commits on blur or Enter and resets on Escape. */
export function CommitText({
  id,
  label,
  value,
  multiline = false,
  placeholder,
  disabled,
  autoFocus = false,
  live = false,
  onCommit,
}: CommitTextProps): JSX.Element {
  const field = useCommitDraft(value, live, onCommit);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!autoFocus || disabled) return;
    fieldRef.current?.focus();
    fieldRef.current?.select();
  }, [autoFocus, disabled, id]);
  const shared = {
    id,
    value: field.draft,
    disabled,
    placeholder,
    variant: 'filled' as const,
    onFocus: field.onFocus,
    onBlur: field.onBlur,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === 'Escape') {
        field.reset();
        event.currentTarget.blur();
      } else if (event.key === 'Enter' && !multiline) {
        event.preventDefault();
        event.currentTarget.blur();
      }
    },
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-on-surface-variant text-label-medium">
        {label}
      </label>
      {multiline ? (
        <Textarea
          {...shared}
          ref={fieldRef as React.Ref<HTMLTextAreaElement>}
          rows={3}
          onChange={(event) => {
            field.setDraft(event.target.value);
          }}
        />
      ) : (
        <Input
          {...shared}
          ref={fieldRef as React.Ref<HTMLInputElement>}
          onChange={(event) => {
            field.setDraft(event.target.value);
          }}
        />
      )}
    </div>
  );
}
