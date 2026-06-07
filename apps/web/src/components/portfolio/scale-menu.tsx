'use client';

/**
 * The time-scale override control for the Hub Portfolio roadmap — a styled `@docket/ui`
 * {@link DropdownMenu} (never a bare `<select>`).
 *
 * @remarks
 * By default the axis auto-picks its granularity from the visible span (see
 * {@link import('./time-scale').pickGranularity}); this control lets the caller pin it to
 * Weeks / Months / Quarters instead. It reads as a calm, bordered trigger with a leading
 * "magnify" glyph and a focus ring; the trigger label shows the *effective* granularity when
 * on Auto (e.g. "Auto · Months") so the user always knows what they're looking at, and the
 * active option carries a radio check.
 */
import type { Granularity, ResolvedGranularity } from './time-scale';

import { ChevronDown, Layers } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import type { JSX } from 'react';

import { GRANULARITY_LABEL } from './time-scale';

/** The ordered options shown in the menu. */
const OPTIONS: readonly Granularity[] = ['auto', 'week', 'month', 'quarter'];

/** Props for {@link ScaleMenu}. */
export interface ScaleMenuProps {
  /** The requested granularity (what the user selected). */
  value: Granularity;
  /** The granularity actually rendered (used to annotate the Auto trigger label). */
  resolved: ResolvedGranularity | null;
  /** Called with the newly requested granularity. */
  onChange: (granularity: Granularity) => void;
  /** Disabled when there is nothing dated to scale (the axis is hidden). */
  disabled?: boolean;
}

/**
 * The portfolio's time-scale control.
 *
 * @param props - The {@link ScaleMenuProps}.
 * @returns the rendered dropdown control.
 */
export function ScaleMenu({ value, resolved, onChange, disabled }: ScaleMenuProps): JSX.Element {
  const triggerLabel =
    value === 'auto' && resolved
      ? `Auto · ${GRANULARITY_LABEL[resolved]}`
      : GRANULARITY_LABEL[value];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" disabled={disabled}>
          <Layers className="h-4 w-4" />
          <span>{triggerLabel}</span>
          <ChevronDown className="h-4 w-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[11rem]">
        <DropdownMenuLabel>Time scale</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            onChange(next as Granularity);
          }}
        >
          {OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {GRANULARITY_LABEL[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
