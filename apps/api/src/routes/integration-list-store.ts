/** Cursor-backed integration collection reads. */
import { db, externalActor, integration } from '@docket/db';
import { and, asc, eq } from 'drizzle-orm';

import { seekAfterId } from '../lib/list-cursor';

interface ListPage {
  readonly cursor?: string | undefined;
  readonly limit: number;
}

/** Read one stable page of workspace integrations. */
export async function listIntegrationRows(
  organizationId: string,
  page: ListPage,
): Promise<(typeof integration.$inferSelect)[]> {
  return db
    .select()
    .from(integration)
    .where(
      and(
        eq(integration.organizationId, organizationId),
        seekAfterId(integration.id, page.cursor, 'asc'),
      ),
    )
    .orderBy(asc(integration.id))
    .limit(page.limit + 1);
}

/** Read one stable page of identity mappings for an integration. */
export async function listExternalActorRows(
  organizationId: string,
  integrationId: string,
  page: ListPage,
): Promise<(typeof externalActor.$inferSelect)[]> {
  return db
    .select()
    .from(externalActor)
    .where(
      and(
        eq(externalActor.integrationId, integrationId),
        eq(externalActor.organizationId, organizationId),
        seekAfterId(externalActor.id, page.cursor, 'asc'),
      ),
    )
    .orderBy(asc(externalActor.id))
    .limit(page.limit + 1);
}
