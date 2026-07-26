/**
 * `@docket/ui` — the shared identity-circle wrapper every roster row's leading glyph renders in.
 *
 * @remarks
 * A bare 14px icon floating to the left of a title reads as a stray bullet point, not an
 * identity mark — the row-scale inline glyph {@link StatusIcon} was built for is a badge/menu
 * item beside 13px text, not the leading position of a 72px identity row. This wraps *any* small
 * icon or short text in a tonal circle sized to match the row (40px by default — the same size
 * `EntityIconGlyph`, the customizable Initiative/Project icon, already renders at), so every
 * roster row's leading position carries the same visual weight regardless of what kind of object
 * it identifies.
 */
import * as React from 'react';

import { cn } from '../../lib/utils';

/** Props for {@link IdentityGlyph}. */
export interface IdentityGlyphProps {
  /** The icon or short text (e.g. a team key) rendered inside the circle. */
  children: React.ReactNode;
  /** Diameter in pixels. Defaults to 40 — the roster-row identity size. */
  size?: number;
  /** Background + foreground tone classes (e.g. `bg-state-started/15 text-state-started`). Defaults to a neutral tonal fill. */
  className?: string;
}

/** A tonal circle sized to carry a roster row's leading identity mark. */
export function IdentityGlyph({
  children,
  size = 40,
  className,
}: IdentityGlyphProps): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'bg-surface-container-highest text-on-surface-variant flex shrink-0 items-center justify-center rounded-full',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {children}
    </span>
  );
}
