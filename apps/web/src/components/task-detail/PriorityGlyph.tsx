import type { Priority } from '@docket/types';
import type { JSX } from 'react';

import { PRIORITY_BAR_CLASS, PRIORITY_LABEL } from './priority';

/** Props for {@link PriorityGlyph}. */
interface PriorityGlyphProps {
  /** The priority level the bars represent. */
  priority: Priority;
  /** Extra classes merged onto the glyph wrapper. */
  className?: string;
}

/** The bar count filled for each priority, out of three ascending bars. */
const FILLED_BARS: Record<Priority, number> = {
  urgent: 3,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

/**
 * A Linear-style three-bar priority indicator colored by {@link Priority}.
 *
 * @remarks
 * Renders three ascending bars; the filled count reflects the level and the fill color
 * comes from the {@link PRIORITY_BAR_CLASS} design tokens. Unfilled bars use the muted
 * token so the glyph reads at a glance without color alone. The wrapper carries an
 * accessible label so assistive tech announces the named priority rather than the bars.
 */
export function PriorityGlyph({ priority, className }: PriorityGlyphProps): JSX.Element {
  const filled = FILLED_BARS[priority];
  const heights = ['h-1.5', 'h-2.5', 'h-3.5'];
  return (
    <span
      role="img"
      aria-label={PRIORITY_LABEL[priority]}
      className={`inline-flex h-4 items-end gap-0.5 ${className ?? ''}`}
    >
      {heights.map((height, index) => (
        <span
          key={height}
          className={`w-1 rounded-[1px] ${height} ${
            index < filled ? PRIORITY_BAR_CLASS[priority] : 'bg-muted'
          }`}
        />
      ))}
    </span>
  );
}
