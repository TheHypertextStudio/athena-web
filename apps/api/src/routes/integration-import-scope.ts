import { and, eq } from 'drizzle-orm';
import { ConnectorConfig } from '@docket/connections/integration-contract';
import type { IntegrationRow } from './integration-provider';
import { db, notionMirrorDatabase, notionMirrorRow, task } from '@docket/db';
import type {
  Connector,
  ImportedItem,
  ImportWorkInput,
  ListContainersInput,
  ResourceRef,
} from '@docket/integrations';

/**
 * Import task sources without reading Docket's own typed Notion projections back as tasks.
 * Disabled mirrors remain owned: switching projection off does not turn their rows into tasks.
 * Ownership spans integrations because a second connection can see the same Notion database.
 */
export async function importTaskWork(
  connector: Pick<Connector, 'importWork'>,
  input: ImportWorkInput,
): Promise<ImportedItem[]> {
  if (input.provider !== 'notion') return connector.importWork(input);
  const scope = await taskImportScope(input.provider, input.listIds);
  const listIds = (input.listIds ?? []).filter((id) => scope.allowsList(id));
  // An empty array means "all" to the connector, so never pass an exhausted selection onward.
  if (listIds.length === 0) return [];
  const items = await connector.importWork({ ...input, listIds });
  return items.filter((item) =>
    scope.allowsItem(item.provenance.externalId, item.provenance.externalListId),
  );
}

/** Keep generic task reads and writes within explicitly selected, non-mirror Notion databases. */
export async function taskImportScope(
  provider: string,
  listIds?: readonly string[],
): Promise<{
  allowsList: (id: string | null | undefined) => boolean;
  allowsItem: (id: string | null | undefined, listId: string | null | undefined) => boolean;
}> {
  if (provider !== 'notion') return { allowsList: () => true, allowsItem: () => true };
  if (!listIds?.length) return { allowsList: () => false, allowsItem: () => false };
  const mirrors = await db
    .select({
      dataSourceId: notionMirrorDatabase.externalDataSourceId,
      databaseId: notionMirrorDatabase.externalDatabaseId,
    })
    .from(notionMirrorDatabase);
  const pages = await db.select({ id: notionMirrorRow.externalPageId }).from(notionMirrorRow);
  const owned = new Set(
    mirrors
      .flatMap((row) => [row.dataSourceId, row.databaseId])
      .filter((id): id is string => id !== null)
      .map(notionId),
  );
  const ownedPages = new Set(pages.flatMap((row) => (row.id ? [notionId(row.id)] : [])));
  const selected = new Set(listIds.map(notionId));
  const allowsList = (id: string | null | undefined): boolean =>
    Boolean(id && selected.has(notionId(id)) && !owned.has(notionId(id)));
  return {
    allowsList,
    allowsItem: (id, listId) => allowsList(listId) && !(id && ownedPages.has(notionId(id))),
  };
}

function notionId(id: string): string {
  return id.replaceAll('-', '').toLowerCase();
}

/** Load only generic-task records that this connection may reconcile or write back. */
export async function loadTaskReconcileInputs(
  row: IntegrationRow,
  orgId: string,
  items: readonly ImportedItem[],
): Promise<{
  config: ConnectorConfig;
  defaultListId: string | undefined;
  localRows: (typeof task.$inferSelect)[];
  remoteById: Map<string, ImportedItem>;
}> {
  const config = ConnectorConfig.safeParse(row.config).data ?? {};
  const scope = await taskImportScope(row.provider, config.listIds);
  const rows = await db
    .select()
    .from(task)
    .where(
      and(
        eq(task.organizationId, orgId),
        eq(task.source, 'linked'),
        eq(task.sourceIntegrationId, row.id),
      ),
    );
  return {
    config,
    defaultListId: scope.allowsList(config.defaultListId) ? config.defaultListId : undefined,
    localRows: rows.filter((item) => scope.allowsItem(item.externalId, item.externalListId)),
    remoteById: new Map(
      items
        .filter((item) =>
          scope.allowsItem(item.provenance.externalId, item.provenance.externalListId),
        )
        .map((item) => [item.provenance.externalId, item]),
    ),
  };
}

/** Offer external task sources without exposing Docket-owned mirror databases as import choices. */
export async function listTaskSources(
  connector: Pick<Connector, 'listContainers'>,
  input: ListContainersInput,
): Promise<ResourceRef[]> {
  const resources = (await connector.listContainers?.(input)) ?? [];
  const scope = await taskImportScope(
    input.provider,
    resources.map((resource) => resource.id),
  );
  return resources.filter((resource) => scope.allowsList(resource.id));
}
