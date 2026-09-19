/**
 * `components/canvas/project-overview-optimistic` — patch the Project overview for a dependency edit.
 *
 * @remarks
 * The dependencies canvas draws its edges from `blockedByIds` on the overview rows. Patching those
 * rows in the query cache the moment a dependency is added or removed lets the edge appear before
 * the command round-trips; the server's receipt and the follow-up refetch then confirm or correct
 * it. Every function here is pure and idempotent, so the same change can be applied optimistically,
 * again from the receipt, and once more after an undo without drifting.
 */
import type { ProjectOverviewItem } from '../../lib/contracts/project';
import type {
  ObjectCommandReceipt,
  ObjectCommandRelationReceiptEntry,
} from '../../lib/contracts/object-command';

import type { CanvasReceiptDirection } from './canvas-retained-snapshots';

/** One dependency edge added or removed between two Projects. */
export interface ProjectDependencyChange {
  /** Whether the edge is being created or deleted. */
  readonly type: 'add_dependency' | 'remove_dependency';
  /** The Project that must finish first. */
  readonly blockingId: string;
  /** The Project that waits. */
  readonly blockedId: string;
}

type ProjectRowId = ProjectOverviewItem['id'];

function withMembership(ids: ProjectRowId[], id: ProjectRowId, included: boolean): ProjectRowId[] {
  if (included) return ids.includes(id) ? ids : [...ids, id];
  return ids.includes(id) ? ids.filter((value) => value !== id) : ids;
}

/**
 * Return the overview rows with one dependency edge applied.
 *
 * @param items - Current overview rows.
 * @param change - The edge to add or remove.
 * @returns A new array; rows the change does not touch keep their identity.
 */
export function applyProjectDependencyChange(
  items: readonly ProjectOverviewItem[],
  change: ProjectDependencyChange,
): ProjectOverviewItem[] {
  const included = change.type === 'add_dependency';
  const blockingId = change.blockingId as ProjectRowId;
  const blockedId = change.blockedId as ProjectRowId;
  return items.map((item) => {
    if (item.id === blockedId) {
      const blockedByIds = withMembership(item.blockedByIds, blockingId, included);
      return blockedByIds === item.blockedByIds ? item : { ...item, blockedByIds };
    }
    if (item.id === blockingId) {
      const blocksIds = withMembership(item.blocksIds, blockedId, included);
      return blocksIds === item.blocksIds ? item : { ...item, blocksIds };
    }
    return item;
  });
}

function isDependencyEntry(
  entry: ObjectCommandReceipt['entries'][number],
): entry is ObjectCommandRelationReceiptEntry {
  return entry.kind === 'relation' && entry.relation === 'dependency';
}

/**
 * Read the dependency edges a receipt settles, in the direction the canvas is applying it.
 *
 * @param receipt - A forward or replayed command receipt.
 * @param direction - `undo` targets each entry's `before`; `forward` and `redo` target `after`.
 * @returns One change per dependency entry; entries for labels or initiatives are ignored.
 */
export function projectDependencyChangesFromReceipt(
  receipt: ObjectCommandReceipt,
  direction: CanvasReceiptDirection,
): ProjectDependencyChange[] {
  if (receipt.objectKind !== 'project') return [];
  return receipt.entries.filter(isDependencyEntry).map((entry) => ({
    type: (direction === 'undo' ? entry.before : entry.after)
      ? 'add_dependency'
      : 'remove_dependency',
    blockingId: entry.objectId,
    blockedId: entry.relatedId,
  }));
}
