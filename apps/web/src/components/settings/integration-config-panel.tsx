'use client';

/**
 * `settings` — the per-account connector configuration panel.
 *
 * @remarks
 * Renders the "how should this account sync" controls the user asked for, scoped to ONE linked
 * integration (one Google account): which task lists to sync, the sync direction (import-only vs
 * two-way write-back), and which Docket team mirrored work lands in. Reads the current values off
 * the integration's `config`/`writeBack`, fetches the provider's selectable lists from
 * `GET /:id/lists`, and persists changes through `PATCH /:id` — the same server truth the rest of
 * the tab renders from.
 */
import type { ConnectorConfig, IntegrationOut, TeamOut } from '@docket/types';
import { cn } from '@docket/ui';
import { Check } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useState } from 'react';

import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

/** Props for {@link IntegrationConfigPanel}. */
export interface IntegrationConfigPanelProps {
  /** The active organization id. */
  orgId: string;
  /** The integration (one linked account) being configured. */
  integration: IntegrationOut;
  /** Teams in the org, for the "land mirrored work in" selector. */
  teams: readonly TeamOut[];
}

/** The two sync directions, mapped onto the `writeBack` flag (both stay `mirror` syncMode). */
const DIRECTIONS = [
  {
    twoWay: false,
    title: 'Import only',
    detail: 'Pull Google Tasks into Docket. Local edits stay in Docket.',
  },
  {
    twoWay: true,
    title: 'Two-way',
    detail: 'Edits, completions, and deletions sync in both directions (last edit wins).',
  },
] as const;

/** The per-account "which lists, which direction, which team" configuration form. */
export function IntegrationConfigPanel({
  orgId,
  integration,
  teams,
}: IntegrationConfigPanelProps): JSX.Element {
  const cfg = integration.config as ConnectorConfig;
  const [twoWay, setTwoWay] = useState(integration.writeBack);
  const [teamId, setTeamId] = useState(cfg.teamId ?? '');
  // `allMode` (sync every list) is the default; an explicit subset is stored in `listIds`.
  const [allMode, setAllMode] = useState(!(cfg.listIds && cfg.listIds.length > 0));
  const [listIds, setListIds] = useState<string[]>(cfg.listIds ?? []);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listsQ = useApiQuery(
    apiQueryOptions(
      ['org', orgId, 'integrations', integration.id, 'lists'] as const,
      () =>
        api.v1.orgs[':orgId'].integrations[':id'].lists.$get({
          param: { orgId, id: integration.id },
        }),
      'Could not load task lists.',
    ),
  );
  const lists = listsQ.data?.resources ?? [];

  const save = useApiMutation<IntegrationOut, undefined>({
    mutationFn: () =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].integrations[':id'].$patch({
            param: { orgId, id: integration.id },
            json: {
              writeBack: twoWay,
              // Preserve any keys this UI doesn't manage (e.g. defaultListId, pushNativeTasks).
              config: {
                ...cfg,
                ...(teamId ? { teamId } : {}),
                // "All lists" = absent listIds; an explicit subset stores the chosen ids.
                listIds: allMode ? undefined : listIds,
              },
            },
          }),
        'Could not save settings.',
      ),
    onSuccess: () => {
      setError(null);
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
      }, 4000);
    },
    onError: (e: { message: string }) => {
      setError(e.message);
    },
    invalidateKeys: [queryKeys.integrations(orgId)],
  });

  const toggleList = (id: string): void => {
    setListIds((prev) => (prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]));
  };

  // A subset that selects nothing would sync nothing — block the save until at least one is chosen.
  const emptySubset = !allMode && listIds.length === 0;

  return (
    <div className="border-outline-variant bg-surface-container flex flex-col gap-5 border-t p-4">
      {/* Direction */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-on-surface-variant mb-1 text-xs font-medium">Sync direction</legend>
        <div className="grid gap-2 @2xl:grid-cols-2" role="radiogroup" aria-label="Sync direction">
          {DIRECTIONS.map((d) => {
            const isSelected = twoWay === d.twoWay;
            return (
              <button
                key={d.title}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => {
                  setTwoWay(d.twoWay);
                }}
                className={cn(
                  'focus-visible:ring-ring bg-surface-container-low relative flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-2',
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-outline-variant hover:border-primary/40',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-on-surface text-body font-semibold">{d.title}</span>
                  {isSelected ? <Check aria-hidden="true" className="text-primary size-4" /> : null}
                </span>
                <span className="text-on-surface-variant text-xs leading-snug">{d.detail}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Task lists */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-on-surface-variant mb-1 text-xs font-medium">
          Task lists to sync
        </legend>
        {listsQ.isPending ? (
          <Skeleton className="h-16 w-full rounded-lg" />
        ) : listsQ.isError ? (
          <p className="text-destructive text-xs">{listsQ.error.message}</p>
        ) : lists.length === 0 ? (
          <p className="text-on-surface-variant text-xs">No task lists found for this account.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {/* The default: sync every list. Turning it off reveals an explicit per-list choice. */}
            <label className="hover:bg-surface-container-high flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5">
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={allMode}
                onChange={(e) => {
                  setAllMode(e.target.checked);
                }}
              />
              <span className="text-on-surface text-body font-medium">Sync all lists</span>
            </label>
            {!allMode ? (
              <ul className="border-outline-variant ml-3 flex flex-col gap-1 border-l pl-3">
                {lists.map((l) => (
                  <li key={l.id}>
                    <label className="hover:bg-surface-container-high flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5">
                      <input
                        type="checkbox"
                        className="accent-primary size-4"
                        checked={listIds.includes(l.id)}
                        onChange={() => {
                          toggleList(l.id);
                        }}
                      />
                      <span className="text-on-surface text-body">{l.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            {emptySubset ? (
              <p className="text-on-surface-variant px-2 text-xs">
                Select at least one list, or turn “Sync all lists” back on.
              </p>
            ) : null}
          </div>
        )}
      </fieldset>

      {/* Target team */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor={`team-${integration.id}`}
          className="text-on-surface-variant text-xs font-medium"
        >
          Land mirrored work in
        </label>
        <select
          id={`team-${integration.id}`}
          value={teamId}
          onChange={(e) => {
            setTeamId(e.target.value);
          }}
          className="border-outline-variant bg-surface-container-low text-on-surface text-body focus-visible:ring-ring rounded-lg border px-3 py-2 outline-none focus-visible:ring-2"
        >
          <option value="">First team (default)</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-body">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          disabled={save.isPending || emptySubset}
          onClick={() => {
            save.mutate(undefined);
          }}
        >
          {save.isPending ? 'Saving…' : 'Save settings'}
        </Button>
        {saved ? <span className="text-on-surface-variant text-xs">Saved.</span> : null}
      </div>
    </div>
  );
}
