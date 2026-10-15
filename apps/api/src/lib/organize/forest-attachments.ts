import { milestone } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { NotFoundError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import type { PlaceInput } from './place';
import type { ForestMatch, PreparedPlacementForest } from './forest-types';
import { requireForestReference } from './forest-matching';

/** Check the live destination scope and access of every staged matched-row attachment. */
export async function authorizeMatchedAttachments(
  tx: TemplateTransaction,
  forest: PreparedPlacementForest,
  input: PlaceInput,
  match: ForestMatch,
): Promise<void> {
  if (input.at.initiativeId && (match.kind === 'project' || match.kind === 'program')) {
    await requireForestReference(
      tx,
      forest,
      { organizationId: input.orgId, kind: 'initiative', id: input.at.initiativeId },
      'contribute',
    );
  }
  const checkpointId = input.at.milestoneId;
  if (match.kind !== 'task' || !checkpointId || match.placement.milestoneId === checkpointId)
    return;
  const projectId = await checkpointProject(tx, forest, input.orgId, checkpointId);
  if (projectId !== match.placement.projectId || projectId !== input.at.projectId)
    throw new NotFoundError('Checkpoint not found');
  await requireForestReference(
    tx,
    forest,
    { organizationId: input.orgId, kind: 'project', id: projectId },
    'contribute',
  );
}

async function checkpointProject(
  tx: TemplateTransaction,
  forest: PreparedPlacementForest,
  orgId: string,
  id: string,
): Promise<string> {
  const prospective = forest.prospective.get(id);
  if (prospective) {
    if (prospective.kind !== 'milestone') throw new NotFoundError('Checkpoint not found');
    return prospective.projectId;
  }
  const [row] = await tx
    .select({ projectId: milestone.projectId })
    .from(milestone)
    .where(and(eq(milestone.id, id), eq(milestone.organizationId, orgId)))
    .limit(1);
  if (!row) throw new NotFoundError('Checkpoint not found');
  return row.projectId;
}
