'use client';

/**
 * `@docket/ui` — the design-system checkbox.
 *
 * @remarks
 * Every checkable row in Docket renders through this primitive so a tick looks the same wherever it
 * appears. It replaces the raw `<input type="checkbox" className="accent-primary">` pattern, which
 * drew the **operating system's** checkbox — a native blue square that ignores the theme, ignores
 * dark mode, ignores the shared focus ring, and looks visibly foreign next to MD3 controls.
 *
 * Implementation notes, in order of why they matter:
 *
 * - It is still a real `<input type="checkbox">`, so it keeps native semantics for free: form
 *   participation, the `indeterminate` IDL property, label association, `:checked` state, and
 *   assistive-technology support. No ARIA is re-implemented and no extra dependency is introduced.
 * - `appearance-none` removes the platform rendering; the box, the fill, and the radius are drawn
 *   with semantic tokens (`outline`, `primary`, `on-primary`), so light and dark both resolve
 *   automatically.
 * - The tick is a sibling {@link Check} glyph revealed by `peer-checked:` rather than a background
 *   image, because a `data:` SVG would have to hard-code a stroke colour and could not follow the
 *   theme.
 * - Focus uses the canonical {@link focusRing}, so a checkbox rings exactly like a button.
 *
 * @example
 * ```tsx
 * <label className="flex items-center gap-2">
 *   <Checkbox checked={visible} onChange={() => { toggle(); }} />
 *   <span className="text-body-medium">Show this calendar</span>
 * </label>
 * ```
 */
import * as React from 'react';

import { Check, Minus } from '../icons';
import { cn } from '../lib/utils';
import { focusRing } from './focus';

/** Props for {@link Checkbox}: the native `<input>` props minus `type`. */
export type CheckboxProps = Omit<React.ComponentProps<'input'>, 'type'> & {
  /**
   * Render the mixed state (a dash rather than a tick).
   *
   * @remarks
   * Mirrors the DOM's `indeterminate` IDL property, which has no HTML attribute and so has to be
   * assigned imperatively — done here via a ref callback rather than left to the caller.
   */
  readonly indeterminate?: boolean;
};

/** Token-styled, theme-aware checkbox over the native `<input type="checkbox">`. */
export function Checkbox({
  className,
  indeterminate = false,
  ref,
  ...props
}: CheckboxProps): React.JSX.Element {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <span
      className={cn(
        'relative inline-flex size-4 shrink-0 items-center justify-center',
        // The mark stays 16px; the hit area grows around it via a pseudo-element, so the tick
        // does not become a slab on a phone. `-inset-3` centres it — 16 + 12 + 12 = 40 — where a
        // bare `size-10` anchored the box to the mark's top-left corner and left the target
        // sitting down and to the right of the thing it belongs to.
        'coarse:after:absolute coarse:after:-inset-3 coarse:after:content-[""]',
      )}
    >
      <input
        type="checkbox"
        ref={(node) => {
          inputRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        className={cn(
          'peer border-outline size-4 shrink-0 appearance-none rounded-[0.1875rem] border-2 bg-transparent transition-colors',
          'checked:border-primary checked:bg-primary indeterminate:border-primary indeterminate:bg-primary',
          'disabled:cursor-not-allowed disabled:opacity-50',
          focusRing,
          className,
        )}
        {...props}
      />
      <Check
        aria-hidden="true"
        className="text-on-primary pointer-events-none absolute size-3 opacity-0 peer-checked:opacity-100 peer-indeterminate:opacity-0"
      />
      <Minus
        aria-hidden="true"
        className="text-on-primary pointer-events-none absolute size-3 opacity-0 peer-indeterminate:opacity-100"
      />
    </span>
  );
}
