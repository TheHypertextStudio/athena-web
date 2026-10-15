import { BlueprintError } from '@docket/work/blueprints';
import type { RecordedChange } from '../../mcp/change-set';

/** Collapse multiple row writes into one before/after entry in the existing change-set recorder. */
export function selectiveReceiptChanges(changes: readonly RecordedChange[]): RecordedChange[] {
  const result = new Map<string, RecordedChange>();
  for (const change of changes) {
    if ('linked' in change) {
      result.set(`${change.kind}:${change.from}:${change.to}`, change);
      continue;
    }
    const key = `${change.kind}:${change.id}`;
    const previous = result.get(key);
    if (!previous || !('id' in previous)) {
      result.set(key, change);
      continue;
    }
    if (previous.op !== 'create' && previous.op !== 'update')
      throw new BlueprintError(
        'blueprint_invalid',
        'Selective adoption cannot delete existing work.',
      );
    result.set(key, {
      kind: previous.kind,
      id: previous.id,
      op: previous.op,
      before: previous.before ?? null,
      after: change.after ?? null,
    });
  }
  return [...result.values()];
}
