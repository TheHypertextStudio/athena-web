/**
 * `@docket/api` — recording and reversing a change to one subject's whole label set.
 *
 * @remarks
 * A label set is recorded as one snapshot per subject (`task_labels`, `project_labels`, …) rather
 * than one edge per label. An exclusive group swaps a label out as a side effect of adding
 * another, and a per-edge record cannot tell that swap from a removal someone asked for. A
 * snapshot also gives undo one question to ask: is the set still exactly what this change left?
 * If anyone has relabeled the subject since, the entry is skipped rather than clobbered.
 *
 * Entries are stored as `{ labelIds: sorted[] }` on both sides. The task expansion route reads
 * that shape directly, so it must not change.
 */
import {
  labelsForSubject,
  replaceLabels,
  resolveAttachedLabels,
  type LabelableKind,
} from '../lib/labels';
import { enqueueSearchUpsert } from '../search/write-through';
import type { StoredChange, Tx } from './change-set';
import type { RevertResult, StoredEntry } from './change-set-companions';

/** The subjects whose label sets a change set can snapshot: every labelable kind of work. */
export type LabelSetSubject = Exclude<LabelableKind, 'resource'>;

/** The entry kind each subject's label snapshot is stored under. */
const KIND_OF: Record<LabelSetSubject, string> = {
  task: 'task_labels',
  project: 'project_labels',
  initiative: 'initiative_labels',
  program: 'program_labels',
};

const SUBJECT_OF = new Map(
  Object.entries(KIND_OF).map(([subject, kind]) => [kind, subject as LabelSetSubject]),
);

/** Whether an entry kind is a label-set snapshot. */
export function isLabelSetKind(kind: string): boolean {
  return SUBJECT_OF.has(kind);
}

/**
 * Record a replacement of one subject's label set.
 *
 * @param subject - What kind of work carries the labels.
 * @param subjectId - The work item's id.
 * @param before - The label ids it carried before the write.
 * @param after - The label ids it carries after the write.
 * @returns The change to add to a change set.
 */
export function labelSetChange(
  subject: LabelSetSubject,
  subjectId: string,
  before: readonly string[],
  after: readonly string[],
): StoredChange {
  return {
    kind: KIND_OF[subject],
    id: subjectId,
    op: 'update',
    before: { labelIds: [...before].sort() },
    after: { labelIds: [...after].sort() },
  };
}

/** Read the label ids out of a stored snapshot side, or null when the side is malformed. */
function idsOf(side: Record<string, unknown> | null): string[] | null {
  const ids = side?.['labelIds'];
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) return null;
  return [...ids].sort();
}

/** Whether two sorted id lists hold the same ids. */
export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Put a subject's label set back to what it was before the recorded change.
 *
 * @remarks
 * The restore does not re-check team scope or group exclusivity. It puts back exactly the set the
 * subject carried, which was valid when it was written. A label deleted since is dropped rather
 * than failing the undo.
 *
 * @param entry - The stored snapshot entry.
 * @param orgId - The organization it happened in.
 * @param tx - The transaction to read and write in.
 * @returns What happened (`changed_since` when the set moved after the change), and the subject's
 *   search re-index to run after commit.
 */
export async function revertLabelSet(
  entry: StoredEntry,
  orgId: string,
  tx: Tx,
): Promise<RevertResult> {
  const ref = { kind: entry.entityKind, id: entry.entityId };
  const subject = SUBJECT_OF.get(entry.entityKind);
  const before = idsOf(entry.before);
  const after = idsOf(entry.after);
  if (!subject || !before || !after) {
    return { outcome: { ...ref, reverted: false, reason: 'no_prior_state' } };
  }
  const current = (await labelsForSubject(subject, orgId, entry.entityId, tx)).map((l) => l.id);
  if (!sameIds(current.sort(), after)) {
    return { outcome: { ...ref, reverted: false, reason: 'changed_since' } };
  }
  const restored = await resolveAttachedLabels(orgId, before, tx);
  await replaceLabels(tx, subject, entry.entityId, orgId, restored);
  return {
    outcome: { ...ref, reverted: true },
    // Search facets carry the subject's label ids, and the undo tool only re-indexes by entry kind.
    settle: () => enqueueSearchUpsert(orgId, subject, entry.entityId),
  };
}
