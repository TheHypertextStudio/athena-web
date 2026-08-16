'use client';

/**
 * Dedicated nested settings UI for first-party Google Calendar.
 *
 * @remarks
 * Two nested groupings, additive over the original connections→calendars settings (which keeps
 * working unchanged): each linked account also shows its write-scope status (from
 * {@link CalendarConnectionOut.scopeState}) and its layers (Task 8's `calendarLayersDef`/
 * `useUpdateLayerVisibility`, rendered via the shared {@link CalendarLayerPanel} the full calendar
 * view also uses), and any Docket-native layers (no linked account) get their own section below
 * the connections. Connect and re-consent actions request the minimum Calendar scopes and return
 * here to trigger an immediate sync.
 */
import {
  GOOGLE_CONNECTOR_SCOPES,
  type CalendarConnectionOut,
  type CalendarConnectionStatus,
  type CalendarListOut,
} from '@docket/types';
import { Calendar, RefreshCw } from '@docket/ui/icons';
import { Checkbox, Badge, Button } from '@docket/ui/primitives';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import CalendarLayerPanel from '@/components/calendar/calendar-layer-panel';
import { calendarLayersDef, calendarSettingsDef } from '@/components/calendar/calendar-data';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { userErrorMessage } from '@/lib/problem';
import {
  apiQueryOptions,
  queryKeys,
  unwrap,
  useApiListQuery,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';

import { EmptyState, RelativeTime } from '@docket/ui/components';
import { relativeTime } from './format-time';
import { SettingRow } from './setting-row';
import { SettingsGroup } from './settings-group';

const STATUS_LABEL: Record<
  CalendarConnectionStatus,
  { label: string; variant: 'secondary' | 'destructive' | 'outline' }
> = {
  connected: { label: 'Connected', variant: 'secondary' },
  error: { label: 'Needs attention', variant: 'destructive' },
  disconnected: { label: 'Disconnected', variant: 'outline' },
  reauth_required: { label: 'Needs reauthorization', variant: 'destructive' },
};

/** A write-scope badge's label + tone. */
interface WriteScopeStatus {
  /** The badge label. */
  label: string;
  /** The badge tone. */
  variant: 'secondary' | 'outline';
}

/** The write-scope badge + re-consent affordance for one connection's `scopeState`. */
function writeScopeStatus(connection: CalendarConnectionOut): WriteScopeStatus {
  if (!connection.scopeState) return { label: 'Write access unknown', variant: 'outline' };
  return connection.scopeState.calendarWrite
    ? { label: 'Calendar editing enabled', variant: 'secondary' }
    : { label: 'Calendar read-only', variant: 'outline' };
}

/** Format a Calendar sync result into compact feedback. */
function syncSummary(
  data: {
    eventsCreated: number;
    eventsUpdated: number;
    eventsDeleted: number;
    errors: readonly string[];
  },
  calendars: readonly CalendarListOut[],
): string {
  if (data.errors.length > 0) {
    // Each entry is `<provider calendar id>: <provider message>`. The message half is the
    // provider's own text and never reaches the screen, but the id half identifies a calendar
    // already listed below by name — so "2 sync issues found" can say *which two* instead of
    // leaving someone to guess which of eight calendars is stale.
    const named = data.errors
      .map((entry) => entry.slice(0, entry.indexOf(':')))
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

/** Render and mutate Google Calendar account/calendar visibility settings. */
export default function GoogleCalendarSettings(): JSX.Element {
  const router = useRouter();
  const handledOAuthReturn = useRef(false);
  const [oauthPending, setOauthPending] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const query = useApiQuery(calendarSettingsDef());
  const identitiesQuery = useApiQuery(
    apiQueryOptions(
      queryKeys.identities(),
      () => api.v1.me.identities.$get(),
      'Could not check Google connection access.',
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
    invalidateKeys: [
      queryKeys.calendarSettings(),
      queryKeys.calendarLayers(),
      queryKeys.identities(),
    ],
  });

  const startGoogleLink = useCallback(async (): Promise<void> => {
    setOauthError(null);
    setOauthPending(true);
    try {
      const callbackURL = `${window.location.pathname}?google=connected`;
      await authClient.linkSocial({
        provider: 'google',
        scopes: [...GOOGLE_CONNECTOR_SCOPES.calendar],
        callbackURL,
        errorCallbackURL: `${window.location.pathname}?google=error`,
      });
    } catch (error: unknown) {
      setOauthError(userErrorMessage(error, 'Could not start Google Calendar authorization.'));
      setOauthPending(false);
    }
  }, []);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('google');
    if (!result || handledOAuthReturn.current) return;
    handledOAuthReturn.current = true;
    if (result === 'connected') {
      sync.mutate(undefined, {
        onSettled: () => {
          router.replace(window.location.pathname);
        },
      });
      return;
    }
    setOauthError('Google authorization was canceled or could not be completed.');
    router.replace(window.location.pathname);
  }, [router, sync]);

  const layersQuery = useApiListQuery(calendarLayersDef());
  const layers = layersQuery.data?.items ?? [];

  const data = query.data;
  const calendarsByConnection = new Map(
    (data?.connections ?? []).map((connection) => [
      connection.id,
      (data?.calendars ?? []).filter((calendar) => calendar.connectionId === connection.id),
    ]),
  );
  const layersByConnection = new Map(
    (data?.connections ?? []).map((connection) => [
      connection.id,
      layers.filter((layer) => layer.connectionId === connection.id),
    ]),
  );
  const nativeLayers = layers.filter((layer) => layer.connectionId === null);
  const mutationDisabled = updateCalendar.isPending || sync.isPending;
  const syncFeedback = sync.data ? syncSummary(sync.data, data?.calendars ?? []) : null;
  // Both writes were fire-and-forget: a refused visibility toggle snapped the checkbox back with
  // no explanation, and a failed manual sync left the summary line showing the previous run.
  const writeError = updateCalendar.isError
    ? userErrorMessage(updateCalendar.error, 'Could not update calendar visibility.')
    : sync.isError
      ? userErrorMessage(sync.error, 'Could not sync Google Calendar.')
      : null;
  const googleAvailable = identitiesQuery.data?.googleOAuth?.available === true;

  if (query.isPending) {
    // placeholder: the connected Google accounts and their calendars — which exist, which are
    // synced, and what each is named. Nothing about a connection roster is knowable in advance.
    return <div className="bg-surface-container-low h-48 animate-pulse rounded-xl" />;
  }

  if (query.isError) {
    return (
      <SettingsGroup role="alert">
        <p className="text-error text-body-medium">
          {userErrorMessage(query.error, 'Could not load Google Calendar settings.')}
        </p>
      </SettingsGroup>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="text-primary size-5" />
          <div>
            <p className="text-on-surface text-label-large">
              {data?.connections.length ?? 0} account{data?.connections.length === 1 ? '' : 's'}
            </p>
            {writeError ? (
              <p role="alert" className="text-error text-body-small">
                {writeError}
              </p>
            ) : syncFeedback ? (
              <p
                className={`text-body-small ${
                  sync.data && sync.data.errors.length > 0
                    ? 'text-error'
                    : 'text-on-surface-variant'
                }`}
              >
                {syncFeedback}
              </p>
            ) : null}
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
          {googleAvailable && (data?.connections.length ?? 0) > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void startGoogleLink();
              }}
              disabled={oauthPending}
            >
              {oauthPending ? 'Opening Google…' : 'Add Google account'}
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <NextLink href="/settings/connected-accounts">Connected accounts</NextLink>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              sync.mutate(undefined);
            }}
            disabled={mutationDisabled || (data?.connections.length ?? 0) === 0}
            className="col-span-2 sm:col-span-1"
          >
            <RefreshCw className={`size-4 ${sync.isPending ? 'animate-spin' : ''}`} />
            {sync.isPending ? 'Syncing' : 'Sync'}
          </Button>
        </div>
      </div>

      {oauthError ? (
        <p role="alert" className="text-error text-body-medium">
          {oauthError}
        </p>
      ) : null}

      {(data?.connections ?? []).length === 0 ? (
        <SettingsGroup>
          <EmptyState
            icon={Calendar}
            title="No Google account linked"
            body="Link a Google account, then choose which of its calendars appear in Docket."
            className="border-none bg-transparent"
            {...(googleAvailable
              ? {
                  cta: {
                    label: oauthPending ? 'Opening Google…' : 'Connect Google account',
                    disabled: oauthPending,
                    onClick: () => {
                      void startGoogleLink();
                    },
                  },
                }
              : {})}
          />
        </SettingsGroup>
      ) : null}

      {(data?.connections ?? []).map((connection) => {
        const calendars = calendarsByConnection.get(connection.id) ?? [];
        return (
          <SettingsGroup key={connection.id} body="rows">
            <SettingRow
              label={connection.accountEmail ?? connection.accountName ?? 'Google account'}
              description={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span>
                    {connection.calendarsEnabled} of {connection.calendarsTotal} calendars visible
                  </span>
                  {connection.lastSyncedAt ? (
                    <span>
                      Last synced{' '}
                      <RelativeTime iso={connection.lastSyncedAt}>
                        {relativeTime(connection.lastSyncedAt)}
                      </RelativeTime>
                    </span>
                  ) : null}
                </span>
              }
              trailing={
                <Badge variant={STATUS_LABEL[connection.status].variant}>
                  {STATUS_LABEL[connection.status].label}
                </Badge>
              }
            />
            {connection.status === 'error' ? (
              <p role="alert" className="text-error bg-surface-container text-body-small px-4 py-2">
                Google Calendar could not be synced. Reconnect it to restore syncing.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <Badge variant={writeScopeStatus(connection).variant}>
                {writeScopeStatus(connection).label}
              </Badge>
              {!connection.scopeState?.calendarWrite && googleAvailable ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={oauthPending}
                  onClick={() => {
                    void startGoogleLink();
                  }}
                  title="Choose this Google account again to grant Calendar editing."
                >
                  Enable calendar editing
                </Button>
              ) : null}
            </div>
            <ul className="flex flex-col">
              {calendars.map((calendar) => (
                <li
                  key={calendar.id}
                  className="hover:bg-surface-container flex items-center justify-between gap-3 px-4 py-3 transition-colors"
                >
                  <label className="flex min-w-0 items-center gap-3">
                    <Checkbox
                      checked={calendar.selected}
                      disabled={mutationDisabled}
                      onChange={(event) => {
                        updateCalendar.mutate({
                          id: calendar.id,
                          selected: event.currentTarget.checked,
                        });
                      }}
                    />
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: calendar.color ?? 'var(--color-primary)' }}
                    />
                    <span className="text-on-surface text-body-medium truncate">
                      {calendar.title}
                    </span>
                  </label>
                  <span className="text-on-surface-variant text-body-small shrink-0">
                    {calendar.primary ? 'Primary' : (calendar.accessRole ?? 'Calendar')}
                  </span>
                </li>
              ))}
            </ul>
            {(layersByConnection.get(connection.id) ?? []).length > 0 ? (
              <div className="flex flex-col gap-1.5 px-4 pt-1 pb-3">
                <h3 className="text-on-surface-variant text-label-medium">Layers</h3>
                <CalendarLayerPanel layers={layersByConnection.get(connection.id) ?? []} />
              </div>
            ) : null}
          </SettingsGroup>
        );
      })}

      {nativeLayers.length > 0 ? (
        <SettingsGroup title="Docket calendars">
          <CalendarLayerPanel layers={nativeLayers} />
        </SettingsGroup>
      ) : null}
    </div>
  );
}
