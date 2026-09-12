'use client';

/**
 * `components/canvas/canvas-search-field` — a search field that stays out of the way.
 *
 * @remarks
 * On a canvas the search is used rarely and the space is precious, so it rests as an icon button
 * and becomes a field when opened. It stays a field while it holds a query, and closes again on a
 * blur with nothing typed. The change is a change of element, never a size that moves under the
 * pointer, so the bar around it keeps still.
 */
import { Search } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button, Input } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

/** Props for {@link CanvasSearchField}. */
export interface CanvasSearchFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The accessible name, e.g. "Search the plan". */
  readonly label: string;
  readonly placeholder?: string;
  readonly className?: string;
}

/** A search input that rests as an icon button and opens into a field. */
export default function CanvasSearchField({
  value,
  onChange,
  label,
  placeholder = 'Search',
  className,
}: CanvasSearchFieldProps): JSX.Element {
  const [opened, setOpened] = useState(false);
  // A query opens the field and keeps it open until a blur finds it empty, so clearing the text
  // does not snap the field away under the pointer.
  if (value.length > 0 && !opened) setOpened(true);
  if (!opened) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        iconOnly
        aria-label={label}
        className={className}
        onClick={() => {
          setOpened(true);
        }}
      >
        <Search aria-hidden="true" />
      </Button>
    );
  }
  return (
    <div className={cn('relative w-56 shrink-0', className)}>
      <Search
        aria-hidden="true"
        className="text-on-surface-variant pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
      />
      <Input
        aria-label={label}
        placeholder={placeholder}
        value={value}
        autoFocus
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onBlur={() => {
          if (value.length === 0) setOpened(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          onChange('');
          setOpened(false);
        }}
        className="w-full pl-8"
      />
    </div>
  );
}
