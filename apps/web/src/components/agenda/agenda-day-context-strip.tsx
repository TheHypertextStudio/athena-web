import type { JSX } from 'react';

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
      {items.map((item) => (
        <span
          key={item.id}
          className="bg-surface-container-high text-label-medium text-on-surface inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1"
          data-agenda-day-context={item.kind}
        >
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: item.color ?? 'var(--color-outline)' }}
          />
          <span className="truncate">{item.label}</span>
        </span>
      ))}
    </div>
  );
}
