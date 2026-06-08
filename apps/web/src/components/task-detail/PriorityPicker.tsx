'use client';

import type { Priority } from '@docket/types';
import { Check } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import type { JSX } from 'react';

import { PriorityGlyph } from './PriorityGlyph';
import { PRIORITY_LABEL, PRIORITY_ORDER } from './priority';

/** Props for {@link PriorityPicker}. */
interface PriorityPickerProps {
  /** The task's current priority. */
  current: Priority;
  /** Called with the chosen priority when a different one is selected. */
  onSelect: (priority: Priority) => void;
  /** Whether a priority update is in flight (disables the trigger). */
  pending: boolean;
}

/**
 * The editable priority control on the task header.
 *
 * @remarks
 * Mirrors {@link StatusPicker}: a {@link PriorityGlyph} + label button opening a menu of
 * every {@link Priority} in {@link PRIORITY_ORDER}, each row showing its own glyph and a
 * check on the active level. Selecting the current priority is a no-op. Keyboard-
 * navigable through the Radix menu; all colors are token-backed.
 */
export function PriorityPicker({ current, onSelect, pending }: PriorityPickerProps): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={pending} className="gap-2">
          <PriorityGlyph priority={current} />
          {PRIORITY_LABEL[current]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel>Set priority</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PRIORITY_ORDER.map((priority) => (
          <DropdownMenuItem
            key={priority}
            onSelect={() => {
              if (priority !== current) onSelect(priority);
            }}
            className="gap-2"
          >
            <PriorityGlyph priority={priority} />
            <span className="flex-1">{PRIORITY_LABEL[priority]}</span>
            {priority === current ? <Check className="text-on-surface-variant size-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
