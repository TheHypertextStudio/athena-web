/**
 * `@docket/ui` — Input primitive (shadcn "new-york").
 *
 * @remarks
 * Hand-authored from the canonical shadcn "new-york" source. A styled wrapper over the
 * native `<input>` using semantic design tokens from `@docket/ui/styles/globals.css`.
 */
import * as React from 'react';

import { cn } from '../lib/utils';

/** Props for {@link Input}: the native `<input>` props, unchanged. */
export type InputProps = React.ComponentProps<'input'>;

/** Token-styled text input over the native `<input>` element. */
export function Input({ className, type, ...props }: InputProps): React.JSX.Element {
  return (
    <input
      type={type}
      className={cn(
        'border-input file:text-foreground placeholder:text-muted-foreground focus-visible:ring-ring flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
