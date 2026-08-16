/**
 * `@docket/ui` — a timestamp that reads relatively and still tells you exactly when.
 *
 * @remarks
 * "Last synced 3 days ago" is the right thing to read at a glance and the wrong thing to reason
 * with. The moment a person needs to correlate a sync with anything — a change they made, an
 * outage, a support thread — they need the actual date, and a relative string has thrown it away.
 * Every relative stamp in the product therefore carries the absolute one underneath.
 *
 * This renders a real `<time>` element, so the machine-readable value is in `dateTime` where
 * assistive tech and copy-paste can reach it, and the human-readable absolute is in `title` for a
 * hover. Several surfaces already hand-rolled exactly this shape (`activity/day-highlight-row`,
 * `stream/stream-event-line`, `task-detail/task-activity-section`); this is that pattern with one
 * home.
 *
 * The relative phrasing itself is the caller's — the settings surface wants "2h ago" while an
 * activity row wants its own entry label — so `children` carries whatever the caller already
 * computed and this component only guarantees the underlying instant travels with it.
 *
 * @example
 * ```tsx
 * <RelativeTime iso={connection.lastSyncedAt}>{relativeTime(connection.lastSyncedAt)}</RelativeTime>
 * ```
 */
import * as React from 'react';

import { cn } from '../../lib/utils';

/** Props for {@link RelativeTime}. */
export interface RelativeTimeProps extends Omit<React.ComponentProps<'time'>, 'title'> {
  /** The ISO-8601 instant being described. */
  readonly iso: string;
  /**
   * The IANA zone the absolute form is rendered in.
   *
   * @remarks
   * Omit to use the viewer's own zone, which is what a settings surface wants. Pass one where the
   * product has an opinion about which clock a reader is reasoning in (a workspace's scheduling
   * timezone, say) so two people looking at the same row read the same wall time.
   */
  readonly timeZone?: string | undefined;
  /** The relative phrasing to display. */
  readonly children: React.ReactNode;
}

/**
 * A relative timestamp that keeps its absolute value reachable.
 *
 * @param props - The {@link RelativeTimeProps}.
 * @returns the rendered `<time>` element.
 */
export function RelativeTime({
  iso,
  timeZone,
  children,
  className,
  ...props
}: RelativeTimeProps): React.JSX.Element {
  // An unparseable instant must not take the row down with it: fall back to rendering the
  // caller's phrasing with no absolute rather than throwing inside a list.
  const parsed = new Date(iso);
  const exact = Number.isNaN(parsed.getTime())
    ? undefined
    : parsed.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        ...(timeZone === undefined ? {} : { timeZone }),
      });

  return (
    <time
      dateTime={iso}
      className={cn('tabular-nums', className)}
      {...(exact === undefined ? {} : { title: exact })}
      {...props}
    >
      {children}
    </time>
  );
}
