/** Current grants govern confirmed work even inside an owner-only planning document. */
import type { PlanDocument, PlanNode } from '@docket/work/plan-draft-contract';

import { resourceAccessKey, viewableResourceKeys } from '../../permissions/resource-access';
import type { PlanDraftRow } from './store';

/** A redacted response document and the confirmed nodes safe to hydrate with live data. */
export interface VisiblePlan {
  readonly document: PlanDocument;
  readonly confirmed: readonly PlanNode[];
}

/**
 * Project confirmed work through the owner's current grants without rewriting their saved draft.
 *
 * @param row - The personal plan and owner whose active memberships authorize its resources.
 * @returns Unavailable placeholders preserve graph structure and authored children; hidden live
 * snapshots and cached record fields are never returned.
 */
export async function visiblePlan(row: PlanDraftRow): Promise<VisiblePlan> {
  const ref = (node: PlanNode) => ({
    organizationId: row.organizationId,
    kind: node.kind,
    id: node.objectId ?? '',
  });
  const confirmed = row.document.nodes.filter((node) => node.objectId !== null);
  const keys = await viewableResourceKeys(row.ownerUserId, confirmed.map(ref));
  const accessible = (node: PlanNode): boolean => keys.has(resourceAccessKey(ref(node)));
  const document = {
    ...row.document,
    nodes: row.document.nodes.map((node) =>
      node.objectId === null || accessible(node)
        ? node
        : { ...node, fields: { title: 'Unavailable work' } },
    ),
  };
  return { document, confirmed: confirmed.filter(accessible) };
}

/** Return only the response-safe document for an MCP or agent-context read. */
export async function visiblePlanDocument(row: PlanDraftRow): Promise<PlanDocument> {
  return (await visiblePlan(row)).document;
}
