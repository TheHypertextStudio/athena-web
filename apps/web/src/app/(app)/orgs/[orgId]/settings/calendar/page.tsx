'use client';

/** Personal calendar preferences and permission-safe workspace sharing. */
import type {
  CalendarItemCreateIntent,
  CalendarLayerShareAccess,
  CalendarLayerShareCreate,
  CalendarPreferences,
  HubPreferences,
} from '@docket/types';
import { type JSX, use, useEffect, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { calendarLayersDef } from '@/components/calendar/calendar-data';
import { SectionHeader } from '@/components/settings/section-header';
import { api } from '@/lib/api';
import {
  apiQueryOptions,
  queryKeys,
  STALE,
  unwrap,
  useApiListQuery,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';
import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';

const DEFAULTS: Required<Omit<CalendarPreferences, 'defaultLayerId'>> & {
  defaultLayerId: null;
} = {
  pixelsPerHour: 72,
  minLaneWidth: 240,
  defaultCreateIntent: 'event',
  defaultLayerId: null,
};

/** Calendar settings route. */
export default function CalendarSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): JSX.Element {
  use(params);
  const { orgs } = useActiveOrg();
  const sharedWorkspaces = useMemo(() => orgs.filter((org) => !org.isPersonal), [orgs]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [draft, setDraft] = useState<CalendarPreferences>(DEFAULTS);
  const [shareDraft, setShareDraft] = useState<Record<string, CalendarLayerShareAccess>>({});

  useEffect(() => {
    if (!workspaceId && sharedWorkspaces[0]) setWorkspaceId(sharedWorkspaces[0].id);
  }, [sharedWorkspaces, workspaceId]);

  const preferencesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.hubPreferences(),
      () => api.v1.hub.preferences.$get(),
      'Could not load calendar preferences.',
      { staleTime: STALE.standard },
    ),
  );
  const layersQ = useApiListQuery(calendarLayersDef());
  const sharesQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.calendarShares(workspaceId || 'none'),
      () =>
        api.v1.me.calendar.shares[':organizationId'].$get({
          param: { organizationId: workspaceId },
        }),
      'Could not load calendar sharing.',
      { enabled: Boolean(workspaceId), staleTime: STALE.standard },
    ),
  );

  useEffect(() => {
    if (!preferencesQ.data) return;
    setDraft({ ...DEFAULTS, ...preferencesQ.data.calendar });
  }, [preferencesQ.data]);
  useEffect(() => {
    setShareDraft(
      Object.fromEntries((sharesQ.data?.items ?? []).map((share) => [share.layerId, share.access])),
    );
  }, [sharesQ.data]);

  const savePreferences = useApiMutation<HubPreferences, CalendarPreferences>({
    mutationFn: (calendar) =>
      unwrap(
        () => api.v1.hub.preferences.$patch({ json: { calendar } }),
        'Could not save calendar preferences.',
      ),
    invalidateKeys: [queryKeys.hubPreferences()],
  });
  const replaceShares = useApiMutation<
    { items: unknown[] },
    { organizationId: string; shares: CalendarLayerShareCreate[] }
  >({
    mutationFn: ({ organizationId, shares }) =>
      unwrap(
        () =>
          api.v1.me.calendar.shares[':organizationId'].$put({
            param: { organizationId },
            json: { shares },
          }),
        'Could not save calendar sharing.',
      ),
    invalidateKeys: [queryKeys.calendarShares(workspaceId || 'none')],
  });

  const layers = layersQ.data?.items ?? [];
  const destinations = layers.filter(
    (layer) => layer.sourceKind === 'native_blocks' || layer.editableCore,
  );
  const loading = preferencesQ.isPending || layersQ.isPending;
  const loadFailed = preferencesQ.isError || layersQ.isError;

  // The persisted server values the drafts diff against, normalized to the same shape as each draft
  // so a freshly-loaded (untouched) form never counts as dirty.
  const persistedPreferences = preferencesQ.data
    ? { ...DEFAULTS, ...preferencesQ.data.calendar }
    : undefined;
  const persistedShares = sharesQ.data
    ? Object.fromEntries(sharesQ.data.items.map((share) => [share.layerId, share.access]))
    : undefined;

  // Autosave replaces the former "Save defaults" / "Save sharing" buttons: edits persist on a quiet
  // debounce, firing the very same mutations, and never on mount or for an unchanged value.
  useDebouncedAutosave({
    value: draft,
    baseline: persistedPreferences,
    ready: preferencesQ.isSuccess,
    save: (calendar) => {
      savePreferences.mutate(calendar);
    },
  });
  useDebouncedAutosave({
    value: shareDraft,
    baseline: persistedShares,
    ready: Boolean(workspaceId) && sharesQ.isSuccess && !sharesQ.isFetching,
    save: (next) => {
      replaceShares.mutate({
        organizationId: workspaceId,
        shares: layers.flatMap((layer) => {
          const access = next[layer.id];
          return access ? [{ layerId: layer.id, access }] : [];
        }),
      });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Calendar"
        description="Choose fluid scheduling defaults and the layers coworkers may compare."
      />

      {loading ? (
        <p className="text-on-surface-variant text-sm">Loading calendar settings…</p>
      ) : loadFailed ? (
        <p role="alert" className="text-destructive text-sm">
          Calendar settings are temporarily unavailable.
        </p>
      ) : (
        <section aria-labelledby="calendar-defaults" className="flex max-w-2xl flex-col gap-4">
          <div>
            <h3 id="calendar-defaults" className="text-on-surface text-sm font-semibold">
              Scheduling defaults
            </h3>
            <p className="text-on-surface-variant text-xs">
              These follow you across devices; the canvas still adapts to every viewport.
            </p>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">New regions become</span>
            <select
              value={draft.defaultCreateIntent ?? DEFAULTS.defaultCreateIntent}
              onChange={(event) => {
                setDraft((current) => ({
                  ...current,
                  defaultCreateIntent: event.target.value as CalendarItemCreateIntent,
                }));
              }}
              className="border-input bg-background h-9 rounded-md border px-2"
            >
              <option value="event">Event</option>
              <option value="timebox">Timebox</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Default event calendar</span>
            <select
              value={draft.defaultLayerId ?? ''}
              onChange={(event) => {
                const layer = destinations.find((candidate) => candidate.id === event.target.value);
                setDraft((current) => ({ ...current, defaultLayerId: layer?.id ?? null }));
              }}
              className="border-input bg-background h-9 rounded-md border px-2"
            >
              <option value="">Docket calendar</option>
              {destinations.map((layer) => (
                <option key={layer.id} value={layer.id}>
                  {layer.title}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">
              Vertical scale · {String(draft.pixelsPerHour ?? DEFAULTS.pixelsPerHour)} px/hour
            </span>
            <input
              type="range"
              min={24}
              max={240}
              step={4}
              value={draft.pixelsPerHour ?? DEFAULTS.pixelsPerHour}
              onChange={(event) => {
                setDraft((current) => ({
                  ...current,
                  pixelsPerHour: Number(event.target.value),
                }));
              }}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">
              Preferred lane width · {String(draft.minLaneWidth ?? DEFAULTS.minLaneWidth)} px
            </span>
            <input
              type="range"
              min={160}
              max={640}
              step={8}
              value={draft.minLaneWidth ?? DEFAULTS.minLaneWidth}
              onChange={(event) => {
                setDraft((current) => ({
                  ...current,
                  minLaneWidth: Number(event.target.value),
                }));
              }}
            />
          </label>

          {savePreferences.isError ? (
            <p role="alert" className="text-destructive text-xs">
              Could not save these preferences.
            </p>
          ) : (
            <p aria-live="polite" className="text-on-surface-variant h-4 text-xs">
              {savePreferences.isPending ? 'Saving…' : savePreferences.isSuccess ? 'Saved' : ''}
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="calendar-sharing" className="flex max-w-2xl flex-col gap-4">
        <div>
          <h3 id="calendar-sharing" className="text-on-surface text-sm font-semibold">
            Workspace comparison
          </h3>
          <p className="text-on-surface-variant text-xs">
            Nothing is shared until you enable a layer. Provider-private events remain busy-only.
          </p>
        </div>

        {sharedWorkspaces.length === 0 ? (
          <p className="text-on-surface-variant text-sm">
            Join a shared workspace to compare schedules.
          </p>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Workspace</span>
              <select
                value={workspaceId}
                onChange={(event) => {
                  setWorkspaceId(event.target.value);
                }}
                className="border-input bg-background h-9 rounded-md border px-2"
              >
                {sharedWorkspaces.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="border-outline-variant divide-outline-variant divide-y rounded-lg border">
              {layers.map((layer) => {
                const access = shareDraft[layer.id];
                return (
                  <div key={layer.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={access !== undefined}
                        onChange={(event) => {
                          setShareDraft((current) => {
                            if (event.target.checked) {
                              return { ...current, [layer.id]: 'details' };
                            }
                            return Object.fromEntries(
                              Object.entries(current).filter(([id]) => id !== layer.id),
                            );
                          });
                        }}
                      />
                      <span className="truncate">{layer.title}</span>
                    </label>
                    {access ? (
                      <select
                        aria-label={`Sharing level for ${layer.title}`}
                        value={access}
                        onChange={(event) => {
                          setShareDraft((current) => ({
                            ...current,
                            [layer.id]: event.target.value as CalendarLayerShareAccess,
                          }));
                        }}
                        className="border-input bg-background h-8 rounded-md border px-2 text-xs"
                      >
                        <option value="details">Details</option>
                        <option value="busy">Busy only</option>
                      </select>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {sharesQ.isError || replaceShares.isError ? (
              <p role="alert" className="text-destructive text-xs">
                Calendar sharing is temporarily unavailable.
              </p>
            ) : (
              <p aria-live="polite" className="text-on-surface-variant h-4 text-xs">
                {replaceShares.isPending ? 'Saving…' : replaceShares.isSuccess ? 'Saved' : ''}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
