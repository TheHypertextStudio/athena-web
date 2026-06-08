'use client';

/**
 * `@docket/ui` — the shared compact trigger for every inline property picker.
 *
 * @remarks
 * The single calm affordance the directive calls for: a low-chrome button that shows the
 * current value (a leading glyph/avatar + label) when the property is set, and a muted
 * "Set <field>" prompt — never a dead "Not set" — when it is empty. It is the trigger for
 * BOTH the detail property rows and the create composer's inline picker strip, so the same
 * control reads identically everywhere.
 *
 * It renders as a borderless `ghost`-weight button by default (so a column of rows reads as
 * quiet, clickable text rather than a wall of boxed inputs); pass `variant="outline"` for the
 * boxed look the create composers use in their picker strip. When `readOnly` (the actor lacks
 * edit capability) it renders the same content as plain, non-interactive text so the panel
 * still reads as complete without offering an affordance that would fail.
 */
import * as React from 'react';

import { Plus } from '../../icons';
import { cn } from '../../lib/utils';
import { Button } from '../../primitives';

/** Props for {@link PropertyTrigger}. */
export interface PropertyTriggerProps {
  /** Optional leading glyph or avatar shown before the label (the value's icon). */
  icon?: React.ReactNode;
  /** The current value's label, or `null`/`undefined` when the property is unset. */
  label?: React.ReactNode;
  /**
   * The calm empty prompt shown when `label` is absent (e.g. "Set lead", "Add project").
   * A leading {@link Plus} glyph is shown with it unless {@link hidePlaceholderIcon} is set.
   */
  placeholder: string;
  /** Hide the leading {@link Plus} on the empty prompt (e.g. when a field icon is supplied). */
  hidePlaceholderIcon?: boolean;
  /** Accessible label for the trigger (e.g. "Lead — currently Ada Lovelace"). */
  ariaLabel?: string;
  /** Disable the trigger (e.g. while a mutation is in flight). */
  disabled?: boolean;
  /**
   * Render the value as plain, non-interactive text instead of a button.
   *
   * @remarks
   * Used when the actor lacks edit capability: the row still shows its value (or a muted
   * em-dash when unset) so the panel reads as complete, but offers no clickable affordance.
   */
  readOnly?: boolean;
  /** Trigger weight: `ghost` (quiet, for panel rows) or `outline` (boxed, for composers). */
  variant?: 'ghost' | 'outline';
  /** Extra classes merged onto the trigger. */
  className?: string;
}

/**
 * The compact picker trigger.
 *
 * @remarks
 * Forwards its ref so it can be the `asChild` child of a Radix `DropdownMenuTrigger` /
 * `PopoverTrigger`. The picker shells pass their menu props through; this component only
 * renders the visible affordance.
 *
 * @example
 * ```tsx
 * <PopoverTrigger asChild>
 *   <PropertyTrigger icon={<ActorAvatar … />} label="Ada" placeholder="Set lead" />
 * </PopoverTrigger>
 * ```
 */
export const PropertyTrigger = React.forwardRef<HTMLButtonElement, PropertyTriggerProps>(
  function PropertyTrigger(
    {
      icon,
      label,
      placeholder,
      hidePlaceholderIcon,
      ariaLabel,
      disabled,
      readOnly,
      variant = 'ghost',
      className,
      ...rest
    },
    ref,
  ): React.JSX.Element {
    const hasValue = label !== null && label !== undefined && label !== '';

    if (readOnly) {
      return (
        <span
          className={cn(
            'inline-flex min-w-0 items-center gap-1.5 text-sm',
            hasValue ? 'text-on-surface' : 'text-on-surface-variant',
            className,
          )}
        >
          {hasValue ? (
            <>
              {icon ? (
                <span aria-hidden="true" className="flex shrink-0 items-center">
                  {icon}
                </span>
              ) : null}
              <span className="truncate">{label}</span>
            </>
          ) : (
            <span aria-hidden="true">—</span>
          )}
        </span>
      );
    }

    return (
      <Button
        ref={ref}
        type="button"
        variant={variant}
        size="sm"
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          'h-auto max-w-full justify-start gap-1.5 px-2 py-1 font-normal',
          hasValue ? 'text-on-surface' : 'text-on-surface-variant',
          className,
        )}
        {...rest}
      >
        {hasValue ? (
          <>
            {icon ? (
              <span aria-hidden="true" className="flex shrink-0 items-center">
                {icon}
              </span>
            ) : null}
            <span className="truncate">{label}</span>
          </>
        ) : (
          <>
            {hidePlaceholderIcon ? null : (
              <Plus aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
            )}
            <span className="truncate">{placeholder}</span>
          </>
        )}
      </Button>
    );
  },
);
