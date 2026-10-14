/**
 * `domain packages` — the structural rules a plan document must keep.
 *
 * @remarks
 * Which parent each kind may sit under, how deep tasks nest, which initiatives a project may join,
 * and that dependency edges stay acyclic. The reducer in `./plan-draft.ts` applies a batch and then
 * checks these, so a rejection can name both the failing op and the refs that would have fitted.
 */
import type { PlanDocument, PlanNode, PlanNodeKind } from './contracts/plan-draft';

/**
 * A rejected op: which one, which path inside it, why in plain words, and what would fit.
 *
 * @remarks
 * `options` names the refs the field could have taken instead — the nodes a parent may be, or the
 * initiatives a project may join. An agent only sees an error's path, code, and allowed values, so
 * the options are what turn a refusal into a next step.
 */
export class PlanOpError extends Error {
  constructor(
    readonly index: number,
    readonly path: string,
    readonly reason: string,
    readonly options: readonly string[] = [],
  ) {
    super(`${path}: ${reason}`);
    this.name = 'PlanOpError';
  }
}

/** Which parent kinds each kind may sit under. */
const ALLOWED_PARENTS: Readonly<Record<PlanNodeKind, readonly PlanNodeKind[]>> = {
  initiative: [],
  program: ['initiative'],
  project: ['program', 'initiative'],
  task: ['project', 'task'],
};

/**
 * How deep a task may sit inside other tasks.
 *
 * @remarks
 * One: a feature task carries its engineering subtasks, and a subtask carries none of its own.
 * The real task record nests without limit, so the ceiling is a planning rule rather than a
 * storage one — a canvas row that can hide work three levels down stops being readable, and the
 * shape the person asked for is exactly two levels.
 */
const MAX_TASK_DEPTH = 1;

/** Find a node by ref. */
export function planNode(document: PlanDocument, ref: string): PlanNode | undefined {
  return document.nodes.find((node) => node.ref === ref);
}

/** The refs of every node of the given kinds other than `selfRef`, in document order. */
function refsOfKinds(
  document: PlanDocument,
  kinds: readonly PlanNodeKind[],
  selfRef: string,
): string[] {
  return document.nodes
    .filter((node) => node.ref !== selfRef && kinds.includes(node.kind))
    .map((node) => node.ref);
}

/** Reject a parent the kind cannot sit under, an unknown parent, or a cycle. */
export function assertParent(
  index: number,
  document: PlanDocument,
  kind: PlanNodeKind,
  parentRef: string | null,
  selfRef: string,
): void {
  const path = `ops.${index}.parentRef`;
  const candidates = (): string[] => refsOfKinds(document, ALLOWED_PARENTS[kind], selfRef);
  if (parentRef === null) {
    if (kind === 'initiative') return;
    throw new PlanOpError(index, path, `A ${kind} needs a parent.`, candidates());
  }
  if (parentRef === selfRef) throw new PlanOpError(index, path, 'A node cannot be its own parent.');
  const parent = planNode(document, parentRef);
  if (!parent || !ALLOWED_PARENTS[kind].includes(parent.kind)) {
    const reason = parent
      ? `A ${kind} cannot sit under a ${parent.kind}.`
      : `No node has ref "${parentRef}".`;
    throw new PlanOpError(index, path, reason, candidates());
  }
  let cursor: PlanNode | undefined = parent;
  while (cursor) {
    if (cursor.ref === selfRef) throw new PlanOpError(index, path, 'That would make a cycle.');
    cursor = cursor.parentRef === null ? undefined : planNode(document, cursor.parentRef);
  }
}

/**
 * Reject an extra initiative that is not an initiative node in this document.
 *
 * @remarks
 * Checked after the batch, like parents, so a project may name an initiative added later in the
 * same batch. The options are the initiatives the project could join.
 */
export function assertInitiativeRefs(index: number, document: PlanDocument, node: PlanNode): void {
  for (const ref of node.initiativeRefs) {
    if (planNode(document, ref)?.kind === 'initiative') continue;
    throw new PlanOpError(
      index,
      `ops.${index}.node.initiativeRefs`,
      `No initiative node has ref "${ref}".`,
      refsOfKinds(document, ['initiative'], node.ref),
    );
  }
}

/** How many tasks sit above a node on its way to the root. */
function taskAncestorCount(document: PlanDocument, node: PlanNode): number {
  let count = 0;
  let cursor = node.parentRef === null ? undefined : planNode(document, node.parentRef);
  while (cursor) {
    if (cursor.kind === 'task') count += 1;
    cursor = cursor.parentRef === null ? undefined : planNode(document, cursor.parentRef);
  }
  return count;
}

/**
 * Reject a task nested deeper than one level, for a node and everything under it.
 *
 * @remarks
 * The whole subtree is checked, not just the node itself, because moving a feature task that
 * already carries subtasks under another task would push those subtasks past the ceiling without
 * any op ever naming them.
 */
export function assertTaskDepth(index: number, document: PlanDocument, ref: string): void {
  for (const member of subtreeRefs(document, ref)) {
    const node = planNode(document, member);
    if (node?.kind !== 'task') continue;
    if (taskAncestorCount(document, node) > MAX_TASK_DEPTH) {
      throw new PlanOpError(
        index,
        `ops.${index}.parentRef`,
        'A subtask carries no subtasks of its own.',
      );
    }
  }
}

/** The ref and every descendant ref. */
export function subtreeRefs(document: PlanDocument, ref: string): Set<string> {
  const out = new Set([ref]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of document.nodes) {
      if (node.parentRef !== null && out.has(node.parentRef) && !out.has(node.ref)) {
        out.add(node.ref);
        grew = true;
      }
    }
  }
  return out;
}

/** Whether `start` already reaches `target` along the document's dependency edges. */
export function reaches(document: PlanDocument, start: string, target: string): boolean {
  const seen = new Set([start]);
  const pending = [start];
  for (let ref = pending.pop(); ref !== undefined; ref = pending.pop()) {
    if (ref === target) return true;
    for (const edge of document.edges) {
      if (edge.fromRef !== ref || seen.has(edge.toRef)) continue;
      seen.add(edge.toRef);
      pending.push(edge.toRef);
    }
  }
  return false;
}
