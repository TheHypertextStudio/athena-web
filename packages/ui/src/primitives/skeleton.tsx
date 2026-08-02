/**
 * `@docket/ui` — Skeleton primitive (shadcn "new-york").
 *
 * @remarks
 * Hand-authored from the canonical shadcn "new-york" source. A pulsing placeholder block
 * for loading states, colored via the MD3 `surface-container-high` tone (a quiet raised
 * well) from `@docket/ui/styles/globals.css`.
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
      className={cn('bg-surface-container-high animate-pulse rounded-md', className)}
      {...props}
    />
  );
}
