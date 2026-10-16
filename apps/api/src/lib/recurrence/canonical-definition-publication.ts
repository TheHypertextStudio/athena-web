import {
  invocationHead,
  invocationRevision,
  registerInvocationRevision,
  type Database,
} from '@docket/db';
import { eq } from 'drizzle-orm';
import { ConflictError } from '../../error';
import type { PreparedProcessDefinition } from './task-template-identity';
/** Atomically bridge an existing normalized publication into a registered private head without stale metadata writes. */
export async function registerCanonicalPublication(
  tx: Database,
  input: {
    readonly head: typeof invocationHead.$inferSelect | undefined;
    readonly revisionId: string;
    readonly definition: PreparedProcessDefinition;
  },
): Promise<void> {
  const { head, revisionId, definition } = input;
  if (!head?.canonicalAuthoringAt) return;
  await registerInvocationRevision(tx, revisionId);
  const [alias] = await tx
    .select()
    .from(invocationRevision)
    .where(eq(invocationRevision.id, revisionId))
    .limit(1);
  if (!alias) throw new ConflictError('Private publication was not registered');
  await tx
    .update(invocationHead)
    .set({
      name: definition.name,
      description: definition.description ?? null,
      status: 'published',
      draftInvocationId: alias.invocationId,
      publishedInvocationId: alias.invocationId,
      revision: head.revision + 1,
    })
    .where(eq(invocationHead.id, head.id));
}
