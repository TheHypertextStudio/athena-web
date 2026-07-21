/**
 * `@docket/ui` — DecorativeIcon primitive (the 20px decorative-glyph frame).
 *
 * @remarks
 * Encodes the design-system rule that a *purely decorative* glyph — one that carries no
 * interaction and no standalone meaning (the title/label beside it does) — renders at 20px
 * (`size-5`) inside a padded, toned box. This is the counterpart to the 24px functional/interactive
 * icon slots owned by {@link Button}, the dialog close, and the shell rails; centralizing it here
 * means callers stop hand-tuning `size-*` on decorative marks and the standard lives in one place.
 *
 * It follows the {@link EmptyState} disc pattern (`inline-flex items-center justify-center` +
 * `[&>svg]:size-5`) but as a squared, subtly toned frame for inline/leading use next to a label.
 * The box is `aria-hidden` because the glyph is decorative; the accessible meaning must come from
 * adjacent text. Colors come from the semantic MD3 surface tokens in
 * `@docket/ui/styles/globals.css`, and the tone is overridable via `className`.
 *
 * @example
 * ```tsx
 * // As children.
 * <DecorativeIcon><Folder /></DecorativeIcon>
 *
 * // As an `icon` prop (a `@docket/ui/icons` MUI glyph component).
 * <DecorativeIcon icon={Folder} />
 *
 * // Retinted for a warmer surface.
 * <DecorativeIcon icon={Sparkle} className="bg-primary/12 text-primary" />
 * ```
 */
import * as React from 'react';

import { cn } from '../lib/utils';

/** Props for {@link DecorativeIcon}. */
export interface DecorativeIconProps {
  /**
   * The glyph component (a `@docket/ui/icons` MUI icon) to frame. Provide this or
   * {@link DecorativeIconProps.children}; when both are given, `icon` wins.
   */
  readonly icon?: React.ComponentType<{ className?: string }>;
  /** The glyph element to frame, when not using {@link DecorativeIconProps.icon}. */
  readonly children?: React.ReactNode;
  /** Extra classes merged onto the frame (e.g. to retint its tone). */
  readonly className?: string;
}

/**
 * A padded, toned box that frames a purely-decorative 20px glyph.
 *
 * @param props - The {@link DecorativeIconProps}.
 * @returns the rendered decorative icon frame.
 */
export function DecorativeIcon({
  icon: Icon,
  children,
  className,
}: DecorativeIconProps): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'bg-surface-container-high text-on-surface-variant inline-flex items-center justify-center rounded-lg p-2 [&>svg]:size-5',
        className,
      )}
    >
      {Icon ? <Icon /> : children}
    </span>
  );
}
