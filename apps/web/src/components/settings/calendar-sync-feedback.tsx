'use client';

/**
 * `settings` — what a manual Google Calendar sync says about itself.
 *
 * @remarks
 * A pass that skipped some calendars is a partial failure with the rest of the page still usable,
 * so it stays in flow as a banner naming which calendars; a clean pass is one quiet line.
 */
import type { CalendarListOut } from '@docket/planning/calendar-contract';
import { InlineBanner } from '@docket/ui/components';
import type { JSX } from 'react';

/** What one manual Calendar sync did, as the sync route reports it. */
export interface CalendarSyncResult {
  readonly eventsCreated: number;
  readonly eventsUpdated: number;
  readonly eventsDeleted: number;
  /** One `<provider calendar id>: <provider message>` entry per calendar that did not sync. */
  readonly errors: readonly string[];
}

/**
 * Format a Calendar sync result into compact feedback.
 *
 * @param data - The sync route's result.
 * @param calendars - The calendars listed on the page, used to name the ones that failed.
 * @returns application-owned copy summarizing the pass.
 */
function syncSummary(data: CalendarSyncResult, calendars: readonly CalendarListOut[]): string {
  if (data.errors.length > 0) {
    // Each entry is `<provider calendar id>: <provider message>`. The message half is the
    // provider's own text and never reaches the screen, but the id half identifies a calendar
    // already listed below by name — so "2 sync issues found" can say *which two* instead of
    // leaving someone to guess which of eight calendars is stale.
    const named = data.errors
      .map((entry) => {
        const separator = entry.indexOf(':');
        return separator === -1 ? entry : entry.slice(0, separator);
      })
      .map((id) => calendars.find((calendar) => calendar.externalCalendarId === id)?.title)
      .filter((title): title is string => title !== undefined);
    const unique = [...new Set(named)];
    if (unique.length > 0) {
      return `Could not sync ${unique.join(', ')}. Everything else is up to date.`;
    }
    return `${data.errors.length} calendar${data.errors.length === 1 ? '' : 's'} could not be synced.`;
  }
  const changed = data.eventsCreated + data.eventsUpdated + data.eventsDeleted;
  if (changed === 0) return 'Up to date.';
  return `Updated ${changed} event${changed === 1 ? '' : 's'}.`;
}

/** Props for {@link SyncFeedback}. */
export interface SyncFeedbackProps {
  /** The last manual sync's result. */
  readonly result: CalendarSyncResult;
  /** The calendars listed on the page, used to name the ones that did not sync. */
  readonly calendars: readonly CalendarListOut[];
}

/**
 * The last manual sync's outcome.
 *
 * @param props - The {@link SyncFeedbackProps}.
 * @returns a banner when some calendars did not sync, otherwise one quiet status line.
 */
export function SyncFeedback({ result, calendars }: SyncFeedbackProps): JSX.Element {
  const summary = syncSummary(result, calendars);
  if (result.errors.length > 0) {
    return (
      <InlineBanner tone="critical" density="compact" title="Some calendars did not sync.">
        {summary}
      </InlineBanner>
    );
  }
  return <p className="text-on-surface-variant text-body-small">{summary}</p>;
}
