/** Resource authorization for relationships and placement a plan commit will write. */
import { canActorBatch } from '@docket/authz';
import type { PlanDocument } from '@docket/work/plan-draft-contract';

import { CapabilityError } from '../../error';
import type { Tx } from '../organize/place';

/** Existing resources whose graph or containment the selected draft nodes would change. */
function affectedReferences(document: PlanDocument, closure: ReadonlySet<string>, orgId: string) {
  const byRef = new Map(document.nodes.map((node) => [node.ref, node]));
  const refs = new Set<string>();
  const initiatives = new Set<string>();
  for (const node of document.nodes) {
    if (!closure.has(node.ref)) continue;
    if (node.parentRef !== null) refs.add(node.parentRef);
    for (const ref of node.initiativeRefs) refs.add(ref);
    for (const id of node.initiativeIds) initiatives.add(id);
  }
  for (const edge of document.edges) {
    if (!closure.has(edge.fromRef) && !closure.has(edge.toRef)) continue;
    refs.add(edge.fromRef);
    refs.add(edge.toRef);
  }
  return [
    ...[...refs].flatMap((ref) => {
      const node = byRef.get(ref);
      return node?.objectId ? [{ kind: node.kind, id: node.objectId, orgId }] : [];
    }),
    ...[...initiatives].map((id) => ({ kind: 'initiative' as const, id, orgId })),
  ];
}

/**
 * Require contribution on existing parents, initiative memberships, and dependency endpoints.
 *
 * @param input - The plan, chosen draft closure, workspace, and acting principal.
 * @param tx - The transaction that will create the work and its relationships.
 * @throws {CapabilityError} When a referenced resource is no longer writable by this actor.
 */
export async function authorizePlanCommit(
  input: { document: PlanDocument; closure: ReadonlySet<string>; orgId: string; actorId: string },
  tx: Tx,
): Promise<void> {
  const targets = affectedReferences(input.document, input.closure, input.orgId);
  const decisions = await canActorBatch(input.actorId, 'contribute', targets, tx);
  if (decisions.some((decision) => !decision.allow)) throw new CapabilityError();
}
