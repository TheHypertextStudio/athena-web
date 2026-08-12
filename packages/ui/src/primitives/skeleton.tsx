/**
 * `@docket/ui` — Skeleton primitive (shadcn "new-york").
 *
 * @remarks
 * Hand-authored from the canonical shadcn "new-york" source. A pulsing placeholder block
 * for loading states, colored via the MD3 `surface-container-high` tone (a quiet raised
 * well) from `@docket/ui/styles/globals.css`.
 *
 * The pulse needs no reduced-motion branch of its own: the global rule in `globals.css`
 * collapses animation duration and caps iteration count, which freezes it.
 *
 * {@link SkeletonText}, {@link SkeletonChip} and {@link SkeletonGlyph} exist because a loading
 * state only reads as the page it precedes if its blocks are the size of the things they stand
 * in for. Hand-picking a height per call site is how skeletons drift away from their layouts,
 * so the shapes that recur — a line of text, a property pill, an entity icon — are named once
 * against the same type and control scales the real components use.
 */
import * as React from 'react';

import { cn } from '../lib/utils';

/** Animated loading placeholder. Size it with width/height utility classes. */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  // placeholder: nothing — this is the primitive itself, not a usage. Every real stand-in is a
  // caller of this component, and each of those carries its own annotation naming the
  // unknown-until-fetch data it covers. Inventoried because the scan matches on the markup.
  return (
    <div
      data-slot="skeleton"
      className={cn('bg-surface-container-high animate-pulse rounded-md', className)}
      {...props}
    />
  );
}

/** The type scales a {@link SkeletonText} line can stand in for. */
export type SkeletonTextScale = 'body' | 'title' | 'headline';

/** Heights matched to the rendered line-box of each type scale. */
const TEXT_SCALE_HEIGHT: Record<SkeletonTextScale, string> = {
  body: 'h-4',
  title: 'h-6',
  headline: 'h-9',
};

/** Props for {@link SkeletonText}. */
export interface SkeletonTextProps extends Omit<React.ComponentProps<'div'>, 'children'> {
  /** Which type scale this line stands in for. Defaults to body copy. */
  scale?: SkeletonTextScale;
}

/**
 * A placeholder line sized to a real line of type.
 *
 * @param props - The {@link SkeletonTextProps}; set the width with a utility class.
 * @returns The sized placeholder.
 */
export function SkeletonText({
  scale = 'body',
  className,
  ...props
}: SkeletonTextProps): React.JSX.Element {
  // placeholder: one line of text the caller names in its own annotation.
  return <Skeleton className={cn(TEXT_SCALE_HEIGHT[scale], 'rounded', className)} {...props} />;
}

/**
 * A placeholder property pill, sized to the metadata chips it precedes.
 *
 * @param props - Standard div props; set the width with a utility class.
 * @returns The sized placeholder.
 *
 * @remarks
 * `min-h-10` and the full rounding mirror `ENTITY_METADATA_CHIP_CLASS`, so a metadata row does
 * not change height when its real pickers arrive.
 */
export function SkeletonChip({
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'>): React.JSX.Element {
  // placeholder: one property picker whose value is unknown until the entity loads.
  return <Skeleton className={cn('min-h-10 w-24 rounded-full', className)} {...props} />;
}

/**
 * A placeholder entity glyph, sized to the icon a detail masthead leads with.
 *
 * @param props - Standard div props.
 * @returns The sized placeholder.
 */
export function SkeletonGlyph({
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'>): React.JSX.Element {
  // placeholder: the entity's icon, which is part of the record still being read.
  return <Skeleton className={cn('size-10 rounded-lg', className)} {...props} />;
}
