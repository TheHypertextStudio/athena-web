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
import type {
  IntegrationOut,
  NotionMirrorDatabaseOut,
  NotionMirrorDesignOut,
  NotionMirrorEntity,
  NotionWorkspacePerson,
} from '@docket/types';
import { useState } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

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
  /** When the mirror last ran, in words, or null when it never has. */
  lastSyncedLabel: string | null;
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
  };
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
  const minutes = Math.round((Date.now() - latest) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${String(days)} day${days === 1 ? '' : 's'} ago`;
}

/** The setup surface's view model: choose a page, then create the databases. */
export interface NotionSetupModel {
  loading: boolean;
  error: string | null;
  /** Notion pages Docket may build under — empty is legitimate, not a failure. */
  parentPages: readonly { id: string; title: string }[];
  /** True while the provision run is in flight. */
  creating: boolean;
  /** Create the databases under the chosen page. */
  create: (containerPageId: string) => void;
}

/**
 * Read the pages Docket may build under, and create the databases.
 *
 * @remarks
 * The provision route answers 200 carrying the sync run, so a *failed* run is a successful HTTP
 * response describing a failure. This surfaces that as an error rather than as success — the whole
 * point of the never-report-success-when-nothing-happened rule.
 */
export function useNotionSetup(orgId: string, integrationId: string): NotionSetupModel {
  const [error, setError] = useState<string | null>(null);
  const enabled = integrationId.length > 0;

  const pagesQ = useApiQuery({
    ...apiQueryOptions(
      [...queryKeys.notionMirrorDatabases(orgId, integrationId), 'parent-pages'],
      () =>
        api.v1.orgs[':orgId'].integrations[':id'].notion['parent-pages'].$get({
          param: { orgId, id: integrationId },
        }),
      'Could not load your Notion pages.',
    ),
    enabled,
  });

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
    ],
    onSuccess: (run: { status: string }) => {
      // A failed run still arrives as a 200. Reporting it as success is exactly the dishonesty
      // this codebase refuses.
      setError(
        run.status === 'succeeded'
          ? null
          : 'Docket could not finish creating your Notion databases. Check the connection and try again.',
      );
    },
    onError: (e: Error) => {
      setError(userErrorMessage(e, 'Could not create your Notion databases.'));
    },
  });

  return {
    loading: enabled && pagesQ.isPending,
    error:
      error ??
      (pagesQ.error ? userErrorMessage(pagesQ.error, 'Could not load your Notion pages.') : null),
    parentPages: pagesQ.data?.items ?? [],
    creating: create.isPending,
    create: (containerPageId) => {
      create.mutate(containerPageId);
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
  /** Notion members with no Docket actor — the only group that needs a decision. */
  unmatched: readonly NotionWorkspacePerson[];
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

/** One decision about an unmatched person. */
export type PersonDecision =
  | { readonly action: 'create_actor' }
  | { readonly action: 'match_existing'; readonly actorId: string }
  | { readonly action: 'skip' };

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
    matched: people.filter((p) => p.actorId !== null),
    unmatched: people.filter((p) => p.actorId === null),
    docketOnly: unmatchedQ.data?.docketOnly ?? 0,
  };
}
