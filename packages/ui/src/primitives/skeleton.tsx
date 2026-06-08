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
  return (
    <div
      className={cn('bg-surface-container-high animate-pulse rounded-md', className)}
      {...props}
    />
  );
}
