'use client';

/**
 * `@docket/ui` — the workflow-state status icon.
 *
 * @remarks
 * Renders the canonical Linear-style state glyph (a ring, dashed ring, partial ring, or
 * filled check / cancel mark) colored by a task's {@link WorkflowStateType}. The color is
 * keyed off the *type* (`backlog` | `unstarted` | `started` | `completed` | `canceled`),
 * NOT the free-form per-team state `key`, so a team that renames its "In Progress" state
 * still gets the `started` treatment. Colors come exclusively from the `--color-state-*`
 * design tokens in `@docket/ui/styles/globals.css` via the `text-state-*` utility classes —
 * never hardcoded.
 *
 * The glyph renders at the inline-row size (`size-3.5`, 14px) so it reads as optically congruent
 * beside the ~13px (`text-xs`/`text-sm`) labels in list rows, group headers, and pickers — never
 * the oversized 16px the design-system review flagged. Callers may override the glyph size with a
 * `[&>svg]:size-*` utility in `className` when a larger accent is warranted.
 */
import * as React from 'react';

import { Check, Circle, CircleDashed, CircleDot, X } from '../../icons';
import { cn } from '../../lib/utils';

/**
 * The five canonical workflow-state types.
 *
 * @remarks
 * Mirrors `WorkflowStateType` in `@docket/db` (which the UI package does not depend on).
 * Every per-team workflow state maps onto exactly one of these, and the mapping — not the
 * free-form `state` key — drives the status icon and its token color.
 */
export type WorkflowStateType = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

/**
 * The `text-state-*` token utility class for each {@link WorkflowStateType}.
 *
 * @remarks
 * Each class resolves to the matching `--color-state-*` CSS variable, so light/dark theme
 * values are honored automatically. Static keys (no string interpolation) keep the classes
 * discoverable by Tailwind's content scanner.
 */
export const STATE_TYPE_TOKEN_CLASS: Record<WorkflowStateType, string> = {
  backlog: 'text-state-backlog',
  unstarted: 'text-state-unstarted',
  started: 'text-state-started',
  completed: 'text-state-completed',
  canceled: 'text-state-canceled',
};

/** The glyph component used for each {@link WorkflowStateType}. */
const STATE_TYPE_GLYPH: Record<WorkflowStateType, React.ComponentType<{ className?: string }>> = {
  backlog: CircleDashed,
  unstarted: Circle,
  started: CircleDot,
  completed: Check,
  canceled: X,
};

/** Props for {@link StatusIcon}. */
export interface StatusIconProps {
  /**
   * The canonical workflow-state type. Drives both the glyph and the `--color-state-*`
   * token color; the free-form per-team `state` key is intentionally NOT used.
   */
  type: WorkflowStateType;
  /** Optional accessible label; defaults to the {@link WorkflowStateType} value. */
  label?: string;
  /** Extra classes merged after the token color (size, spacing). */
  className?: string;
}

/**
 * A workflow-state ring/check icon colored by {@link WorkflowStateType}.
 *
 * @remarks
 * The rendered element carries the `text-state-<type>` token class (e.g.
 * `text-state-started`) so the glyph adopts the correct semantic color. The wrapper is
 * `role="img"` with an accessible name for assistive tech.
 *
 * @example
 * ```tsx
 * <StatusIcon type="started" />
 * ```
 */
export function StatusIcon({ type, label, className }: StatusIconProps): React.JSX.Element {
  const Glyph = STATE_TYPE_GLYPH[type];
  return (
    <span
      role="img"
      aria-label={label ?? type}
      data-state-type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center [&>svg]:size-3.5',
        STATE_TYPE_TOKEN_CLASS[type],
        className,
      )}
    >
      <Glyph />
    </span>
  );
}
