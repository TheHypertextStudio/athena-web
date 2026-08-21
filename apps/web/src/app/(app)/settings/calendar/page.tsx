'use client';

/**
 * Personal calendar preferences and permission-safe workspace sharing.
 *
 * @remarks
 * The single, canonical Calendar page. Scheduling defaults are caller-owned, and workspace
 * comparison sharing lists every shared workspace the caller belongs to (not one specific
 * workspace's route) — this never actually depended on an `orgId` route param, so the former
 * `/orgs/[orgId]/settings/calendar` (which this page used to delegate to, purely to reach a
 * workspace id it never used) has been removed.
 */
import { EmptyState } from '@docket/ui/components';
import { Users } from '@docket/ui/icons';
import { Button, Checkbox, Select } from '@docket/ui/primitives';
import NextLink from 'next/link';
import type {
  CalendarItemCreateIntent,
  CalendarLayerShareAccess,
  CalendarLayerShareCreate,
  CalendarPreferences,
  HubPreferences,
} from '@docket/types';
import { type JSX, useEffect, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { calendarLayersDef } from '@/components/calendar/calendar-data';
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
import { userErrorMessage } from '@/lib/problem';
import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';
import { LoadFailure } from '@/components/settings/load-failure';
import { SettingsGroup } from '@/components/settings/settings-group';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

/** The hour height an account gets before it has chosen one. */
const DEFAULT_HOUR_HEIGHT = 72;

const DEFAULTS: Required<Omit<CalendarPreferences, 'defaultLayerId'>> & {
  defaultLayerId: null;
} = {
  pixelsPerHour: DEFAULT_HOUR_HEIGHT,
  minLaneWidth: 160,
  defaultCreateIntent: 'event',
  defaultLayerId: null,
};

/**
 * The hour heights the calendar offers.
 *
 * @remarks
 * The stored value is pixels per hour, which the grid consumes and nobody has an opinion about. A
 * slider asked the reader to pick a number out of a continuous range to express a preference with
 * four useful answers, and then gave them no way to know which one they had picked. These are the
 * four answers.
 */
const HOUR_HEIGHTS = [
  { value: 40, label: 'Compact' },
  { value: 72, label: 'Comfortable' },
  { value: 120, label: 'Roomy' },
  { value: 180, label: 'Spacious' },
] as const;

/**
 * The offered height closest to what is stored.
 *
 * @remarks
 * A stored value need not be one of the options — it may predate them, or have come from the
 * slider these replaced. Snapping to the nearest keeps the control showing something true instead
 * of falling back to a default the account never chose.
 *
 * @param stored - The persisted pixels per hour. The caller resolves the default first, so this
 * never sees an absent value.
 * @returns the closest offered value.
 */
function nearestHourHeight(stored: number): number {
  return HOUR_HEIGHTS.reduce<number>(
    (best, option) =>
      Math.abs(option.value - stored) < Math.abs(best - stored) ? option.value : best,
    DEFAULT_HOUR_HEIGHT,
  );
}

/** Calendar settings route. */
export default function CalendarSettingsPage(): JSX.Element {
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
    <SettingsSectionPage sectionKey="calendar" loading={loading}>
      {loadFailed ? (
        <LoadFailure
          message={userErrorMessage(
            preferencesQ.error ?? layersQ.error,
            'Could not load your calendar settings.',
          )}
          retrying
        />
      ) : (
        <>
          <SettingsGroup
            title="New calendar items"
            description="What dragging across the calendar creates. Applies on every device."
          >
            <label className="text-label-large flex flex-col gap-1">
              <span>Type</span>
              <Select
                value={draft.defaultCreateIntent ?? DEFAULTS.defaultCreateIntent}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    defaultCreateIntent: event.target.value as CalendarItemCreateIntent,
                  }));
                }}
              >
                <option value="event">Event</option>
                <option value="timebox">Timebox</option>
              </Select>
              {/* The one genuinely interesting choice on this page was two bare nouns. An event is a
                commitment with other people in it; a timebox is time you are protecting for
                yourself, and it can carry the task you are protecting it for. */}
              <span className="text-on-surface-variant text-body-small font-normal">
                {(draft.defaultCreateIntent ?? DEFAULTS.defaultCreateIntent) === 'event'
                  ? 'An appointment or meeting.'
                  : 'Reserved working time, which can be linked to a task.'}
              </span>
            </label>

            <label className="text-label-large flex flex-col gap-1">
              <span>Calendar</span>
              <Select
                value={draft.defaultLayerId ?? ''}
                onChange={(event) => {
                  const layer = destinations.find(
                    (candidate) => candidate.id === event.target.value,
                  );
                  setDraft((current) => ({ ...current, defaultLayerId: layer?.id ?? null }));
                }}
              >
                <option value="">Docket calendar</option>
                {destinations.map((layer) => (
                  <option key={layer.id} value={layer.id}>
                    {layer.title}
                  </option>
                ))}
              </Select>
            </label>
          </SettingsGroup>

          <SettingsGroup title="Display">
            <label className="text-label-large flex flex-col gap-1">
              {/* Day-column width used to sit beside this as a second slider. It was a canvas
                  layout constant wearing the clothes of a preference: the grid already fits itself
                  to the viewport, so asking somebody for a minimum column width asked them to
                  solve a layout problem the product had not told them it had. The stored value is
                  untouched and the grid still honours it; it is simply no longer something a
                  person is asked to have an opinion about. */}
              <span>Hour height</span>
              <Select
                value={String(nearestHourHeight(draft.pixelsPerHour ?? DEFAULT_HOUR_HEIGHT))}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    pixelsPerHour: Number(event.target.value),
                  }));
                }}
              >
                {HOUR_HEIGHTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </label>

            {savePreferences.isError ? (
              <LoadFailure
                message={userErrorMessage(savePreferences.error, 'Could not save this preference.')}
              />
            ) : (
              <p aria-live="polite" className="text-on-surface-variant text-body-small h-4">
                {savePreferences.isPending ? 'Saving…' : savePreferences.isSuccess ? 'Saved' : ''}
              </p>
            )}
          </SettingsGroup>
        </>
      )}

      <SettingsGroup
        title="What coworkers can see"
        description="Nothing is shared until you tick a calendar here. Events your provider marks private only ever show as busy."
      >
        {sharedWorkspaces.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No shared workspaces"
            body="Calendar sharing is between people in the same workspace. Yours is just you for now."
            frame="none"
            action={
              <Button asChild variant="outline">
                <NextLink href="/workspaces/new">Create a shared workspace</NextLink>
              </Button>
            }
          />
        ) : (
          <>
            <label className="text-label-large flex flex-col gap-1">
              <span>Share with</span>
              <Select
                value={workspaceId}
                onChange={(event) => {
                  setWorkspaceId(event.target.value);
                }}
              >
                {sharedWorkspaces.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </Select>
            </label>

            <div className="bg-surface-container overflow-hidden rounded-xl">
              {layers.map((layer) => {
                const access = shareDraft[layer.id];
                return (
                  <div
                    key={layer.id}
                    className="hover:bg-surface-container-high flex flex-wrap items-center gap-3 px-4 py-3 transition-colors"
                  >
                    <label className="text-body-medium flex min-w-0 flex-1 items-center gap-2">
                      <Checkbox
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
                    <Select
                      aria-label={`What coworkers see of ${layer.title}`}
                      disabled={access === undefined}
                      value={access ?? 'details'}
                      onChange={(event) => {
                        setShareDraft((current) => ({
                          ...current,
                          [layer.id]: event.target.value as CalendarLayerShareAccess,
                        }));
                      }}
                    >
                      <option value="details">Full details</option>
                      <option value="busy">Busy only</option>
                    </Select>
                  </div>
                );
              })}
            </div>

            {sharesQ.isError || replaceShares.isError ? (
              <LoadFailure
                message={userErrorMessage(
                  sharesQ.error ?? replaceShares.error,
                  'Could not save what coworkers can see.',
                )}
              />
            ) : (
              <p aria-live="polite" className="text-on-surface-variant text-body-small h-4">
                {replaceShares.isPending ? 'Saving…' : replaceShares.isSuccess ? 'Saved' : ''}
              </p>
            )}
          </>
        )}
      </SettingsGroup>
    </SettingsSectionPage>
  );
}
