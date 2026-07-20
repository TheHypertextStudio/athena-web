import NextLink from 'next/link';
import type { JSX } from 'react';

/** Props for {@link CalendarConnectionRow}. */
export interface CalendarConnectionRowProps {
  /** The calendar provider's display name. */
  name: string;
  /** One-line description of what connecting the calendar does. */
  effect: string;
  /** Route to the nested calendar configuration page. */
  href: string;
}

/**
 * The Google Calendar connection row: a link-out to its dedicated multi-account configuration page.
 *
 * @remarks
 * Calendar isn't a generic provider card — its accounts and per-calendar visibility have their own
 * nested surface — so it renders as a single row that links there rather than connecting inline.
 */
export function CalendarConnectionRow({
  name,
  effect,
  href,
}: CalendarConnectionRowProps): JSX.Element {
  return (
    <NextLink
      href={href}
      className="border-outline-variant bg-surface-container-low hover:bg-surface-container flex items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors"
    >
      <span className="min-w-0">
        <span className="text-on-surface block truncate text-sm font-medium">{name}</span>
        <span className="text-on-surface-variant block truncate text-xs">{effect}</span>
        <span className="text-on-surface-variant block truncate text-xs">
          Accounts and visible calendars
        </span>
      </span>
      <span className="text-primary shrink-0 text-sm font-medium">Configure</span>
    </NextLink>
  );
}
