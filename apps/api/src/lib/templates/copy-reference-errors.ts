import { ConflictError } from '../../error';
import { hasSqlState } from '../sql-state';

function referenceConstraint(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('constraint' in error && error.constraint === 'copy_reference_target') return true;
  return 'cause' in error && referenceConstraint(error.cause);
}
/** Translate only the private reference guard's named refusal; preserve all unrelated errors. */
export function templateReferenceWriteError(error: unknown): never {
  if (hasSqlState(error, '23503') && referenceConstraint(error))
    throw new ConflictError('Template selection changed. Refresh and try again.');
  throw error;
}
