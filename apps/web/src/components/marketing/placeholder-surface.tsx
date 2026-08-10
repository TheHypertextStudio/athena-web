import type { JSX } from 'react';

import { Text } from '@docket/ui/primitives';

/** Props for {@link PlaceholderSurface}. */
export interface PlaceholderSurfaceProps {
  /** What belongs in this slot, e.g. `Task list + task detail`. The plate's only content. */
  readonly label: string;
  /** Aspect ratio class, e.g. `aspect-[16/9]`. Passed in so no two slots share a shape by accident. */
  readonly aspect: string;
  /** Which background the plate sits on, so its hairline and label stay legible on both. */
  readonly tone: 'paper' | 'ink';
}

/**
 * A stand-in for product surface that has not been captured yet.
 *
 * @remarks
 * Deliberately reads as unfinished rather than as a stylised illustration: a dashed hairline
 * plate with a mono label and nothing else. A placeholder that looks designed gets shipped by
 * accident, and then the page is selling a drawing of the product instead of the product.
 *
 * @param props - The slot label, its aspect ratio, and the tone it sits on.
 * @returns The placeholder plate.
 */
export function PlaceholderSurface({ label, aspect, tone }: PlaceholderSurfaceProps): JSX.Element {
  const ink = tone === 'ink';
  return (
    <div
      className={`grid place-items-center rounded-md border border-dashed ${aspect} ${
        ink ? 'border-paper/30 bg-paper/5' : 'border-ink/25 bg-paper-deep/60'
      }`}
    >
      <Text
        token="body-small"
        tone="inherit"
        className={`px-6 text-center font-mono ${ink ? 'text-paper/55' : 'text-ink-muted'}`}
      >
        {label}
      </Text>
    </div>
  );
}
