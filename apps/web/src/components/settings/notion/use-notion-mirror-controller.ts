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

/** Read the Notion↔Docket identity matching for this connection. */
export function useNotionPeople(orgId: string, integrationId: string): NotionPeopleModel {
  const peopleQ = useApiQuery(
    apiQueryOptions(
      queryKeys.notionMirrorPeople(orgId, integrationId),
      () =>
        api.v1.orgs[':orgId'].integrations[':id'].notion.people.$get({
          param: { orgId, id: integrationId },
        }),
      'Could not load people.',
    ),
  );
  const unmatchedQ = useApiQuery(
    apiQueryOptions(
      [...queryKeys.notionMirrorPeople(orgId, integrationId), 'docket-only'],
      () =>
        api.v1.orgs[':orgId'].integrations[':id'].notion['unmatched-people'].$get({
          param: { orgId, id: integrationId },
        }),
      'Could not load people.',
    ),
  );

  const people: readonly NotionWorkspacePerson[] = peopleQ.data?.items ?? [];
  const loadError = peopleQ.error ?? unmatchedQ.error;

  return {
    loading: peopleQ.isPending || unmatchedQ.isPending,
    error: loadError ? userErrorMessage(loadError, 'Could not load people.') : null,
    matched: people.filter((p) => p.actorId !== null),
    unmatched: people.filter((p) => p.actorId === null),
    docketOnly: unmatchedQ.data?.docketOnly ?? 0,
  };
}
