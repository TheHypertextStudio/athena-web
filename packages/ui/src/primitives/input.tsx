/**
 * `@docket/ui` — Input primitive (shadcn "new-york").
 *
 * @remarks
 * Hand-authored from the canonical shadcn "new-york" source. A styled wrapper over the
 * native `<input>` using semantic design tokens from `@docket/ui/styles/globals.css`.
 */
import * as React from 'react';

import { cn } from '../lib/utils';
import { focusRing } from './focus';

/** Props for {@link Input}: the native `<input>` props, unchanged. */
export type InputProps = React.ComponentProps<'input'>;

/** Token-styled text input over the native `<input>` element. */
export function Input({ className, type, ...props }: InputProps): React.JSX.Element {
  return (
    <input
      type={type}
      className={cn(
        'border-outline-variant file:text-on-surface placeholder:text-on-surface-variant text-body-medium file:text-body-medium flex h-9 w-full rounded-md border bg-transparent px-3 py-1 shadow-sm transition-colors file:border-0 file:bg-transparent file:font-medium disabled:cursor-not-allowed disabled:opacity-50',
        focusRing,
        className,
      )}
      {...props}
    />
  );
}
