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
import { GOOGLE_CONNECTOR_SCOPES } from '@docket/identity-access/google-oauth-contract';
import {
  type CalendarConnectionOut,
  type CalendarConnectionStatus,
  type CalendarSourceGroupOut,
} from '@docket/planning/calendar-contract';
import { Calendar, ChevronDown, Layers, RefreshCw } from '@docket/ui/icons';
import {
  Badge,
  Button,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@docket/ui/primitives';
import NextLink from '@/components/docket-link';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { calendarSettingsDef } from '@/components/calendar/calendar-data';
import { CALENDAR_ITEMS_PREFIX } from '@/components/calendar/calendar-mutation-cache';
import { presentFailure, QueryLoadFailure } from '@/components/feedback';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

import { EmptyState, InlineBanner, notifyFailure, RelativeTime } from '@docket/ui/components';
import { SyncFeedback } from './calendar-sync-feedback';
import { relativeTime } from './format-time';
import { SettingsGroup } from './settings-group';
import { SETTINGS_NODES } from './settings-capabilities';

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

function connectionLabel(
  connectionId: string | null,
  connections: readonly CalendarConnectionOut[],
): string {
  if (connectionId === null) return 'Docket';
  const connection = connections.find((candidate) => candidate.id === connectionId);
  return connection?.accountEmail ?? connection?.accountName ?? 'Linked account';
}

interface LogicalCalendarRowProps {
  readonly group: CalendarSourceGroupOut;
  readonly connections: readonly CalendarConnectionOut[];
  readonly disabled: boolean;
  readonly onUpdate: (
    groupId: string,
    patch: { selected?: boolean; visibleByDefault?: boolean; preferredLayerId?: string },
  ) => void;
  readonly onSeparate: (groupId: string) => void;
  readonly onRemoveSource: (source: CalendarSourceGroupOut['sources'][number]) => void;
  readonly expandedSourceId: string | null;
}

/** One settings row for a logical calendar, with physical account sources on disclosure. */
function LogicalCalendarRow({
  group,
  connections,
  disabled,
  onUpdate,
  onSeparate,
  onRemoveSource,
  expandedSourceId,
}: LogicalCalendarRowProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const confirmedGroupId = group.persistedGroupId;
  useEffect(() => {
    if (expandedSourceId && group.sources.some((source) => source.layerId === expandedSourceId)) {
      setOpen(true);
    }
  }, [expandedSourceId, group.sources]);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="hover:bg-surface-container flex min-w-0 items-center gap-3 px-4 py-3 transition-colors">
        <Checkbox
          checked={group.selected}
          disabled={disabled}
          onChange={(event) => {
            onUpdate(group.id, {
              selected: event.currentTarget.checked,
              visibleByDefault: event.currentTarget.checked,
            });
          }}
          aria-label={`Toggle ${group.title} visibility`}
        />
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: group.color ?? 'var(--color-primary)' }}
        />
        <span className="text-on-surface text-body-medium min-w-0 flex-1 truncate">
          {group.title}
        </span>
        {group.sources.length > 1 ? (
          <span className="text-on-surface-variant text-body-small flex shrink-0 items-center gap-1">
            <Layers aria-hidden="true" className="size-4" />
            {group.sources.length} accounts
          </span>
        ) : null}
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${open ? 'Hide' : 'Show'} sources for ${group.title}`}
          >
            <ChevronDown
              aria-hidden="true"
              className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="bg-surface-container-low border-outline-variant flex flex-col border-t px-4 py-2">
          {group.sources.map((source) => {
            const preferred = source.layerId === group.preferredLayerId;
            return (
              <div key={source.layerId} className="flex min-w-0 items-center gap-2 py-2 pl-8">
                <span className="text-on-surface-variant text-body-small min-w-0 flex-1 truncate">
                  {connectionLabel(source.connectionId, connections)}
                </span>
                {preferred ? (
                  <Badge variant="secondary">Preferred</Badge>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => {
                      onUpdate(group.id, { preferredLayerId: source.layerId });
                    }}
                  >
                    Use as preferred
                  </Button>
                )}
                {source.management.canRemoveSubscription ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => {
                      onRemoveSource(source);
                    }}
                  >
                    Remove from account
                  </Button>
                ) : null}
              </div>
            );
          })}
          {group.provenance === 'confirmed' && confirmedGroupId ? (
            <div className="flex justify-end py-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  onSeparate(confirmedGroupId);
                }}
              >
                Separate calendars
              </Button>
            </div>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface ConnectionSettingsGroupProps {
  readonly connection: CalendarConnectionOut;
  readonly googleAvailable: boolean;
  readonly oauthPending: boolean;
  readonly onEnableEditing: () => void;
}

/** One linked account's health and granted Calendar access. */
function ConnectionSettingsGroup({
  connection,
  googleAvailable,
  oauthPending,
  onEnableEditing,
}: ConnectionSettingsGroupProps): JSX.Element {
  const scopeStatus = writeScopeStatus(connection);
  return (
    <SettingsGroup
      title={connection.accountEmail ?? connection.accountName ?? 'Google account'}
      discoverable={false}
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
      action={
        <Badge variant={STATUS_LABEL[connection.status].variant}>
          {STATUS_LABEL[connection.status].label}
        </Badge>
      }
      body="rows"
    >
      {connection.status === 'error' ? (
        <div className="px-4 py-2">
          <InlineBanner
            tone="critical"
            density="compact"
            title="Google Calendar could not be synced."
          >
            Reconnect this account to restore syncing.
          </InlineBanner>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <Badge variant={scopeStatus.variant}>{scopeStatus.label}</Badge>
        {!connection.scopeState?.calendarWrite && googleAvailable ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={oauthPending}
            onClick={onEnableEditing}
            title="Choose this Google account again to grant Calendar editing."
          >
            Enable calendar editing
          </Button>
        ) : null}
      </div>
    </SettingsGroup>
  );
}

interface CalendarGroupsProps {
  readonly groups: readonly CalendarSourceGroupOut[];
  readonly suggestions: readonly {
    key: string;
    title: string;
    layerIds: readonly string[];
  }[];
  readonly connections: readonly CalendarConnectionOut[];
  readonly disabled: boolean;
  readonly onCombine: (layerIds: readonly string[]) => void;
  readonly onUpdate: LogicalCalendarRowProps['onUpdate'];
  readonly onSeparate: LogicalCalendarRowProps['onSeparate'];
  readonly onRemoveSource: LogicalCalendarRowProps['onRemoveSource'];
  readonly expandedSourceId: string | null;
}

/** Logical calendar rows and the confirmation prompts that can create them. */
function CalendarGroups({
  groups,
  suggestions,
  connections,
  disabled,
  onCombine,
  onUpdate,
  onSeparate,
  onRemoveSource,
  expandedSourceId,
}: CalendarGroupsProps): JSX.Element | null {
  if (groups.length === 0 && suggestions.length === 0) return null;
  return (
    <>
      {suggestions.map((suggestion) => (
        <SettingsGroup key={suggestion.key} body="rows">
          <div className="flex min-w-0 items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-on-surface text-body-medium truncate">{suggestion.title}</p>
              <p className="text-on-surface-variant text-body-small">
                These calendars may represent the same schedule.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={disabled}
              onClick={() => {
                onCombine(suggestion.layerIds);
              }}
            >
              Combine these calendars?
            </Button>
          </div>
        </SettingsGroup>
      ))}
      {groups.length > 0 ? (
        <SettingsGroup capability={SETTINGS_NODES.connectionsDocketCalendars} body="rows">
          {groups.map((group) => (
            <LogicalCalendarRow
              key={group.id}
              group={group}
              connections={connections}
              disabled={disabled}
              onUpdate={onUpdate}
              onSeparate={onSeparate}
              onRemoveSource={onRemoveSource}
              expandedSourceId={expandedSourceId}
            />
          ))}
        </SettingsGroup>
      ) : null}
    </>
  );
}

/** Render and mutate Google Calendar account/calendar visibility settings. */
export default function GoogleCalendarSettings(): JSX.Element {
  const router = useRouter();
  const handledOAuthReturn = useRef(false);
  const [oauthPending, setOauthPending] = useState(false);
  // Seeded from the OAuth return's `?google=error` flag: the full-page redirect has no other way
  // to report a ceremony that did not finish. Cleared the moment a new attempt starts.
  const [authorizationIncomplete, setAuthorizationIncomplete] = useState(false);
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
  const query = useApiQuery(calendarSettingsDef());
  const identitiesQuery = useApiQuery(
    apiQueryOptions(
      queryKeys.identities(),
      () => api.v1.me.identities.$get(),
      'Could not check Google connection access.',
    ),
  );

  const updateGroup = useApiMutation({
    mutationFn: (vars: {
      id: string;
      patch: { selected?: boolean; visibleByDefault?: boolean; preferredLayerId?: string };
    }) =>
      unwrap(
        () =>
          api.v1.me.calendar['source-groups'][':id'].$patch({
            param: { id: vars.id },
            json: vars.patch,
          }),
        'Could not update calendar visibility.',
      ),
    invalidateKeys: [
      queryKeys.calendarSettings(),
      queryKeys.calendarLayers(),
      CALENDAR_ITEMS_PREFIX,
    ],
  });

  const combineGroup = useApiMutation({
    mutationFn: (vars: { layerIds: string[]; preferredLayerId: string }) =>
      unwrap(
        () => api.v1.me.calendar['source-groups'].$post({ json: vars }),
        'Could not combine these calendars.',
      ),
    invalidateKeys: [queryKeys.calendarSettings(), queryKeys.calendarLayers()],
  });

  const separateGroup = useApiMutation({
    mutationFn: (id: string) =>
      unwrap(
        () => api.v1.me.calendar['source-groups'][':id'].$delete({ param: { id } }),
        'Could not separate these calendars.',
      ),
    invalidateKeys: [queryKeys.calendarSettings(), queryKeys.calendarLayers()],
  });

  const removeSource = useApiMutation({
    mutationFn: (id: string) =>
      unwrap(
        () =>
          api.v1.me.calendar.sources[':id'].subscription.$delete({
            param: { id },
          }),
        'Could not remove this calendar from the linked account.',
      ),
    invalidateKeys: [
      queryKeys.calendarSettings(),
      queryKeys.calendarLayers(),
      CALENDAR_ITEMS_PREFIX,
    ],
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
    setAuthorizationIncomplete(false);
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
      presentFailure(error, 'Could not start Google Calendar authorization.');
      setOauthPending(false);
    }
  }, []);

  const startSourceManagementConsent = useCallback(async (layerId: string): Promise<void> => {
    setAuthorizationIncomplete(false);
    setOauthPending(true);
    setExpandedSourceId(layerId);
    try {
      const source = encodeURIComponent(layerId);
      const callbackURL = `${window.location.pathname}?google=source-management&source=${source}`;
      await authClient.linkSocial({
        provider: 'google',
        scopes: [...GOOGLE_CONNECTOR_SCOPES.calendarSourceManagement],
        callbackURL,
        errorCallbackURL: `${window.location.pathname}?google=error&source=${source}`,
      });
    } catch (error: unknown) {
      presentFailure(error, 'Could not request calendar-list access.');
      setOauthPending(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('google');
    if (!result || handledOAuthReturn.current) return;
    handledOAuthReturn.current = true;
    if (result === 'connected' || result === 'source-management') {
      if (result === 'source-management') setExpandedSourceId(params.get('source'));
      sync.mutate(undefined, {
        onSettled: () => {
          router.replace(window.location.pathname);
        },
      });
      return;
    }
    setAuthorizationIncomplete(true);
    router.replace(window.location.pathname);
  }, [router, sync]);

  const data = query.data;
  const mutationDisabled = [
    updateGroup.isPending,
    combineGroup.isPending,
    separateGroup.isPending,
    removeSource.isPending,
    sync.isPending,
  ].some(Boolean);
  const googleAvailable = identitiesQuery.data?.googleOAuth?.available === true;

  if (query.isPending) {
    // placeholder: the connected Google accounts and their calendars — which exist, which are
    // synced, and what each is named. Nothing about a connection roster is knowable in advance.
    return <div className="bg-surface-container-low h-48 animate-pulse rounded-xl" />;
  }

  if (query.isError) {
    return (
      <SettingsGroup>
        <QueryLoadFailure title="Google Calendar settings" query={query} />
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
            {sync.data ? (
              <SyncFeedback result={sync.data} calendars={data?.calendars ?? []} />
            ) : null}
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
          {googleAvailable && (data?.connections.length ?? 0) > 0 ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void startGoogleLink();
              }}
              disabled={oauthPending}
            >
              {oauthPending ? 'Opening Google…' : 'Add Google account'}
            </Button>
          ) : null}
          <Button asChild variant="secondary" size="sm">
            <NextLink href="/settings/connected-accounts">Connected accounts</NextLink>
          </Button>
          <Button
            variant="secondary"
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

      {authorizationIncomplete ? (
        <InlineBanner tone="critical" title="Google authorization did not complete.">
          It was canceled or could not be finished. Connect the account again to retry.
        </InlineBanner>
      ) : null}

      {(data?.connections ?? []).length === 0 ? (
        <SettingsGroup>
          <EmptyState
            icon={Calendar}
            title="No Google account linked"
            body="Link a Google account, then choose which of its calendars appear in Docket."
            frame="none"
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

      {(data?.connections ?? []).map((connection) => (
        <ConnectionSettingsGroup
          key={connection.id}
          connection={connection}
          googleAvailable={googleAvailable}
          oauthPending={oauthPending}
          onEnableEditing={() => {
            void startGoogleLink();
          }}
        />
      ))}

      <CalendarGroups
        groups={data?.sourceGroups ?? []}
        suggestions={data?.sourceGroupSuggestions ?? []}
        connections={data?.connections ?? []}
        disabled={mutationDisabled}
        onCombine={(layerIds) => {
          const preferredLayerId = layerIds[0];
          if (!preferredLayerId) return;
          combineGroup.mutate({ layerIds: [...layerIds], preferredLayerId });
        }}
        onUpdate={(groupId, patch) => {
          updateGroup.mutate({ id: groupId, patch });
        }}
        onSeparate={(groupId) => {
          separateGroup.mutate(groupId);
        }}
        onRemoveSource={(source) => {
          const connection = (data?.connections ?? []).find(
            (candidate) => candidate.id === source.connectionId,
          );
          if (connection?.scopeState?.sourceManagement !== true) {
            if (connection?.provider === 'google') {
              void startSourceManagementConsent(source.layerId);
            } else {
              notifyFailure({
                title: 'Reconnect this calendar account before removing the source.',
              });
            }
            return;
          }
          if (
            !window.confirm(
              'Remove this calendar from the linked account? Docket will keep its task links and saved metadata.',
            )
          ) {
            return;
          }
          removeSource.mutate(source.layerId, {
            onSuccess: () => {
              setExpandedSourceId(null);
            },
          });
        }}
        expandedSourceId={expandedSourceId}
      />
    </div>
  );
}
