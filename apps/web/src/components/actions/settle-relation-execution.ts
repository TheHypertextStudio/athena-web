import type { RelationCommandResult } from '@docket/work/relation-contract';

/**
 * Execute a relation batch and repair its projections after a write or an indeterminate failure.
 *
 * @param execute - Relation command that may apply several writes before it settles.
 * @param invalidate - Repair for every projection the eligible writes can affect.
 */
export async function settleRelationExecution(
  execute: () => Promise<RelationCommandResult>,
  invalidate: () => void,
): Promise<void> {
  let result: RelationCommandResult | undefined;
  try {
    result = await execute();
  } finally {
    if (result === undefined || result.status === 'applied') invalidate();
  }
}
