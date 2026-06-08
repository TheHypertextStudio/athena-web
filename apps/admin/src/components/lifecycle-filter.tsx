'use client';

/**
 * The lifecycle-state filter for the Organizations list — a styled `@docket/ui` DropdownMenu
 * (never a bare `<select>`).
 *
 * @remarks
 * Mirrors the product app's `SessionFilterMenu`: a calm, bordered trigger with a leading filter
 * glyph and a focus ring, opening a radio group of the data-lifecycle states plus an "All states"
 * sentinel. Replacing the native `<select>` keeps the control consistent with the rest of the
 * console (no OS chrome) and gives keyboard users the same focus affordance as every other control.
 */
import { ChevronDown, Filter } from '@docket/ui/icons';
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

import { LIFECYCLE_STATES, type LifecycleState, lifecycleLabel } from '@/lib/lifecycle';

/** The "all states" sentinel value for the filter. */
export const ALL_STATES = 'all';

/** The filter's selectable value: a concrete lifecycle state or the all-states sentinel. */
export type LifecycleFilterValue = LifecycleState | typeof ALL_STATES;

/** Resolve a filter value to its human label (used by the trigger). */
function labelOf(value: LifecycleFilterValue): string {
  return value === ALL_STATES ? 'All states' : lifecycleLabel(value);
}

/** Props for {@link LifecycleFilter}. */
export interface LifecycleFilterProps {
  /** The active filter value. */
  value: LifecycleFilterValue;
  /** Called with the newly selected value. */
  onChange: (value: LifecycleFilterValue) => void;
}

/**
 * The org list's lifecycle-state filter: a styled dropdown of lifecycle states.
 *
 * @example
 * ```tsx
 * <LifecycleFilter value={filter} onChange={setFilter} />
 * ```
 */
export function LifecycleFilter({ value, onChange }: LifecycleFilterProps): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Filter className="h-4 w-4" />
          <span>{labelOf(value)}</span>
          <ChevronDown className="h-4 w-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <DropdownMenuLabel>Filter by lifecycle state</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            onChange(next as LifecycleFilterValue);
          }}
        >
          <DropdownMenuRadioItem value={ALL_STATES}>All states</DropdownMenuRadioItem>
          {LIFECYCLE_STATES.map((state) => (
            <DropdownMenuRadioItem key={state} value={state}>
              {lifecycleLabel(state)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Props for {@link LifecycleStateMenu}. */
export interface LifecycleStateMenuProps {
  /** The currently-selected target lifecycle state. */
  value: LifecycleState;
  /** Called with the newly chosen state. */
  onChange: (value: LifecycleState) => void;
  /** Optional id for label association (the trigger button's `id`). */
  id?: string;
}

/**
 * A styled lifecycle-state chooser for the org detail's "Set lifecycle state" action — a
 * `@docket/ui` DropdownMenu (never a bare `<select>`).
 *
 * @remarks
 * Unlike {@link LifecycleFilter} this picks a single concrete state with no "all" sentinel, so it
 * suits the imperative "force into state" control. Matches the app's button styling and focus ring.
 *
 * @example
 * ```tsx
 * <LifecycleStateMenu value={targetState} onChange={setTargetState} id="target-state" />
 * ```
 */
export function LifecycleStateMenu({ value, onChange, id }: LifecycleStateMenuProps): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button id={id} variant="outline" size="sm" className="w-44 justify-between gap-1.5">
          <span>{lifecycleLabel(value)}</span>
          <ChevronDown className="h-4 w-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[11rem]">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            onChange(next as LifecycleState);
          }}
        >
          {LIFECYCLE_STATES.map((state) => (
            <DropdownMenuRadioItem key={state} value={state}>
              {lifecycleLabel(state)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
