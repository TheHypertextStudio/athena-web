'use client';

/** Dedicated nested settings UI for first-party Google Calendar. */
import type { CalendarConnectionStatus } from '@docket/types';
import { Calendar, RefreshCw } from '@docket/ui/icons';
import { Badge } from '@docket/ui/primitives';
import NextLink from 'next/link';
import type { JSX } from 'react';

import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

import { relativeTime } from './format-time';

const STATUS_LABEL: Record<
  CalendarConnectionStatus,
  { label: string; variant: 'secondary' | 'destructive' | 'outline' }
> = {
  connected: { label: 'Connected', variant: 'secondary' },
  error: { label: 'Needs attention', variant: 'destructive' },
  disconnected: { label: 'Disconnected', variant: 'outline' },
};

/** Props for {@link GoogleCalendarSettings}. */
export interface GoogleCalendarSettingsProps {
  /** The active organization id for the surrounding settings route. */
  orgId: string;
}

/** Format a Calendar sync result into compact feedback. */
function syncSummary(data: {
  eventsCreated: number;
  eventsUpdated: number;
  eventsDeleted: number;
  errors: readonly string[];
}): string {
  if (data.errors.length > 0) {
    return `${data.errors.length} sync issue${data.errors.length === 1 ? '' : 's'} found.`;
  }
  const changed = data.eventsCreated + data.eventsUpdated + data.eventsDeleted;
  if (changed === 0) return 'Up to date.';
  return `Updated ${changed} event${changed === 1 ? '' : 's'}.`;
}

/** Render and mutate Google Calendar account/calendar visibility settings. */
export function GoogleCalendarSettings({ orgId }: GoogleCalendarSettingsProps): JSX.Element {
  const query = useApiQuery(
    apiQueryOptions(
      queryKeys.calendarSettings(),
      () => api.v1.me.calendar.$get(),
      'Could not load Google Calendar settings.',
    ),
  );

  const updateCalendar = useApiMutation({
    mutationFn: (vars: { id: string; selected: boolean }) =>
      unwrap(
        () =>
          api.v1.me.calendar.calendars[':id'].$patch({
            param: { id: vars.id },
            json: { selected: vars.selected, visibleByDefault: vars.selected },
          }),
        'Could not update calendar visibility.',
      ),
    invalidateKeys: [queryKeys.calendarSettings()],
  });

  const sync = useApiMutation({
    mutationFn: () =>
      unwrap(() => api.v1.me.calendar.sync.$post({}), 'Could not sync Google Calendar.'),
    invalidateKeys: [queryKeys.calendarSettings()],
  });

  const data = query.data;
  const calendarsByConnection = new Map(
    (data?.connections ?? []).map((connection) => [
      connection.id,
      (data?.calendars ?? []).filter((calendar) => calendar.connectionId === connection.id),
    ]),
  );
  const mutationDisabled = updateCalendar.isPending || sync.isPending;
  const syncFeedback = sync.data ? syncSummary(sync.data) : null;

  if (query.isPending) {
    return <div className="bg-surface-container-low h-48 animate-pulse rounded-lg" />;
  }

  if (query.isError) {
    return (
      <div role="alert" className="border-outline-variant rounded-lg border p-4">
        <p className="text-destructive text-sm">{query.error.message}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="text-primary size-5" />
          <div>
            <p className="text-on-surface text-sm font-medium">
              {data?.connections.length ?? 0} account{data?.connections.length === 1 ? '' : 's'}
            </p>
            {syncFeedback ? (
              <p
                className={`text-xs ${
                  sync.data && sync.data.errors.length > 0
                    ? 'text-destructive'
                    : 'text-on-surface-variant'
                }`}
              >
                {syncFeedback}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <NextLink
            href={`/orgs/${orgId}/settings/connections`}
            className="border-outline-variant text-on-surface hover:bg-surface-container-high inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium"
          >
            Connected accounts
          </NextLink>
          <button
            type="button"
            onClick={() => {
              sync.mutate(undefined);
            }}
            disabled={mutationDisabled || (data?.connections.length ?? 0) === 0}
            className="border-outline-variant text-on-surface hover:bg-surface-container-high inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            <RefreshCw className={`size-4 ${sync.isPending ? 'animate-spin' : ''}`} />
            {sync.isPending ? 'Syncing' : 'Sync'}
          </button>
        </div>
      </div>

      {(data?.connections ?? []).length === 0 ? (
        <div className="border-outline-variant rounded-lg border p-4">
          <p className="text-on-surface-variant text-sm">
            Link a Google account from Connected accounts, then choose its visible calendars here.
          </p>
        </div>
      ) : null}

      {(data?.connections ?? []).map((connection) => {
        const calendars = calendarsByConnection.get(connection.id) ?? [];
        return (
          <section key={connection.id} className="border-outline-variant rounded-lg border">
            <div className="border-outline-variant flex items-center justify-between border-b px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-on-surface truncate text-sm font-medium">
                  {connection.accountEmail ?? connection.accountName ?? 'Google account'}
                </h2>
                <div className="text-on-surface-variant flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <span>
                    {connection.calendarsEnabled} of {connection.calendarsTotal} calendars visible
                  </span>
                  {connection.lastSyncedAt ? (
                    <span>Last synced {relativeTime(connection.lastSyncedAt)}</span>
                  ) : null}
                </div>
              </div>
              <Badge variant={STATUS_LABEL[connection.status].variant} className="font-normal">
                {STATUS_LABEL[connection.status].label}
              </Badge>
            </div>
            {connection.lastError ? (
              <p
                role="alert"
                className="text-destructive border-outline-variant border-b px-4 py-2 text-xs"
              >
                {connection.lastError}
              </p>
            ) : null}
            <ul className="divide-outline-variant divide-y">
              {calendars.map((calendar) => (
                <li key={calendar.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <label className="flex min-w-0 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={calendar.selected}
                      disabled={mutationDisabled}
                      onChange={(event) => {
                        updateCalendar.mutate({
                          id: calendar.id,
                          selected: event.currentTarget.checked,
                        });
                      }}
                      className="accent-primary size-4"
                    />
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: calendar.color ?? 'var(--color-primary)' }}
                    />
                    <span className="text-on-surface truncate text-sm">{calendar.title}</span>
                  </label>
                  <span className="text-on-surface-variant shrink-0 text-xs">
                    {calendar.primary ? 'Primary' : (calendar.accessRole ?? 'Calendar')}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
