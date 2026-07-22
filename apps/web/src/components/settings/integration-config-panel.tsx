'use client';

/**
 * `settings` — the per-account connector configuration panel.
 *
 * @remarks
 * Renders the "how should this account sync" controls the user asked for, scoped to ONE linked
 * integration: the sync direction (import-only vs two-way write-back), which external containers
 * to sync, and where mirrored work lands. Reads the current values off the integration's
 * `config`/`writeBack`, fetches the provider's selectable containers from `GET /:id/lists`, and
 * persists changes through `PATCH /:id` — the same server truth the rest of the tab renders from.
 *
 * Wording (the container noun, direction blurbs) is generalized per provider through
 * {@link connectorCopy} rather than hardcoded — see `integrations-config.ts`. Providers whose
 * copy sets `usesTeamMapping` (Linear) get the {@link TeamMappingPicker} instead of the flat
 * container checklist + single target team (Google Tasks), because their containers route
 * many-to-one onto Docket teams via `config.teamMappings`.
 *
 * `PATCH /:id`'s `config` field is a WHOLESALE replace, not a merge — every save spreads the
 * current `config` (from the `integration` prop, itself sourced from the query cache) so fields
 * this panel doesn't manage (`defaultListId`, `pushNativeTasks`, …) survive the write.
 */
import { type ConnectorConfig, type IntegrationOut, type TeamOut } from '@docket/types';
import { cn } from '@docket/ui';
import { Check } from '@docket/ui/icons';
import { Skeleton } from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useState } from 'react';

import { api } from '@/lib/api';
import {
  ApiRequestError,
  apiQueryOptions,
  optimisticPatch,
  queryKeys,
  unwrap,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';

import { connectorCopy } from './integrations-config';
import { IntegrationActionButton } from './integration-action-button';
import TeamMappingPicker, { NOT_SYNCED } from './team-mapping-picker';
import { userErrorMessage } from '@/lib/problem';

/** Props for {@link IntegrationConfigPanel}. */
export interface IntegrationConfigPanelProps {
  /** The active organization id. */
  orgId: string;
  /** The integration (one linked account) being configured. */
  integration: IntegrationOut;
  /** Teams in the org, for the target-team selector(s). */
  teams: readonly TeamOut[];
  /**
   * Launch the provider's re-authorize flow (finish/repair the connection). Wired to the same
   * `runReconnect` the card's own "Reconnect" button uses. Shown when flipping to two-way sync
   * fails because the linked identity lacks write scope (Linear only, today).
   *
   * @remarks
   * Returns the reconnect attempt's promise (rather than firing it and forgetting) so this panel
   * can clear its own re-auth notice once the attempt completes — see the "Re-authorize Linear"
   * button below. In the local/mock-verify flow this component stays mounted through the whole
   * reconnect (no OAuth redirect), so without this the notice would otherwise sit there telling
   * the user to do something they just did.
   */
  onReauthorize?: () => Promise<void>;
}

/** The cached shape of the integrations list read (`GET /integrations`), for optimistic writes. */
interface IntegrationsCache {
  items: IntegrationOut[];
}

/**
 * One autosave write — the exact `PATCH /:id` body a field change persists.
 *
 * @remarks
 * Carried as the mutation's variables (rather than closed over from component state) so each field
 * handler computes the payload from its OWN just-changed value synchronously and hands it in. That
 * sidesteps the stale-closure trap of reading not-yet-flushed `useState` values inside `mutationFn`,
 * and lets the dirty guard compare a concrete payload against the persisted one.
 */
interface SavePayload {
  /** Sync direction — `true` is two-way write-back. */
  writeBack: boolean;
  /** The wholesale-replace `config` (spreads the current config so unmanaged keys survive). */
  config: ConnectorConfig;
}

/** Capitalize the first letter of a lowercase copy string (for legend text). */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Convert a `{ externalTeamId: teamId }` map into the `config.teamMappings` array, dropping "Not synced" entries. */
function toTeamMappings(mapping: Record<string, string>): ConnectorConfig['teamMappings'] {
  return Object.entries(mapping)
    .filter(([, teamId]) => teamId !== NOT_SYNCED)
    .map(([externalTeamId, teamId]) => ({ externalTeamId, teamId }));
}

/** The per-account "which containers, which direction, which team" configuration form. */
export function IntegrationConfigPanel({
  orgId,
  integration,
  teams,
  onReauthorize,
}: IntegrationConfigPanelProps): JSX.Element {
  const queryClient = useQueryClient();
  const copy = connectorCopy(integration.provider);
  const cfg = integration.config as ConnectorConfig;
  const [twoWay, setTwoWay] = useState(integration.writeBack);
  const [teamId, setTeamId] = useState(cfg.teamId ?? '');
  // `allMode` (sync every list) is the default; an explicit subset is stored in `listIds`.
  const [allMode, setAllMode] = useState(!(cfg.listIds && cfg.listIds.length > 0));
  const [listIds, setListIds] = useState<string[]>(cfg.listIds ?? []);
  // Work-graph connectors (Linear): external team id -> Docket team id; a missing entry is "Not synced".
  const [teamMap, setTeamMap] = useState<Record<string, string>>(() =>
    Object.fromEntries((cfg.teamMappings ?? []).map((m) => [m.externalTeamId, m.teamId])),
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set only when a save attempting `writeBack: true` fails for a scope-gated provider (Linear) —
  // renders the re-auth notice instead of (or alongside) the generic error line.
  const [reauthNeeded, setReauthNeeded] = useState(false);

  const listsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.integrationLists(orgId, integration.id),
      () =>
        api.v1.orgs[':orgId'].integrations[':id'].lists.$get({
          param: { orgId, id: integration.id },
        }),
      `Could not load ${copy.containerNounPlural}.`,
    ),
  );
  const lists = listsQ.data?.resources ?? [];

  const save = useApiMutation<IntegrationOut, SavePayload, { rollback: () => void }>({
    mutationFn: (payload) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].integrations[':id'].$patch({
            param: { orgId, id: integration.id },
            json: { writeBack: payload.writeBack, config: payload.config },
          }),
        'Could not save settings.',
      ),
    onMutate: (payload) =>
      optimisticPatch<IntegrationsCache>(queryClient, queryKeys.integrations(orgId), (prev) => ({
        items: prev.items.map((i) =>
          i.id === integration.id
            ? { ...i, writeBack: payload.writeBack, config: payload.config }
            : i,
        ),
      })),
    onSuccess: () => {
      setError(null);
      setReauthNeeded(false);
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
      }, 4000);
    },
    onError: (e: Error, payload, context) => {
      context?.rollback();
      setError(userErrorMessage(e, 'Could not save integration settings.'));
      // Only the write-scope problem (see `hasLinearWriteScope` on the
      // server) should show the re-auth notice — this PATCH's OTHER failure mode, a 422 from
      // `validateTeamMappings` running earlier in the same handler, is unrelated (e.g. a stale
      // team mapping) and must fall through to the generic error line instead. Match the stable
      // problem code rather than provider prose, rather than just
      // "any error while attempting two-way", which fired the notice for every failure reason.
      const isWriteScopeConflict =
        e instanceof ApiRequestError &&
        e.status === 409 &&
        e.code === 'linear_write_scope_required';
      setReauthNeeded(
        integration.provider === 'linear' && payload.writeBack && isWriteScopeConflict,
      );
    },
    invalidateKeys: [queryKeys.integrations(orgId)],
  });

  /**
   * Build the autosave payload from an explicit snapshot of every managed field.
   *
   * @remarks
   * Callers pass the field values they're about to render (with the one just-changed value already
   * updated), so the payload reflects the change even though the corresponding `setState` hasn't
   * flushed yet. Mirrors the wholesale-replace rule: spread the CURRENT `config` so keys this panel
   * doesn't manage survive the write.
   */
  const buildPayload = (next: {
    twoWay: boolean;
    teamId: string;
    allMode: boolean;
    listIds: string[];
    teamMap: Record<string, string>;
  }): SavePayload => ({
    writeBack: next.twoWay,
    config: copy.usesTeamMapping
      ? { ...cfg, teamMappings: toTeamMappings(next.teamMap) }
      : {
          ...cfg,
          ...(next.teamId ? { teamId: next.teamId } : {}),
          // "All lists" = absent listIds; an explicit subset stores the chosen ids.
          listIds: next.allMode ? undefined : next.listIds,
        },
  });

  // The payload that matches what's already persisted — the dirty-guard baseline. Built from the
  // same initial values the state was seeded with, so a field returned to its loaded value is a
  // no-op (and mount never fires a write).
  const persistedPayload = buildPayload({
    twoWay: integration.writeBack,
    teamId: cfg.teamId ?? '',
    allMode: !(cfg.listIds && cfg.listIds.length > 0),
    listIds: cfg.listIds ?? [],
    teamMap: Object.fromEntries((cfg.teamMappings ?? []).map((m) => [m.externalTeamId, m.teamId])),
  });

  /**
   * Autosave a field change: persist the payload unless it's unchanged or would sync nothing.
   *
   * @remarks
   * The dirty guard compares against {@link persistedPayload} — both payloads are built by the same
   * {@link buildPayload}, so their JSON encodings share key order and a stable equality check holds.
   * A flat-checklist subset that selects nothing is held back (it would sync nothing); the inline
   * hint asks the user to pick a container, and their selection stays on screen and editable.
   */
  const commit = (payload: SavePayload): void => {
    if (JSON.stringify(payload) === JSON.stringify(persistedPayload)) return;
    const syncsNothing =
      !copy.usesTeamMapping &&
      Array.isArray(payload.config.listIds) &&
      payload.config.listIds.length === 0;
    if (syncsNothing) return;
    save.mutate(payload);
  };

  /**
   * Clear the re-auth notice once a reconnect attempt (from the button below) completes.
   *
   * @remarks
   * The notice reflects a REJECTED save attempt, not the integration's own server state, so it
   * can't be derived from props — it has to be cleared explicitly. `integration`'s own fields are
   * NOT a reliable signal here: an integration that was already healthy before the failed
   * `writeBack: true` attempt (the common case — only the OAuth *scope* was missing, not the
   * connection) reconnects to the exact same health state it already had, so a
   * prop-diffing effect would never fire. Reconnecting also doesn't unmount this panel in the
   * local/mock-verify flow (`finishConnection` only redirects when the provider needs live OAuth),
   * so without this the notice would sit there telling the user to do something they just did.
   */
  const reauthorize = (): void => {
    if (!onReauthorize) return;
    void onReauthorize().then(() => {
      setReauthNeeded(false);
    });
  };

  const toggleList = (id: string): void => {
    const nextListIds = listIds.includes(id) ? listIds.filter((l) => l !== id) : [...listIds, id];
    setListIds(nextListIds);
    commit(buildPayload({ twoWay, teamId, allMode, listIds: nextListIds, teamMap }));
  };

  const setTeamMapping = (externalTeamId: string, mappedTeamId: string): void => {
    const nextTeamMap = { ...teamMap, [externalTeamId]: mappedTeamId };
    setTeamMap(nextTeamMap);
    commit(buildPayload({ twoWay, teamId, allMode, listIds, teamMap: nextTeamMap }));
  };

  // A subset that selects nothing would sync nothing — block the save until at least one is chosen.
  // Only applies to the flat-checklist providers; an all-"Not synced" team mapping is a valid state.
  const emptySubset = !copy.usesTeamMapping && !allMode && listIds.length === 0;

  return (
    <div className="border-outline-variant bg-surface-container flex flex-col gap-5 border-t p-4">
      <p className="text-on-surface-variant text-xs leading-snug">{copy.connectBlurb}</p>

      {/* Direction */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-on-surface-variant mb-1 text-xs font-medium">Sync direction</legend>
        <div className="grid gap-2 @2xl:grid-cols-2" role="radiogroup" aria-label="Sync direction">
          {(
            [
              { twoWay: false, title: 'Import only', detail: copy.direction.importOnly },
              { twoWay: true, title: 'Two-way', detail: copy.direction.twoWay },
            ] as const
          ).map((d) => {
            const isSelected = twoWay === d.twoWay;
            return (
              <button
                key={d.title}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => {
                  setTwoWay(d.twoWay);
                  commit(buildPayload({ twoWay: d.twoWay, teamId, allMode, listIds, teamMap }));
                }}
                className={cn(
                  'focus-visible:ring-ring bg-surface-container-low relative flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-2',
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-outline-variant hover:border-primary/40',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-on-surface text-body-medium font-semibold">{d.title}</span>
                  {isSelected ? <Check aria-hidden="true" className="text-primary size-4" /> : null}
                </span>
                <span className="text-on-surface-variant text-xs leading-snug">{d.detail}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Containers */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-on-surface-variant mb-1 text-xs font-medium">
          {capitalize(copy.containerNounPlural)} to sync
        </legend>
        {copy.usesTeamMapping ? (
          <TeamMappingPicker
            externalTeams={lists}
            loading={listsQ.isPending}
            error={
              listsQ.isError
                ? userErrorMessage(listsQ.error, 'Could not update integration settings.')
                : null
            }
            orgTeams={teams}
            containerNoun={copy.containerNoun}
            mapping={teamMap}
            onChange={setTeamMapping}
          />
        ) : listsQ.isPending ? (
          <Skeleton className="h-16 w-full rounded-lg" />
        ) : listsQ.isError ? (
          <p className="text-destructive text-xs">
            {userErrorMessage(listsQ.error, 'Could not update integration settings.')}
          </p>
        ) : lists.length === 0 ? (
          <p className="text-on-surface-variant text-xs">
            No {copy.containerNounPlural} found for this account.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {/* The default: sync every container. Turning it off reveals an explicit per-item choice. */}
            <label className="hover:bg-surface-container-high flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5">
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={allMode}
                onChange={(e) => {
                  const nextAllMode = e.target.checked;
                  setAllMode(nextAllMode);
                  commit(buildPayload({ twoWay, teamId, allMode: nextAllMode, listIds, teamMap }));
                }}
              />
              <span className="text-on-surface text-body-medium font-medium">
                Sync all {copy.checklistNounPlural}
              </span>
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
                      <span className="text-on-surface text-body-medium">{l.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            {emptySubset ? (
              <p className="text-on-surface-variant px-2 text-xs">
                Select at least one {copy.checklistNoun}, or turn “Sync all{' '}
                {copy.checklistNounPlural}” back on.
              </p>
            ) : null}
          </div>
        )}
      </fieldset>

      {/* Target team — only for the flat-checklist providers; team-mapping providers pick a team
          per external team above instead of one team for everything. */}
      {!copy.usesTeamMapping ? (
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
              const nextTeamId = e.target.value;
              setTeamId(nextTeamId);
              commit(buildPayload({ twoWay, teamId: nextTeamId, allMode, listIds, teamMap }));
            }}
            className="border-outline-variant bg-surface-container-low text-on-surface text-body-medium focus-visible:ring-ring rounded-lg border px-3 py-2 outline-none focus-visible:ring-2"
          >
            <option value="">First team (default)</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {error && !reauthNeeded ? (
        <p role="alert" className="text-destructive text-body-medium">
          {error}
        </p>
      ) : null}

      {reauthNeeded ? (
        <div
          role="alert"
          className="border-outline-variant bg-surface-container-low flex flex-col items-start gap-2 rounded-lg border p-3"
        >
          <p className="text-destructive text-body-medium">
            {error ?? 'Linear needs to grant Docket write access.'}
          </p>
          <p className="text-on-surface-variant text-xs">
            Reconnect Linear and approve write access to turn on two-way sync.
          </p>
          {onReauthorize ? (
            <IntegrationActionButton tone="primary" onClick={reauthorize} className="px-0">
              Re-authorize Linear
            </IntegrationActionButton>
          ) : null}
        </div>
      ) : null}

      {/* Autosave status — every field persists on change, so there is no Save button. Kept quiet
          (text-on-surface-variant, xs); the generic-error and re-auth notices above own failures. */}
      <div className="text-on-surface-variant flex h-4 items-center text-xs" aria-live="polite">
        {save.isPending ? 'Saving…' : saved ? 'Saved' : null}
      </div>
    </div>
  );
}
