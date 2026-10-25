import {
  blueprintConversion,
  blueprintInvocation,
  invocationHead,
  invocationRevision,
  hashScheduleArchive,
  type Database,
} from '@docket/db';
import { and, desc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { ProcessDefinitionDetailOut, type ProcessRevisionOut } from '../../contracts/recurrence';
import { ConflictError, NotFoundError } from '../../error';
import { projectCanonicalDefinitionRevision } from './canonical-definition-projection';
import { CanonicalPrivateWorkDefinition } from '@docket/work/work-private-definition';
import { projectPrivateDefinitionRevision } from './private-definition-projection';
import {
  requireLegacyDefinitionAccess,
  type LegacyDefinitionAccessRequest,
} from './legacy-definition-access';
/** Read registered canonical ownership only; callers authorize before any metadata/body serialization. */
export async function canonicalDefinitionHead(
  database: Database,
  input: Pick<LegacyDefinitionAccessRequest, 'organizationId' | 'definitionId'>,
  lock?: 'share' | 'update',
): Promise<typeof invocationHead.$inferSelect | null> {
  const query = database
    .select()
    .from(invocationHead)
    .where(
      and(
        eq(invocationHead.id, input.definitionId),
        eq(invocationHead.organizationId, input.organizationId),
        isNotNull(invocationHead.canonicalAuthoringAt),
      ),
    )
    .limit(1);
  const [head] = await (lock ? query.for(lock) : query);
  return head ?? null;
}
async function revisionRows(
  database: Database,
  input: Pick<LegacyDefinitionAccessRequest, 'organizationId' | 'definitionId'>,
  limit: number,
  beforeNumber?: number,
) {
  return database
    .select({
      revision: invocationRevision,
      archive: blueprintConversion.sourceArchive,
      hash: blueprintConversion.sourceArchiveHash,
      fingerprint: sql<string>`md5((${blueprintConversion.sourceArchive}->'source')::text)`,
      manifest: blueprintInvocation.manifest,
    })
    .from(invocationRevision)
    .leftJoin(
      blueprintConversion,
      and(
        eq(blueprintConversion.legacyProcessRevisionId, invocationRevision.id),
        eq(blueprintConversion.organizationId, invocationRevision.organizationId),
        eq(blueprintConversion.invocationId, invocationRevision.invocationId),
      ),
    )
    .innerJoin(
      blueprintInvocation,
      and(
        eq(blueprintInvocation.id, invocationRevision.invocationId),
        eq(blueprintInvocation.organizationId, invocationRevision.organizationId),
      ),
    )
    .where(
      and(
        eq(invocationRevision.headId, input.definitionId),
        eq(invocationRevision.organizationId, input.organizationId),
        beforeNumber === undefined ? undefined : lt(invocationRevision.number, beforeNumber),
      ),
    )
    .orderBy(desc(invocationRevision.number))
    .limit(limit);
}
function projectRow(row: Awaited<ReturnType<typeof revisionRows>>[number]): ProcessRevisionOut {
  if (row.revision.origin === 'authored') {
    const parsed = CanonicalPrivateWorkDefinition.safeParse(row.manifest);
    if (!parsed.success || row.revision.authoredPayloadHash !== hashScheduleArchive(row.manifest))
      throw new ConflictError('Private authored revision evidence is unavailable.');
    return projectPrivateDefinitionRevision(row.revision, parsed.data);
  }
  if (
    !row.archive ||
    row.hash !== row.revision.sourceArchiveHash ||
    hashScheduleArchive(row.archive) !== row.hash ||
    row.fingerprint !== row.revision.originalSourceFingerprint
  )
    throw new ConflictError('Private revision evidence is unavailable.');
  return projectCanonicalDefinitionRevision(row.revision, row.archive);
}
/** Return canonical latest detail, or null only when this visible head has never registered canonical ownership. */
export async function canonicalDefinitionDetail(
  database: Database,
  input: LegacyDefinitionAccessRequest,
): Promise<ProcessDefinitionDetailOut | null> {
  await requireLegacyDefinitionAccess(database, input);
  const head = await canonicalDefinitionHead(database, input);
  if (!head) return null;
  if (head.archivedAt || head.status === 'archived')
    throw new NotFoundError('Process definition not found');
  const [row] = await revisionRows(database, input, 1);
  if (!row) throw new ConflictError('Private revision history is incomplete.');
  const revision = projectRow(row);
  return ProcessDefinitionDetailOut.parse({
    id: head.id,
    organizationId: head.organizationId,
    name: head.name,
    description: head.description,
    status: head.status,
    latestRevisionNumber: revision.number,
    createdAt: head.createdAt.toISOString(),
    updatedAt: head.updatedAt.toISOString(),
    revision,
  });
}
/** A private authored history page with an explicit continuation, independent of the metadata edit counter. */
export interface CanonicalDefinitionHistoryPage {
  readonly items: readonly ProcessRevisionOut[];
  readonly nextNumber: number | null;
}
/** Read bounded complete history after live private-head authorization; pending rows never become executions. */
export async function canonicalDefinitionHistory(
  database: Database,
  input: LegacyDefinitionAccessRequest,
  page: { limit?: number; beforeNumber?: number } = {},
): Promise<CanonicalDefinitionHistoryPage> {
  await requireLegacyDefinitionAccess(database, input);
  const limit = page.limit ?? 100;
  validateHistoryPage(limit, page.beforeNumber);
  if (!(await canonicalDefinitionHead(database, input)))
    throw new NotFoundError('Canonical definition not found');
  const rows = await revisionRows(database, input, limit + 1, page.beforeNumber);
  const items = rows.slice(0, limit).map(projectRow);
  return { items, nextNumber: rows.length > limit ? (items.at(-1)?.number ?? null) : null };
}
/** Update canonical metadata under its row lock; a rename never increments authored publication number. */
export async function updateCanonicalDefinitionMetadata(
  database: Database,
  input: LegacyDefinitionAccessRequest,
  patch: { name?: string | undefined; description?: string | null | undefined },
): Promise<boolean> {
  return database.transaction(async (tx) => {
    const [head] = await tx
      .select()
      .from(invocationHead)
      .where(
        and(
          eq(invocationHead.id, input.definitionId),
          eq(invocationHead.organizationId, input.organizationId),
          isNotNull(invocationHead.canonicalAuthoringAt),
        ),
      )
      .for('update')
      .limit(1);
    if (!head) return false;
    if (head.archivedAt || head.status === 'archived')
      throw new NotFoundError('Process definition not found');
    await requireLegacyDefinitionAccess(tx, input, 'manage');
    await tx
      .update(invocationHead)
      .set({ ...patch, revision: head.revision + 1 })
      .where(eq(invocationHead.id, head.id));
    return true;
  });
}

function validateHistoryPage(limit: number, beforeNumber: number | undefined): void {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (beforeNumber !== undefined && (!Number.isInteger(beforeNumber) || beforeNumber < 1))
  )
    throw new RangeError('Read a valid private revision page.');
}
