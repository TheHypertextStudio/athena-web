/**
 * `components/plan-canvas/plan-confirm` — what confirming a selection will create.
 *
 * @remarks
 * A confirmation names its consequences before it runs: the selected nodes, every draft beneath
 * them (a project brings its tasks), and every draft above them (a task brings its project and
 * initiative). The label leads with what the person picked and names the ancestors after it, so
 * the button reads "Confirm project and 2 tasks" or "Confirm task and its project" rather than
 * "Confirm".
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

/** Join counted kinds into a sentence fragment: "project and 2 tasks". */
function joinCounts(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0] ?? ''} and ${parts[1] ?? ''}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1) ?? ''}`;
}

/** How many nodes of each kind `refs` name. */
function countKinds(document: PlanDocument, refs: readonly string[]): Map<PlanNodeKind, number> {
  const counts = new Map<PlanNodeKind, number>();
  for (const ref of refs) {
    const node = document.nodes.find((candidate) => candidate.ref === ref);
    if (!node) continue;
    counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
  }
  return counts;
}

/** "project", "2 tasks": one part per kind present, in hierarchy order. */
function kindParts(counts: ReadonlyMap<PlanNodeKind, number>): string[] {
  return KIND_ORDER.filter((kind) => counts.has(kind)).map((kind) => {
    const count = counts.get(kind) ?? 0;
    return count === 1 ? kind : `${String(count)} ${pluralise(count, kind)}`;
  });
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
  const chosen = new Set(subtreeRefs(document, refs));
  const closure = planNodeClosure(document, [...chosen]);
  // What the person picked (and everything beneath it) is the subject; draft ancestors the
  // commit has to create first are named after it, so a task reads "Confirm task and its
  // project" rather than leading with an initiative the person never selected.
  const ownRefs = closure.filter((ref) => chosen.has(ref));
  const subject = joinCounts(kindParts(countKinds(document, ownRefs)));
  const above = countKinds(
    document,
    closure.filter((ref) => !chosen.has(ref)),
  );
  // Nearest ancestor first: "its project and initiative".
  const ancestors = [...KIND_ORDER].reverse().filter((kind) => above.has(kind));
  const suffix =
    ancestors.length === 0
      ? ''
      : ` and ${refs.length === 1 ? 'its' : 'their'} ${ancestors.join(' and ')}`;
  return {
    refs: closure,
    count: closure.length,
    label: closure.length === 0 ? 'Nothing to confirm' : `Confirm ${subject}${suffix}`,
  };
}
