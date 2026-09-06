/**
 * `components/plan-canvas/plan-diff` — what changed between two revisions of a plan document.
 *
 * @remarks
 * The canvas keys its motion on this: a node in `added` enters, a ref in `changed` has its named
 * fields swept with a highlight, and the count of changed fields is what the status pill reads. It
 * compares by ref rather than by position, so a relayout is never mistaken for an edit.
 */
import type { PlanDocument, PlanNode } from '@docket/work/plan-draft-contract';

/** The result of comparing two documents. */
export interface PlanDiff {
  /** Refs present in `next` and absent from `previous`. */
  readonly added: ReadonlySet<string>;
  /** Refs present in `previous` and absent from `next`. */
  readonly removed: readonly string[];
  /** For each ref present in both, the field names whose values differ. */
  readonly changed: ReadonlyMap<string, readonly string[]>;
}

/** An empty diff, for the first render and for identical documents. */
export const EMPTY_PLAN_DIFF: PlanDiff = { added: new Set(), removed: [], changed: new Map() };

/** The comparable surface of a node: its fields plus the structural values a person can see. */
function comparable(node: PlanNode): Record<string, unknown> {
  return {
    ...node.fields,
    parentRef: node.parentRef,
    status: node.status,
    templateId: node.templateId,
    initiativeRefs: node.initiativeRefs.join(','),
    initiativeIds: node.initiativeIds.join(','),
  };
}

function changedFields(before: PlanNode, after: PlanNode): string[] {
  const left = comparable(before);
  const right = comparable(after);
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const out: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(left[key] ?? null) !== JSON.stringify(right[key] ?? null)) out.push(key);
  }
  return out;
}

/**
 * Compare two documents.
 *
 * @param previous - The document last rendered, or null on first render.
 * @param next - The document about to render.
 * @returns the added refs, removed refs, and changed fields by ref.
 */
export function planDiff(previous: PlanDocument | null, next: PlanDocument): PlanDiff {
  if (previous === null) return EMPTY_PLAN_DIFF;
  const before = new Map(previous.nodes.map((node) => [node.ref, node]));
  const after = new Map(next.nodes.map((node) => [node.ref, node]));
  const added = new Set<string>();
  const changed = new Map<string, readonly string[]>();
  for (const [ref, node] of after) {
    const was = before.get(ref);
    if (!was) {
      added.add(ref);
      continue;
    }
    const fields = changedFields(was, node);
    if (fields.length > 0) changed.set(ref, fields);
  }
  const removed = [...before.keys()].filter((ref) => !after.has(ref));
  return { added, removed, changed };
}

/** How many fields a diff touched, for the status pill. */
export function changedFieldCount(diff: PlanDiff): number {
  let count = 0;
  for (const fields of diff.changed.values()) count += fields.length;
  return count;
}
