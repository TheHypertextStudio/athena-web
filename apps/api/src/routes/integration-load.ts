import { db, integration } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { NotFoundError } from '../error';
import type { IntegrationRow } from './integration-provider';

/** Load an org-scoped integration or 404 (existence-hiding across tenants). */
export async function loadIntegration(orgId: string, id: string): Promise<IntegrationRow> {
  const rows = await db
    .select()
    .from(integration)
    .where(and(eq(integration.id, id), eq(integration.organizationId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Integration not found');
  return row;
}
