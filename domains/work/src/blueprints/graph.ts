import type { BlueprintStep } from '../contracts/work-template-blueprint';
import { BlueprintError, pathKey, requireBlueprintValue } from './errors';
import { buildStructuralBlueprint } from './structural-graph';
import { assertStructuralEdgeLimit } from './graph-prerequisites';
import type { StructuralBlueprintNode, StructuralBlueprintSnapshot } from './structural-types';
import type {
  BlueprintPath,
  ExpandedBlueprint,
  ExpandedBlueprintNode,
  PublishedBlueprintSnapshot,
  ResolvedBlueprintGraph,
} from './types';

export {
  assertAcyclic,
  assertBlueprintHierarchy,
  assertStructuralEdgeLimit as assertBlueprintEdgeLimit,
} from './graph-prerequisites';

function sourceKey(snapshot: PublishedBlueprintSnapshot): string {
  return snapshot.privateInvocationId
    ? JSON.stringify([snapshot.organizationId, 'private', snapshot.privateInvocationId])
    : JSON.stringify([snapshot.organizationId, snapshot.workTypeId, snapshot.versionId]);
}
function structural(snapshot: PublishedBlueprintSnapshot): StructuralBlueprintSnapshot {
  return {
    sourceKey: sourceKey(snapshot),
    definitionKey: snapshot.privateInvocationId
      ? JSON.stringify([snapshot.organizationId, 'private', snapshot.privateInvocationId])
      : JSON.stringify([snapshot.organizationId, snapshot.workTypeId]),
    scopeKey: snapshot.organizationId,
    kind: snapshot.kind,
    definition: snapshot.definition,
  };
}
function assertReferenceSelection(
  step: BlueprintStep,
  snapshot: PublishedBlueprintSnapshot,
  path: BlueprintPath,
): void {
  const reference = step.template;
  if (!reference) return;
  if (reference.workTypeId !== snapshot.workTypeId)
    throw new BlueprintError(
      'blueprint_invalid',
      'Resolved definition does not match the authored selection.',
      [path],
    );
  if (
    reference.selection.kind === 'pinned' &&
    reference.selection.workTypeVersionId !== snapshot.versionId
  )
    throw new BlueprintError(
      'blueprint_invalid',
      'Resolved publication does not match the authored pin.',
      [path],
    );
}
function resolvePublication(
  input: ResolvedBlueprintGraph,
  step: BlueprintStep,
  path: BlueprintPath,
  latest: Map<string, string>,
): PublishedBlueprintSnapshot {
  const resolved = input.resolutions.filter((entry) => pathKey(entry.path) === pathKey(path));
  if (resolved.length !== 1)
    throw new BlueprintError(
      'blueprint_invalid',
      'An exact publication resolution is required for every work step.',
      [path],
    );
  const chosen = requireBlueprintValue(resolved[0]);
  // A private root carries authored steps under its base identity; a step resolving to that same base
  // publication must expand the publication itself, never the private structure again.
  const snapshot = requireBlueprintValue(
    [input.root, ...input.publications].find(
      (item) =>
        !item.privateInvocationId &&
        item.workTypeId === chosen.workTypeId &&
        item.versionId === chosen.versionId,
    ),
  );
  assertReferenceSelection(step, snapshot, path);
  if (step.template?.selection.kind === 'latest') {
    const prior = latest.get(snapshot.workTypeId);
    if (prior && prior !== snapshot.versionId)
      throw new BlueprintError(
        'blueprint_invalid',
        'Latest template references must use one frozen publication.',
      );
    latest.set(snapshot.workTypeId, snapshot.versionId);
  }
  return snapshot;
}
function selectedIdentity(
  node: StructuralBlueprintNode,
  sources: ReadonlyMap<string, PublishedBlueprintSnapshot>,
): Pick<ExpandedBlueprintNode, 'workTypeId' | 'workTypeVersionId'> {
  const selected = node.selectedSourceKey
    ? requireBlueprintValue(sources.get(node.selectedSourceKey))
    : null;
  return selected
    ? { workTypeId: selected.workTypeId, workTypeVersionId: selected.versionId }
    : { workTypeId: null, workTypeVersionId: null };
}
function projectedOrigin(
  node: StructuralBlueprintNode,
  sources: ReadonlyMap<string, PublishedBlueprintSnapshot>,
): Pick<
  ExpandedBlueprintNode,
  'sourceStepId' | 'sourceWorkTypeId' | 'sourceVersionId' | 'privateOrigin'
> {
  if (!node.ownerSourceKey)
    return { sourceStepId: null, sourceWorkTypeId: null, sourceVersionId: null };
  const owner = requireBlueprintValue(sources.get(node.ownerSourceKey));
  const sourceStepId = node.sourceStepKey ? owner.stepIds[node.sourceStepKey] : null;
  if (!sourceStepId)
    throw new BlueprintError('blueprint_invalid', 'Missing immutable step projection.', [
      node.path,
    ]);
  if (owner.privateInvocationId)
    return {
      sourceStepId: null,
      sourceWorkTypeId: null,
      sourceVersionId: null,
      privateOrigin: { invocationId: owner.privateInvocationId, stepAlias: sourceStepId },
    };
  return { sourceStepId, sourceWorkTypeId: owner.workTypeId, sourceVersionId: owner.versionId };
}
function projectNode(
  node: StructuralBlueprintNode,
  sources: ReadonlyMap<string, PublishedBlueprintSnapshot>,
): ExpandedBlueprintNode {
  return {
    path: node.path,
    parentPath: node.parentPath,
    scopePath: node.scopePath,
    kind: node.kind,
    step: node.step,
    definition: node.definition,
    ...selectedIdentity(node, sources),
    ...projectedOrigin(node, sources),
    selected: node.selected,
    prerequisitePaths: node.prerequisitePaths,
  };
}
/**
 * Build every optional branch from exact authorized publications and physical step projections.
 * @throws {BlueprintError} For missing publication facts, invalid graphs or bounded preview limits.
 */
export function buildBlueprintGraph(input: ResolvedBlueprintGraph): ExpandedBlueprint {
  const sources = new Map([[sourceKey(input.root), input.root]]);
  const latest = new Map<string, string>();
  const graph = buildStructuralBlueprint({
    root: structural(input.root),
    resolve: (_owner, step, path) => {
      const snapshot = resolvePublication(input, step, path, latest);
      sources.set(sourceKey(snapshot), snapshot);
      return structural(snapshot);
    },
  });
  const nodes = graph.nodes.map((node) => projectNode(node, sources));
  const manifest = nodes.flatMap((node) =>
    node.workTypeId && node.workTypeVersionId
      ? [{ path: [...node.path], workTypeId: node.workTypeId, versionId: node.workTypeVersionId }]
      : [],
  );
  return { nodes, dependencies: graph.dependencies, manifest };
}
/**
 * Validate the complete worst-case published graph, including all optional children.
 * @throws {BlueprintError} For invalid graphs or more than 500 work rows/2,000 prerequisite edges.
 */
export function validateBlueprintGraph(input: ResolvedBlueprintGraph): void {
  const graph = buildBlueprintGraph(input);
  assertStructuralEdgeLimit(graph.nodes);
  if (graph.nodes.length > 500)
    throw new BlueprintError(
      'blueprint_limit',
      'Blueprint limit is 500 work rows including the root and Milestones.',
    );
}
