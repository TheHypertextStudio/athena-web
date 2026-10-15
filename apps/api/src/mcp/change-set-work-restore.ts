import { initiative, program, project } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { serializableTx } from '../lib/serializable-tx';
import { authorizeRecordedIdentities } from './change-set-identity';
import { restoredWorkSnapshot, unchangedSince } from './change-set-values';

/** Restore a recorded container update with a fresh locked after-check and receipt-bound archived identity. */
export async function restoreRecordedContainer(input: {
  readonly orgId: string;
  readonly kind: 'initiative' | 'program' | 'project';
  readonly id: string;
  readonly before: Record<string, unknown>;
  readonly after: Record<string, unknown> | null;
}): Promise<boolean> {
  return serializableTx(async (tx) => {
    const table = { initiative, program, project }[input.kind];
    const where = and(eq(table.organizationId, input.orgId), eq(table.id, input.id));
    const [current] = await tx.select().from(table).where(where).limit(1).for('update');
    if (!current || (input.after && !unchangedSince(current, input.after))) return false;
    await authorizeRecordedIdentities(tx, input.orgId, [
      { entityKind: input.kind, before: input.before },
    ]);
    await tx.update(table).set(restoredWorkSnapshot(input.before, current)).where(where);
    return true;
  });
}
