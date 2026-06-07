/**
 * `@docket/ui` — Avatar primitive family (shadcn "new-york").
 *
 * @remarks
 * Hand-authored from the canonical shadcn "new-york" source over
 * `@radix-ui/react-avatar`. {@link Avatar} is the root; {@link AvatarImage} loads the
 * image with built-in fallback handling; {@link AvatarFallback} renders while the image
 * is unavailable. All colors come from the semantic design tokens in
 * `@docket/ui/styles/globals.css`.
 */
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import * as React from 'react';

import { cn } from '../lib/utils';

/** Avatar root — fixed-size, circular, overflow-clipped container. */
export function Avatar({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root>): React.JSX.Element {
  return (
    <AvatarPrimitive.Root
      className={cn('relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full', className)}
      {...props}
    />
  );
}

/** Avatar image — fills the {@link Avatar}; defers to {@link AvatarFallback} on load failure. */
export function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>): React.JSX.Element {
  return (
    <AvatarPrimitive.Image className={cn('aspect-square h-full w-full', className)} {...props} />
  );
}

/** Avatar fallback — token-colored placeholder shown when the image is unavailable. */
export function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>): React.JSX.Element {
  return (
    <AvatarPrimitive.Fallback
      className={cn(
        'bg-muted flex h-full w-full items-center justify-center rounded-full',
        className,
      )}
      {...props}
    />
  );
}
