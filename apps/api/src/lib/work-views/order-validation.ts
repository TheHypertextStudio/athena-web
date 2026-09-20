import { initiative, type db } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { NotFoundError } from '../../error';

/** Validate an initiative before mutating its grouped work-view placement. */
export async function assertInitiativeInOrg(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  orgId: string,
  id: string,
): Promise<void> {
  const [row] = await tx
    .select({ id: initiative.id })
    .from(initiative)
    .where(and(eq(initiative.organizationId, orgId), eq(initiative.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError('Work item not found');
}
