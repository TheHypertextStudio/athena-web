import type { JSX } from 'react';

import { Badge } from '@docket/ui/primitives';

import type { AgendaDayContext } from './agenda-day-context';

/** Props for {@link AgendaDayContextStrip}. */
interface AgendaDayContextStripProps {
  /** Non-blocking facts attached to the selected day. */
  readonly items: readonly AgendaDayContext[];
}

/** Render semantic day facts separately from all-day and timed events. */
export default function AgendaDayContextStrip({
  items,
}: AgendaDayContextStripProps): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Day context"
      className="flex min-w-0 flex-wrap items-center gap-1.5 px-3 pb-2"
    >
      {/* `Badge`, not a hand-rolled pill. These are round, non-interactive and read rather than
          pressed, which is Badge's whole definition. The hand-rolled version reached for the
          `floating` surface role — three ramp steps above the rail it sits on, and a role that
          belongs to overlays — where `secondary` is the resting step the primitive already owns. */}
      {items.map((item) => (
        <Badge
          key={item.id}
          variant="secondary"
          className="min-w-0 gap-1.5"
          data-agenda-day-context={item.kind}
        >
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: item.color ?? 'var(--color-outline)' }}
          />
          <span className="truncate">{item.label}</span>
        </Badge>
      ))}
    </div>
  );
}
