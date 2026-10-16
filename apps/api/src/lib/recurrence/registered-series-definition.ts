import { invocationRevision, type Database } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { NotFoundError } from '../../error';
import { canonicalDefinitionHead } from './canonical-definition';
import {
  requireLegacyDefinitionAccess,
  type LegacyDefinitionAccessRequest,
} from './legacy-definition-access';
/** Lock a registered definition before series creation so archive takes the same head-to-series lock order. */
export async function lockRegisteredSeriesDefinition(
  tx: Database,
  input: LegacyDefinitionAccessRequest,
): Promise<void> {
  const head = await canonicalDefinitionHead(tx, input, 'share');
  if (head?.archivedAt || head?.status === 'archived')
    throw new NotFoundError('Published process definition not found');
  if (head) await requireLegacyDefinitionAccess(tx, input);
}
function archivedConstraint(error: unknown): boolean {
  let cause = error;
  for (let depth = 0; depth < 4; depth++) {
    if (!cause || typeof cause !== 'object') return false;
    if (
      ('constraint_name' in cause && cause.constraint_name === 'registered_definition_archived') ||
      ('constraint' in cause && cause.constraint === 'registered_definition_archived')
    )
      return true;
    cause = 'cause' in cause ? cause.cause : null;
  }
  return false;
}
/** Translate only the stable registered-head archive constraint; driver details never become public copy. */
export async function insertCanonicalCompatibilitySeries<T>(
  write: () => PromiseLike<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (archivedConstraint(error)) throw new NotFoundError('Process definition not found');
    throw error;
  }
}

/** Resolve only a registered actual publication; newest pending authored history is not executable. */
export async function registeredPublishedRevisionId(
  tx: Database,
  organizationId: string,
  definitionId: string,
): Promise<string | null> {
  const head = await canonicalDefinitionHead(tx, { organizationId, definitionId });
  if (!head) return null;
  if (head.archivedAt || head.status === 'archived')
    throw new NotFoundError('Published process definition not found');
  const [alias] = await tx
    .select({ id: invocationRevision.id })
    .from(invocationRevision)
    .where(
      and(
        eq(invocationRevision.headId, head.id),
        eq(invocationRevision.organizationId, organizationId),
        eq(invocationRevision.state, 'published'),
        eq(invocationRevision.invocationId, head.publishedInvocationId ?? ''),
      ),
    )
    .limit(1);
  if (!alias) throw new NotFoundError('Published process definition not found');
  return alias.id;
}
