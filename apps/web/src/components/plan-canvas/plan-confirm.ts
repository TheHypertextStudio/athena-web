/**
 * `components/plan-canvas/plan-confirm` — what confirming a selection will create.
 *
 * @remarks
 * A confirmation names its consequences before it runs: the selected nodes, every draft beneath
 * them (a project brings its tasks), and every draft above them (a task brings its project and
 * initiative). The label is composed from the counts by kind so the button reads
 * "Confirm project and 2 tasks" rather than "Confirm".
 */
import type { PlanDocument, PlanNodeKind } from '@docket/work/plan-draft-contract';
import { planNodeClosure } from '@docket/work/plan-draft';

/** The refs a confirmation touches and how the button should describe them. */
export interface ConfirmationPlan {
  /** Every draft ref the commit will create, parents first. */
  readonly refs: readonly string[];
  /** How many of those there are. */
  readonly count: number;
  /** The button label. */
  readonly label: string;
}

/** The refs plus every descendant ref, in document order. */
export function subtreeRefs(document: PlanDocument, refs: readonly string[]): string[] {
  const wanted = new Set(refs);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of document.nodes) {
      if (node.parentRef !== null && wanted.has(node.parentRef) && !wanted.has(node.ref)) {
        wanted.add(node.ref);
        grew = true;
      }
    }
  }
  return document.nodes.filter((node) => wanted.has(node.ref)).map((node) => node.ref);
}

const KIND_ORDER: readonly PlanNodeKind[] = ['initiative', 'program', 'project', 'task'];

function pluralise(count: number, kind: PlanNodeKind): string {
  return count === 1 ? kind : `${kind}s`;
}

/** Join counted kinds into a sentence fragment: "initiative, 2 projects, and 5 tasks". */
function joinCounts(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0] ?? ''} and ${parts[1] ?? ''}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1) ?? ''}`;
}

/**
 * Describe what confirming `refs` will create.
 *
 * @param document - The plan document.
 * @param refs - The selected refs.
 * @returns the closed set of draft refs and a label naming them by kind.
 */
export function describeConfirmation(
  document: PlanDocument,
  refs: readonly string[],
): ConfirmationPlan {
  const closure = planNodeClosure(document, subtreeRefs(document, refs));
  const counts = new Map<PlanNodeKind, number>();
  for (const ref of closure) {
    const node = document.nodes.find((candidate) => candidate.ref === ref);
    if (!node) continue;
    counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
  }
  const parts = KIND_ORDER.filter((kind) => counts.has(kind)).map((kind) => {
    const count = counts.get(kind) ?? 0;
    return count === 1 ? kind : `${String(count)} ${pluralise(count, kind)}`;
  });
  return {
    refs: closure,
    count: closure.length,
    label: closure.length === 0 ? 'Nothing to confirm' : `Confirm ${joinCounts(parts)}`,
  };
}
