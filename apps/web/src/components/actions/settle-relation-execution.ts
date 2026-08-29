import type { RelationCommandResult } from '@docket/work/relation-contract';

/**
 * Execute a relation batch and repair its projections after a write or an indeterminate failure.
 *
 * @param execute - Relation command that may apply several writes before it settles.
 * @param invalidate - Repair for every projection the eligible writes can affect.
 * @returns A promise that settles after both the write and any required repair.
 */
export async function settleRelationExecution(
  execute: () => Promise<RelationCommandResult>,
  invalidate: () => Promise<void> | void,
): Promise<void> {
  let result: RelationCommandResult;
  try {
    result = await execute();
  } catch (writeError) {
    try {
      await invalidate();
    } catch {
      // The action result must retain the write failure. The caller can expose refresh recovery
      // separately, but replacing the write error would misreport whether the command ran.
    }
    throw writeError;
  }
  if (result.status === 'applied') await invalidate();
}
