'use client';

/**
 * `settings/notion` — the data layer for the Docket-designed Notion databases surface.
 *
 * @remarks
 * Three hooks, one per surface, so each view component stays pure: {@link useNotionMirror} reads
 * the connection and its designed databases, {@link useNotionTableDesign} owns one entity's
 * designer (including the save), and {@link useNotionPeople} reads the identity matching.
 *
 * Split rather than combined because the designer is the expensive read — it counts and samples
 * real rows — and the hub should not pay for nine of those to render a list.
 *
 * @see `docs/engineering/specs/notion-sync.md`
 */
import { ConnectorConfig } from '@docket/types';
import type {
  IntegrationOut,
  NotionMirrorDatabaseOut,
  NotionMirrorDesignOut,
  NotionMirrorEntity,
  NotionParentPageOut,
  NotionWorkspacePerson,
  SyncRunOut,
} from '@docket/types';
import { useState } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import {
  STALE,
  apiQueryOptions,
  queryKeys,
  unwrap,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';
import { useRemoteSearch } from '@/lib/use-remote-search';

import { relativeTime } from '../format-time';

import { SETUP_FAILED, SYNC_FAILED } from './notion-copy';

/**
 * How the mirror is actually doing, as opposed to how the connection is doing.
 *
 * @remarks
 * Two separate facts, and conflating them is what let a broken mirror render as "Connected".
 *
 * `connection` is the shared connector health — the credential works, or it does not. But the
 * integration's roll-up (`status`, `lastSyncedAt`) is written by whichever *purpose* ran last, and
 * a Notion connection runs two: the task pull and this mirror. A successful task pull advances
 * those fields without the mirror having run at all, so reading them alone would report the mirror
 * healthy on the strength of an unrelated sync.
 *
 * `lastRun` therefore comes from the durable run history, filtered to this purpose. It is the only
 * place a mirror-specific outcome survives.
 */
export interface NotionMirrorHealth {
  /** The connection's own health, shared across every purpose that uses it. */
  connection: IntegrationOut['status'];
  /** How the most recent *mirror* pass ended, or null when one has never run. */
  lastRun: 'succeeded' | 'failed' | 'running' | null;
  /** When that pass ended, in words, or null. */
  lastRunLabel: string | null;
}

/** The Notion hub's view model. */
export interface NotionMirrorModel {
  loading: boolean;
  /** The error to render, or null. Always application-owned copy. */
  error: string | null;
  /** The Notion connection, or null when this workspace has none. */
  integration: IntegrationOut | null;
  /** The designed databases, in designer order. */
  databases: readonly NotionMirrorDatabaseOut[];
  /** Databases actually created in Notion. */
  provisionedCount: number;
  /** Rows currently projected across every database. */
  totalRows: number;
  /** Where to go to connect Notion when it is not connected yet. */
  connectionsHref: string;
  /** How stale what you see in Notion is, in words, or null when nothing has been pushed. */
  lastSyncedLabel: string | null;
  /** Whether the mirror is working — read this before believing {@link lastSyncedLabel}. */
  health: NotionMirrorHealth;
  /**
   * The Notion page the databases were built under, or null before provisioning.
   *
   * @remarks
   * Recorded at provision time so the surface can say where its output went. It used to be
   * written to `integration.config` and never shown again, which left the one question a reader
   * has afterwards — *where did those nine databases go?* — answerable only by searching Notion.
   *
   * `title` is absent on connections provisioned before it was recorded; those fall back to a
   * generic label rather than to nothing.
   */
  containerPage: { title: string | null; url: string | null } | null;
}

/** Read the Notion connection and the databases designed against it. */
export function useNotionMirror(orgId: string): NotionMirrorModel {
  const integrationsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.integrations(orgId),
      () => api.v1.orgs[':orgId'].integrations.$get({ param: { orgId } }),
      'Could not load connections.',
    ),
  );
  const integrations: readonly IntegrationOut[] = integrationsQ.data?.items ?? [];
  const integration = integrations.find((i) => i.provider === 'notion') ?? null;

  const databasesQ = useApiQuery({
    ...apiQueryOptions(
      queryKeys.notionMirrorDatabases(orgId, integration?.id ?? 'none'),
      () =>
        api.v1.orgs[':orgId'].integrations[':id'].notion.databases.$get({
          param: { orgId, id: integration?.id ?? '' },
        }),
      'Could not load your Notion databases.',
    ),
    enabled: integration !== null,
  });

  // The mirror's own run history. Deliberately NOT folded into `error` below: a settings page
  // that blanks itself because it could not read a sync log is worse than one that renders with
  // its health unknown, and the databases it is showing are still true.
  const runsQ = useApiQuery({
    ...apiQueryOptions(
      queryKeys.integrationRuns(orgId, integration?.id ?? 'none'),
      () =>
        api.v1.orgs[':orgId'].integrations[':id'].runs.$get({
          param: { orgId, id: integration?.id ?? '' },
        }),
      'Could not load sync history.',
    ),
    enabled: integration !== null,
  });

  const databases: readonly NotionMirrorDatabaseOut[] = databasesQ.data?.items ?? [];
  const loadError = integrationsQ.error ?? databasesQ.error;

  return {
    loading: integrationsQ.isPending || (integration !== null && databasesQ.isPending),
    error: loadError ? userErrorMessage(loadError, 'Could not load your Notion setup.') : null,
    integration,
    databases,
    provisionedCount: databases.filter((d) => d.provisionedAt !== null).length,
    totalRows: databases.reduce((sum, d) => sum + d.rowCount, 0),
    connectionsHref: `/orgs/${orgId}/settings/connections`,
    lastSyncedLabel: relativeSyncLabel(
      databases.map((d) => d.lastPushedAt).filter((v): v is string => v !== null),
    ),
    health: mirrorHealth(integration, runsQ.data?.items ?? []),
    containerPage: readContainerPage(integration?.config),
  };
}

/**
 * Reduce the connection and its run history to what the hub has to say about health.
 *
 * @remarks
 * The runs arrive newest-first, so the first `notion_mirror` entry is the latest mirror pass.
 * Filtering by purpose is the whole point: the same list carries `task_sync` runs against the same
 * connection, and letting one of those stand in for the mirror is exactly the substitution that
 * made a broken mirror look healthy.
 *
 * @param integration - The Notion connection, or null when there is none.
 * @param runs - Recent sync runs for it, newest-first.
 * @returns the hub's health view.
 */
function mirrorHealth(
  integration: IntegrationOut | null,
  runs: readonly SyncRunOut[],
): NotionMirrorHealth {
  const latest = runs.find((run) => run.purpose === 'notion_mirror');
  return {
    connection: integration?.status ?? 'pending',
    lastRun: latest?.status ?? null,
    lastRunLabel: relativeTimeLabel(latest?.finishedAt ?? latest?.startedAt ?? null),
  };
}

/**
 * Read the container page out of the connector config.
 *
 * @remarks
 * `IntegrationOut.config` crosses the wire as untyped jsonb, so it has to be validated rather than
 * asserted — but against {@link ConnectorConfig}, the schema that *defines* this shape and that the
 * API parses the same value with. Hand-narrowing it here would make the key path a fact stated in
 * three places in two idioms.
 *
 * `safeParse` rather than `parse`: a connection provisioned before the title was recorded, or one
 * whose config predates the mirror entirely, must render the surface without it rather than throw
 * on a settings page.
 *
 * @param config - The integration's connector config, if any.
 * @returns the container page's title and URL, or null when nothing has been provisioned.
 */
function readContainerPage(
  config: Record<string, unknown> | undefined,
): { title: string | null; url: string | null } | null {
  const mirror = ConnectorConfig.safeParse(config ?? {}).data?.notionMirror;
  if (mirror === undefined) return null;
  return { title: mirror.containerPageTitle ?? null, url: mirror.containerPageUrl ?? null };
}

/**
 * The most recent projection across every database, in words.
 *
 * @remarks
 * Per-database timestamps would be noise — the passes run together — so the hub states the one
 * fact a reader wants: how stale is what I am looking at in Notion.
 */
function relativeSyncLabel(timestamps: readonly string[]): string | null {
  if (timestamps.length === 0) return null;
  const latest = Math.max(...timestamps.map((t) => Date.parse(t)).filter((n) => !Number.isNaN(n)));
  if (!Number.isFinite(latest)) return null;
  return relativeTime(new Date(latest).toISOString());
}

/**
 * How long ago a moment was, tolerating an absent or unparseable timestamp.
 *
 * @remarks
 * A null guard over the settings surface's own {@link relativeTime}, which is what every other
 * connector stamp on this screen already uses — including the "last synced" line on the Notion
 * card the reader just came from. Its fallback to an absolute date past a week is what the page
 * picker wants: "Mar 3" beside one same-named page and "2 days ago" beside the other tells them
 * apart far better than "243 days ago" would.
 *
 * @param iso - An ISO-8601 timestamp, or null.
 * @returns the phrase, or null when there is no usable timestamp.
 */
export function relativeTimeLabel(iso: string | null): string | null {
  if (iso === null || Number.isNaN(Date.parse(iso))) return null;
  return relativeTime(iso);
}

/** One real OAuth round trip to somebody else's server per keystroke, so a provider-sized wait. */
const PARENT_PAGE_DEBOUNCE_MS = 280;

/** Application-owned copy for a page search that fails. */
const PAGES_ERROR = 'Could not load your Notion pages.';

/** One page of the parent-page search, as the picker needs it. */
export interface NotionParentPageSearch {
  /** The current result wave. Never blanks between keystrokes — see `useApiListQuery`. */
  pages: readonly NotionParentPageOut[];
  /** True while results for the current text are still expected. */
  pending: boolean;
  error: string | null;
}

/**
 * Search the Notion pages Docket may build under.
 *
 * @remarks
 * Server-filtered, not client-filtered. Notion's `search` takes the title query and returns the
 * most recently edited matches, so the browser never downloads a workspace to narrow it locally.
 *
 * A thin adapter over {@link useRemoteSearch}; only the parts that are actually Notion's live
 * here — the endpoint, the copy, and the two cache tunings a provider-backed one-shot setup
 * surface needs.
 *
 * @param orgId - The workspace.
 * @param integrationId - The Notion connection.
 * @param query - What has been typed, unsettled.
 * @param enabled - False while the picker is closed, so a shut popover issues no requests.
 * @returns the current result wave.
 */
export function useNotionParentPages(
  orgId: string,
  integrationId: string,
  query: string,
  enabled: boolean,
): NotionParentPageSearch {
  const search = useRemoteSearch({
    query,
    debounceMs: PARENT_PAGE_DEBOUNCE_MS,
    enabled: enabled && integrationId.length > 0,
    key: (term) => queryKeys.notionParentPages(orgId, integrationId, term),
    fetch: (term) =>
      api.v1.orgs[':orgId'].integrations[':id'].notion['parent-pages'].$get({
        param: { orgId, id: integrationId },
        query: term.length > 0 ? { q: term } : {},
      }),
    fallbackMessage: PAGES_ERROR,
    options: {
      // A workspace's page list is not volatile, and `refetchOnWindowFocus` is on: a 5s stale
      // window would mean a real OAuth round trip to Notion on every tab focus, for a one-shot
      // setup surface.
      staleTime: STALE.static,
      // Every settled term mints its own key, and the default gc time is 24h with persistence —
      // so without this, typing "engineering handbook" leaves half a dozen search results in
      // the persisted cache for a day.
      gcTime: 60_000,
    },
  });

  return { pages: search.data?.items ?? [], pending: search.pending, error: search.error };
}

/** The setup surface's view model: create the databases under a chosen page. */
export interface NotionSetupModel {
  error: string | null;
  /** True while the provision run is in flight. */
  creating: boolean;
  /** Create the databases under the chosen page. */
  create: (containerPageId: string) => void;
}

/**
 * Create the designed databases in Notion.
 *
 * @remarks
 * The provision route answers 200 carrying the sync run, so a *failed* run is a successful HTTP
 * response describing a failure. This surfaces that as an error rather than as success — the whole
 * point of the never-report-success-when-nothing-happened rule.
 *
 * Reading the candidate pages is deliberately **not** here: it is a search that reruns as
 * somebody types, and folding it into the model that owns the create mutation would make every
 * keystroke a state change for the button too.
 */
export function useNotionSetup(orgId: string, integrationId: string): NotionSetupModel {
  const [error, setError] = useState<string | null>(null);

  const create = useApiMutation({
    mutationFn: (containerPageId: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].integrations[':id'].notion.provision.$post({
            param: { orgId, id: integrationId },
            json: { containerPageId },
          }),
        'Could not create your Notion databases.',
      ),
    // People too, not just the databases: provisioning is what LEARNS the Notion roster, so a
    // reader who provisions and then opens "Match people" would otherwise be shown the empty list
    // cached before anyone was known.
    invalidateKeys: [
      queryKeys.notionMirrorDatabases(orgId, integrationId),
      queryKeys.notionMirrorPeople(orgId, integrationId),
      // The integrations list too, because provisioning writes the container page into
      // `integration.config` and that list is where the hub reads it from. Without this the
      // "Where this lives" row cannot appear until something else happens to refetch — the
      // surface would report success and then fail to show what it just created.
      queryKeys.integrations(orgId),
    ],
    onSuccess: (run: { status: string }) => {
      // A failed run still arrives as a 200. Reporting it as success is exactly the dishonesty
      // this codebase refuses.
      setError(run.status === 'succeeded' ? null : SETUP_FAILED);
    },
    onError: (e: Error) => {
      setError(userErrorMessage(e, 'Could not create your Notion databases.'));
    },
  });

  return {
    error,
    creating: create.isPending,
    create: (containerPageId) => {
      create.mutate(containerPageId);
    },
  };
}

/** The hub's "run it now" model. */
export interface NotionMirrorSyncModel {
  /** The error to render, or null. Always application-owned copy. */
  error: string | null;
  /** True while a mirror pass is in flight. */
  syncing: boolean;
  /** Run the mirror against the container page already chosen. */
  sync: () => void;
}

/**
 * Run the Notion mirror on demand.
 *
 * @remarks
 * Separate from {@link useNotionSetup} because the two are different acts: setup *chooses* where
 * the databases live and rewrites the connection's config, while this only runs. Folding them
 * together is what left a provisioned connection with no way to re-run its mirror at all — the
 * one thing a stalled sync needs.
 *
 * Same honesty rule as setup: the route answers 200 carrying the run, so a failed pass is a
 * successful HTTP response describing a failure and has to be read off `status`.
 *
 * @param orgId - The workspace.
 * @param integrationId - The Notion connection.
 * @returns the action and its state.
 */
export function useNotionMirrorSync(orgId: string, integrationId: string): NotionMirrorSyncModel {
  const [error, setError] = useState<string | null>(null);

  const run = useApiMutation({
    mutationFn: () =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].integrations[':id'].notion.sync.$post({
            param: { orgId, id: integrationId },
          }),
        SYNC_FAILED,
      ),
    // The people roster is refreshed BY the pass (it is where the Notion workspace members are
    // learned), and the run history is what the hub reads its own health from — so both are as
    // stale as the databases once this returns.
    invalidateKeys: [
      queryKeys.notionMirrorDatabases(orgId, integrationId),
      queryKeys.notionMirrorPeople(orgId, integrationId),
      queryKeys.integrationRuns(orgId, integrationId),
      queryKeys.integrations(orgId),
    ],
    onSuccess: (finished: { status: string }) => {
      setError(finished.status === 'succeeded' ? null : SYNC_FAILED);
    },
    onError: (e: Error) => {
      setError(userErrorMessage(e, SYNC_FAILED));
    },
  });

  return {
    error,
    syncing: run.isPending,
    sync: () => {
      run.mutate(undefined);
    },
  };
}

/** One column as the designer edits it, before it is saved. */
export interface DesignerColumn {
  field: string;
  title: string;
  representation?: 'text' | 'notion_person' | 'docket_people_table' | 'existing_table';
  relationDataSourceId?: string;
}

/** The table designer's view model for one entity. */
export interface NotionTableDesignModel {
  loading: boolean;
  error: string | null;
  design: NotionMirrorDesignOut | null;
  /** True while a save is in flight. */
  saving: boolean;
  /** Set for a moment after a successful save, so the UI can acknowledge it. */
  saved: boolean;
  /** Rename the database. */
  renameDatabase: (title: string) => void;
  /** Replace the whole column set (order included). */
  saveColumns: (columns: readonly DesignerColumn[]) => void;
  /** Turn projection of this entity on or off. */
  setEnabled: (enabled: boolean) => void;
}

/** Read and edit one entity's table design. */
export function useNotionTableDesign(
  orgId: string,
  integrationId: string,
  entity: NotionMirrorEntity,
): NotionTableDesignModel {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const designQ = useApiQuery(
    apiQueryOptions(
      queryKeys.notionMirrorDesign(orgId, integrationId, entity),
      () =>
        api.v1.orgs[':orgId'].integrations[':id'].notion.design[':entity'].$get({
          param: { orgId, id: integrationId, entity },
        }),
      'Could not load this table design.',
    ),
  );

  const save = useApiMutation({
    mutationFn: (patch: {
      title?: string;
      enabled?: boolean;
      columns?: readonly DesignerColumn[];
    }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].integrations[':id'].notion.design[':entity'].$patch({
            param: { orgId, id: integrationId, entity },
            json: {
              ...(patch.title !== undefined ? { title: patch.title } : {}),
              ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
              ...(patch.columns !== undefined ? { columns: [...patch.columns] } : {}),
            },
          }),
        'Could not save this table design.',
      ),
    invalidateKeys: [
      queryKeys.notionMirrorDesign(orgId, integrationId, entity),
      queryKeys.notionMirrorDatabases(orgId, integrationId),
    ],
    onSuccess: () => {
      setError(null);
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
      }, 3000);
    },
    onError: (e: Error) => {
      setError(userErrorMessage(e, 'Could not save this table design.'));
    },
  });

  return {
    loading: designQ.isPending,
    error:
      error ??
      (designQ.error ? userErrorMessage(designQ.error, 'Could not load this table design.') : null),
    design: designQ.data ?? null,
    saving: save.isPending,
    saved,
    renameDatabase: (title) => {
      save.mutate({ title });
    },
    saveColumns: (columns) => {
      save.mutate({ columns });
    },
    setEnabled: (enabled) => {
      save.mutate({ enabled });
    },
  };
}

/** The people surface's view model. */
export interface NotionPeopleModel {
  loading: boolean;
  error: string | null;
  /** Notion members matched to a Docket actor. */
  matched: readonly NotionWorkspacePerson[];
  /** Notion members nobody has decided about — the only group that needs an answer. */
  unmatched: readonly NotionWorkspacePerson[];
  /**
   * Notion members somebody deliberately excluded.
   *
   * @remarks
   * Separated from {@link unmatched} because they are the same row shape describing opposite
   * situations: one is a question, the other is its answer. Lumping them together is what made
   * "Don't sync them" look like it did nothing — the person was re-counted as needing a decision
   * the instant the list refreshed, so the count never fell and the work could never be finished.
   */
  ignored: readonly NotionWorkspacePerson[];
  /** The org's people, for the "match to someone" picker. */
  roster: readonly { id: string; displayName: string }[];
  /** The externalId currently being resolved, or null. */
  resolving: string | null;
  /** Decide what one Notion person maps to. */
  resolve: (externalId: string, decision: PersonDecision) => void;
  /**
   * Docket people with no Notion account.
   *
   * @remarks
   * Not a problem to solve. They still get a row in the projected People database and can be
   * assigned work there; Notion just cannot @-mention them, because its native people property
   * only references members of the Notion workspace. Surfacing the count keeps that limitation
   * legible instead of looking like the sync dropped somebody.
   */
  docketOnly: number;
}

/** One decision about a Notion person. */
export type PersonDecision =
  | { readonly action: 'create_actor' }
  | { readonly action: 'match_existing'; readonly actorId: string }
  | { readonly action: 'skip' }
  | { readonly action: 'unignore' };

/** Read the Notion↔Docket identity matching for this connection. */
export function useNotionPeople(orgId: string, integrationId: string): NotionPeopleModel {
  // Disabled without a connection. The hub calls this before it knows whether Notion is connected
  // (hooks run ahead of its early return), and an empty id would request
  // `/integrations//notion/people` — a guaranteed 404 on every render of the not-connected page.
  const enabled = integrationId.length > 0;
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const peopleQ = useApiQuery({
    ...apiQueryOptions(
      queryKeys.notionMirrorPeople(orgId, integrationId),
      () =>
        api.v1.orgs[':orgId'].integrations[':id'].notion.people.$get({
          param: { orgId, id: integrationId },
        }),
      'Could not load people.',
    ),
    enabled,
  });
  const unmatchedQ = useApiQuery({
    ...apiQueryOptions(
      [...queryKeys.notionMirrorPeople(orgId, integrationId), 'docket-only'],
      () =>
        api.v1.orgs[':orgId'].integrations[':id'].notion['unmatched-people'].$get({
          param: { orgId, id: integrationId },
        }),
      'Could not load people.',
    ),
    enabled,
  });

  const rosterQ = useApiQuery({
    ...apiQueryOptions(
      queryKeys.members(orgId),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      'Could not load your people.',
    ),
    enabled,
  });

  const resolveOne = useApiMutation({
    mutationFn: (input: { externalId: string; decision: PersonDecision }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].integrations[':id'].notion.people[':externalId'].resolve.$post({
            param: { orgId, id: integrationId, externalId: input.externalId },
            json: input.decision,
          }),
        'Could not save that decision.',
      ),
    invalidateKeys: [queryKeys.notionMirrorPeople(orgId, integrationId), queryKeys.members(orgId)],
    onSuccess: () => {
      setError(null);
      setResolving(null);
    },
    onError: (e: Error) => {
      setError(userErrorMessage(e, 'Could not save that decision.'));
      setResolving(null);
    },
  });

  const people: readonly NotionWorkspacePerson[] = peopleQ.data?.items ?? [];
  const loadError = peopleQ.error ?? unmatchedQ.error;

  return {
    loading: enabled && (peopleQ.isPending || unmatchedQ.isPending),
    error: error ?? (loadError ? userErrorMessage(loadError, 'Could not load people.') : null),
    roster: (rosterQ.data?.items ?? []).map((m) => ({ id: m.actorId, displayName: m.displayName })),
    resolving,
    resolve: (externalId, decision) => {
      setResolving(externalId);
      resolveOne.mutate({ externalId, decision });
    },
    // Three populations, not two. `actorId === null` alone conflates "we don't know yet" with
    // "we were told not to", which is why a skipped person used to reappear in the list of
    // decisions still to make immediately after being decided.
    matched: people.filter((p) => p.actorId !== null),
    unmatched: people.filter((p) => p.actorId === null && p.ignoredAt === null),
    ignored: people.filter((p) => p.actorId === null && p.ignoredAt !== null),
    docketOnly: unmatchedQ.data?.docketOnly ?? 0,
  };
}
