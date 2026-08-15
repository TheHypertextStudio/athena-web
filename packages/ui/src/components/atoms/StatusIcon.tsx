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
 * The glyph renders at 16px — the product's floor for any icon, anywhere; nothing renders
 * smaller. (An earlier revision of this component shipped at 14px expressly to stay *under*
 * 16px — that call is reversed. 16px is now the minimum, not the ceiling to avoid.)
 *
 * Sizing goes through exactly one mechanism: the `--status-icon-size` CSS custom property
 * (default `1rem`), consumed by a single static `[&>svg]:size-(--status-icon-size)!` class.
 * This is deliberate, not incidental — MUI's `SvgIcon` (the underlying icon primitive for every
 * `@mui/icons-material` glyph) injects its own sizing via Emotion inside `@layer mui`, and
 * *when* that layer gets registered relative to Tailwind's `utilities` layer is a race between
 * an async `<link>` stylesheet and a synchronous inline `<style>` tag — not something a class's
 * source position can reliably win. `!important` sidesteps the race entirely (it wins over any
 * non-important declaration regardless of layer), which is why the class is marked important.
 * That in turn means there can only be ONE `[&>svg]:size-*` class on this element, ever — two
 * `!important` declarations for the same property would depend on which one Tailwind happens to
 * emit later, which is exactly the fragile race this design avoids. A caller that needs a
 * different size (e.g. {@link StatusGlyph}) sets the `--status-icon-size` variable via `style`,
 * never a second sizing class.
 */
import * as React from 'react';

import type { WorkStatusCategory } from '@docket/types';

import { Check, Circle, CircleDashed, CircleDot, X } from '../../icons';
import { cn } from '../../lib/utils';

import { IdentityGlyph } from './IdentityGlyph';

/**
 * The five canonical workflow-state types.
 *
 * @remarks
 * Aliases {@link WorkStatusCategory} from `@docket/types`, the one declaration of this union.
 * Every workspace status maps onto exactly one of these, and the mapping drives the status icon
 * and its token color — the `state` key a workspace chose does not.
 */
export type WorkflowStateType = WorkStatusCategory;

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
  label?: string | undefined;
  /** Extra classes merged after the token color (size, spacing). */
  className?: string | undefined;
  /** Inline style, e.g. to set a CSS custom property a `className` utility reads. */
  style?: React.CSSProperties | undefined;
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
export function StatusIcon({ type, label, className, style }: StatusIconProps): React.JSX.Element {
  const Glyph = STATE_TYPE_GLYPH[type];
  return (
    <span
      role="img"
      aria-label={label ?? type}
      data-state-type={type}
      style={{ '--status-icon-size': '1rem', ...style } as React.CSSProperties}
      className={cn(
        'inline-flex shrink-0 items-center justify-center [&>svg]:size-(--status-icon-size)!',
        STATE_TYPE_TOKEN_CLASS[type],
        className,
      )}
    >
      <Glyph />
    </span>
  );
}

/** The tonal circle fill for each {@link WorkflowStateType}, used by {@link StatusGlyph}. */
const STATE_TYPE_CIRCLE_CLASS: Record<WorkflowStateType, string> = {
  backlog: 'bg-state-backlog/12',
  unstarted: 'bg-state-unstarted/12',
  started: 'bg-state-started/15',
  completed: 'bg-state-completed/15',
  canceled: 'bg-state-canceled/12',
};

/** Props for {@link StatusGlyph}. */
export interface StatusGlyphProps {
  /** The canonical workflow-state type. Drives the glyph, its color, and the circle's tint. */
  type: WorkflowStateType;
  /** Optional accessible label; defaults to the {@link WorkflowStateType} value. */
  label?: string;
  /** Diameter in pixels. Defaults to 40 — the roster-row identity size. */
  size?: number;
}

/**
 * A {@link StatusIcon} rendered at roster-row identity scale — a state-tinted {@link IdentityGlyph}
 * circle around the ring/check/x glyph.
 *
 * @remarks
 * Use this, not a bare {@link StatusIcon}, for a row's *leading* position (the identity slot at
 * the far left of a 72px roster row). {@link StatusIcon} stays the right choice everywhere else —
 * inline beside a badge, in a menu item, on a canvas node — contexts where a small glyph beside
 * small text is the point. It's only alone at the head of a wide row that a 14px icon reads as
 * punctuation rather than an identity mark.
 *
 * @example
 * ```tsx
 * <StatusGlyph type={stateTypeOf(task.state)} />
 * ```
 */
export function StatusGlyph({ type, label, size = 40 }: StatusGlyphProps): React.JSX.Element {
  const iconSize = Math.max(16, Math.round(size * 0.45));
  return (
    <IdentityGlyph
      size={size}
      className={cn(STATE_TYPE_CIRCLE_CLASS[type], STATE_TYPE_TOKEN_CLASS[type])}
    >
      {/*
       * Only the `--status-icon-size` variable changes here — never a second sizing class. See
       * {@link StatusIcon}'s remarks for why exactly one `!important` sizing class must exist.
       */}
      <StatusIcon
        type={type}
        label={label}
        style={{ '--status-icon-size': `${iconSize}px` } as React.CSSProperties}
      />
    </IdentityGlyph>
  );
}
