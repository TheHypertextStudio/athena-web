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
} from '@docket/types';
import { Calendar, RefreshCw } from '@docket/ui/icons';
import { Badge, Button } from '@docket/ui/primitives';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import CalendarLayerPanel from '@/components/calendar/calendar-layer-panel';
import { calendarLayersDef, calendarSettingsDef } from '@/components/calendar/calendar-data';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { readError } from '@/lib/problem';
import {
  apiQueryOptions,
  queryKeys,
  unwrap,
  useApiListQuery,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';

import { relativeTime } from './format-time';

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
export default function GoogleCalendarSettings({
  orgId,
}: GoogleCalendarSettingsProps): JSX.Element {
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
      setOauthError(readError(error, 'Could not start Google Calendar authorization.'));
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
  const syncFeedback = sync.data ? syncSummary(sync.data) : null;
  const googleAvailable = identitiesQuery.data?.googleOAuth?.available === true;

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
          <Button
            size="sm"
            onClick={() => {
              void startGoogleLink();
            }}
            disabled={!googleAvailable || oauthPending}
            title={
              googleAvailable
                ? undefined
                : 'Google Calendar is currently limited to production test users.'
            }
          >
            {oauthPending
              ? 'Opening Google…'
              : (data?.connections.length ?? 0) > 0
                ? 'Add Google account'
                : 'Connect Google account'}
          </Button>
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

      {oauthError ? (
        <p role="alert" className="text-destructive text-sm">
          {oauthError}
        </p>
      ) : null}

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
            <div className="border-outline-variant flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
              <Badge variant={writeScopeStatus(connection).variant} className="font-normal">
                {writeScopeStatus(connection).label}
              </Badge>
              {!connection.scopeState?.calendarWrite ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!googleAvailable || oauthPending}
                  onClick={() => {
                    void startGoogleLink();
                  }}
                  title="Choose this Google account again to grant Calendar editing."
                >
                  Enable calendar editing
                </Button>
              ) : null}
            </div>
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
            {(layersByConnection.get(connection.id) ?? []).length > 0 ? (
              <div className="border-outline-variant border-t px-4 py-3">
                <h3 className="text-on-surface-variant mb-1.5 text-xs font-semibold tracking-wide uppercase">
                  Layers
                </h3>
                <CalendarLayerPanel layers={layersByConnection.get(connection.id) ?? []} />
              </div>
            ) : null}
          </section>
        );
      })}

      {nativeLayers.length > 0 ? (
        <section className="border-outline-variant rounded-lg border p-4">
          <h2 className="text-on-surface mb-2 text-sm font-medium">Docket-native</h2>
          <CalendarLayerPanel layers={nativeLayers} />
        </section>
      ) : null}
    </div>
  );
}
