import type { PlannedWorkTree } from '@docket/work/blueprints';
import type { ScopedResolvedLabel } from '../labels';
import { resolveLabelCatalog } from '../labels';
import type { TemplateTransaction } from '../templates/persistence';

/** Keep reusable labels offered at the actual destination; explicit person-authored label writes stay strict. */
export function selectBlueprintLabels<T extends string>(
  requested: readonly T[],
  catalog: readonly Pick<ScopedResolvedLabel, 'id' | 'teamId'>[],
  teamId: string | null,
): { kept: T[]; omitted: boolean } {
  const offered = new Set(
    catalog
      .filter((label) => label.teamId === null || label.teamId === teamId)
      .map((label) => label.id),
  );
  const unique = [...new Set(requested)];
  const kept = unique.filter((id) => offered.has(id));
  return { kept, omitted: kept.length !== unique.length };
}

/** Normalize child starting labels once per tree and retain bounded review warnings for omissions. */
export async function resolveBlueprintLabelDefaults(
  tx: TemplateTransaction,
  orgId: string,
  tree: PlannedWorkTree,
): Promise<PlannedWorkTree> {
  const requested = tree.nodes.flatMap((node) =>
    'labelIds' in node.fields ? (node.fields.labelIds ?? []) : [],
  );
  const catalog = await resolveLabelCatalog(orgId, requested, tx);
  const omitted: (readonly string[])[] = [];
  const nodes = tree.nodes.map((node) => {
    if (!('labelIds' in node.fields)) return node;
    const selection = selectBlueprintLabels(node.fields.labelIds ?? [], catalog, node.teamId);
    if (selection.omitted) omitted.push(node.path);
    return { ...node, fields: { ...node.fields, labelIds: selection.kept } };
  });
  return {
    ...tree,
    nodes,
    warnings: [
      ...tree.warnings,
      ...(omitted.length
        ? [
            {
              code: 'label_unavailable' as const,
              paths: omitted.slice(0, 100),
              count: omitted.length,
            },
          ]
        : []),
    ],
  };
}
