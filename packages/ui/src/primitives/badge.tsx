/**
 * `@docket/ui` — Badge primitive.
 *
 * @remarks
 * ## Badge is not Chip
 *
 * These two are the pair the launch review saw as "pills implemented inconsistently", and the
 * distinction is the fix:
 *
 * - A **{@link Chip}** is something you *press*: a property you can change, a filter you can
 *   toggle, an entity you can remove. It is 8px-cornered, it takes a height from the control
 *   scale, and it must carry a leading icon or avatar.
 * - A **Badge** is something you *read*: a count, a state word, a "New" marker. It is fully round,
 *   it is not interactive, it has no leading icon requirement because it has no action to name,
 *   and it hugs its content rather than taking a control height.
 *
 * `rounded-full` is reserved for exactly this and for avatars. If a rounded-full thing responds to
 * a click, it is a chip wearing the wrong shape.
 *
 * ## Type and chrome
 *
 * `label-small` (11 / 16, weight 500) — the MD3 role for counts and markers. The old recipe used
 * `text-xs font-semibold` plus a border on every variant plus `shadow` on two of them; the border
 * and the shadow are both gone, because a badge is already separated from its surroundings by
 * being a filled shape.
 */
import * as React from 'react';

import { cn } from '../lib/utils';

/** The colour treatments a badge may take. */
export const BADGE_VARIANTS = ['default', 'secondary', 'destructive', 'outline'] as const;

/** One of the badge colour treatments. See {@link BADGE_VARIANTS}. */
export type BadgeVariant = (typeof BADGE_VARIANTS)[number];

const BADGE_COLOR: Readonly<Record<BadgeVariant, string>> = {
  default: 'bg-primary text-on-primary',
  secondary: 'bg-surface-container-high text-on-surface-variant',
  destructive: 'bg-error-container text-on-error-container',
  // The one badge that keeps a hairline: it has no fill, so without an outline it is only text.
  outline: 'border-outline-variant text-on-surface-variant border bg-transparent',
};

/** Options accepted by {@link badgeVariants}. */
export interface BadgeVariantsOptions {
  /** The colour treatment. Default `default`. */
  readonly variant?: BadgeVariant | null;
  /** Extra classes appended last. */
  readonly className?: string;
}

/**
 * Build a badge's class string without rendering a {@link Badge}.
 *
 * @param options - See {@link BadgeVariantsOptions}.
 * @returns The badge chrome plus the variant's colour role.
 */
export function badgeVariants(options?: BadgeVariantsOptions): string {
  return cn(
    'inline-flex shrink-0 items-center justify-center rounded-full px-2 py-0.5',
    'text-label-small tabular-nums transition-colors',
    BADGE_COLOR[options?.variant ?? 'default'],
    options?.className,
  );
}

/** Props for {@link Badge}. */
export interface BadgeProps extends Omit<React.ComponentProps<'span'>, 'color'> {
  /** The colour treatment. Default `default`. */
  readonly variant?: BadgeVariant | null;
}

/**
 * A small, non-interactive count or state marker.
 *
 * @param props - See {@link BadgeProps}.
 * @returns A `<span>` — never a `<div>`, so a badge can sit inside a paragraph or a row label
 *   without breaking the surrounding inline flow.
 *
 * @example
 * ```tsx
 * <Badge variant="secondary">{unreadCount}</Badge>
 * ```
 */
export function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
  return <span className={badgeVariants({ variant, className })} {...props} />;
}
