'use client';

import { Search, X } from '@docket/ui/icons';
import { Button, Input } from '@docket/ui/primitives';
import { cn } from '@docket/ui';
import { type JSX, type KeyboardEvent, type RefObject, useEffect, useId, useState } from 'react';

/** Props for the shared field used by virtualized in-page search surfaces. */
export interface InPageSearchFieldProps {
  /** The provider-facing ref that receives Ctrl/Cmd+F focus. */
  readonly inputRef: RefObject<HTMLInputElement | null>;
  /** The controlled search draft. */
  readonly value: string;
  /** Update the feature-owned search draft. */
  readonly onValueChange: (value: string) => void;
  /** Restore focus when Escape is pressed while the field is empty. */
  readonly onEscapeEmpty: () => void;
  /** The accessible name for this surface's search. */
  readonly label: string;
  /** The visible empty-field prompt. */
  readonly placeholder: string;
  /** The number of settled results currently represented by the surface. */
  readonly resultCount: number;
  /** Whether the feature is settling or fetching a newer query. */
  readonly pending?: boolean;
  /** Additional classes for the search form. */
  readonly className?: string;
}

/** Render the common search interaction without owning feature search policy. */
export function InPageSearchField({
  inputRef,
  value,
  onValueChange,
  onEscapeEmpty,
  label,
  placeholder,
  resultCount,
  pending = false,
  className,
}: InPageSearchFieldProps): JSX.Element {
  const labelId = useId();
  const [shortcutLabel, setShortcutLabel] = useState('Ctrl F');

  useEffect(() => {
    setShortcutLabel(/Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘F' : 'Ctrl F');
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (value.length > 0) {
      onValueChange('');
      return;
    }
    onEscapeEmpty();
  };

  const resultLabel = `${resultCount} ${resultCount === 1 ? 'result' : 'results'}`;

  return (
    <form
      role="search"
      aria-label={label}
      aria-busy={pending}
      className={cn(
        'border-outline-variant bg-surface-container-low flex min-h-12 min-w-0 items-center gap-2 rounded-xl border px-3',
        className,
      )}
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <label id={labelId} className="sr-only">
        {label}
      </label>
      <Search aria-hidden className="text-on-surface-variant size-5 shrink-0" />
      <Input
        ref={inputRef}
        type="search"
        aria-labelledby={labelId}
        aria-keyshortcuts="Meta+F Control+F"
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        variant="plain"
        className="min-w-0 flex-1 border-0 bg-transparent px-0 focus-visible:ring-0"
      />
      {value.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          controlSize="sm"
          iconOnly
          aria-label="Clear search"
          onClick={() => {
            onValueChange('');
            inputRef.current?.focus();
          }}
        >
          <X aria-hidden className="size-4" />
        </Button>
      ) : null}
      <span
        className="text-on-surface-variant text-label-small hidden shrink-0 sm:inline"
        aria-hidden
      >
        {resultLabel}
      </span>
      <kbd
        className="border-outline-variant bg-surface-container text-on-surface-variant text-label-small hidden shrink-0 rounded border px-1.5 py-0.5 sm:inline-flex"
        aria-hidden
      >
        {shortcutLabel}
      </kbd>
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {resultLabel}
      </span>
    </form>
  );
}
