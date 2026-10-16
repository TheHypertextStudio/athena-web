import { BlueprintError } from '../blueprints/errors';
import { assertAcyclic } from '../blueprints/graph';
import {
  validateProspectiveBlueprintDefinition,
  type ProspectiveBlueprintGraph,
} from '../blueprints/prospective';
import { copyDefinitionKey, copyIdentityKey, copyIdentityScope } from './copy-identity';
import type { CopySourceIdentity } from './copy-identity';
import type { CopyDefinitionSource } from './copy-prospective-types';
import { authoredCopyReferences, type ProspectiveCopyCatalog } from './copy-prospective-source';

function edgeCount(source: CopyDefinitionSource): number {
  const timing = source.definition.blueprint.steps
    .flatMap((step) => Object.values(step.dates))
    .reduce((count, rule) => {
      if (rule?.kind === 'after_completion') return count + rule.stepKeys.length;
      return count + (rule?.kind === 'anchor' && rule.anchor.kind === 'milestone' ? 1 : 0);
    }, 0);
  return (
    authoredCopyReferences(source).length + source.definition.blueprint.dependencies.length + timing
  );
}
/** Resolve a bounded dependency-first source closure, counting authored edges once per exact source identity. */
export function prospectiveCopyClosure(
  catalog: ProspectiveCopyCatalog,
  roots: readonly CopySourceIdentity[],
): CopyDefinitionSource[] {
  if (!roots.length)
    throw new BlueprintError('blueprint_invalid', 'Choose at least one copy root.');
  const selected = new Map<string, CopyDefinitionSource>(),
    edges = new Map<string, string[]>();
  const pending = [...roots];
  let count = 0;
  while (pending.length) {
    const identity = pending.pop();
    if (!identity) break;
    const source = catalog.require(identity),
      key = copyIdentityKey(identity);
    if (selected.has(key)) continue;
    selected.set(key, source);
    if (selected.size > 100)
      throw new BlueprintError('blueprint_limit', 'Copy at most 100 distinct definitions.');
    count += edgeCount(source);
    if (count > 2000)
      throw new BlueprintError('blueprint_limit', 'Copy at most 2000 dependency edges.');
    const children = authoredCopyReferences(source).map((entry) =>
      catalog.resolve(source, entry.slot),
    );
    edges.set(key, [...new Set(children.map((child) => copyIdentityKey(child.identity)))].sort());
    pending.push(...children.map((child) => child.identity));
  }
  assertAcyclic(edges);
  return topological(selected, edges);
}
function topological(
  selected: ReadonlyMap<string, CopyDefinitionSource>,
  edges: ReadonlyMap<string, readonly string[]>,
): CopyDefinitionSource[] {
  const output: CopyDefinitionSource[] = [],
    visited = new Set<string>();
  function visit(key: string): void {
    if (visited.has(key)) return;
    visited.add(key);
    for (const next of edges.get(key) ?? []) visit(next);
    const source = selected.get(key);
    if (!source) throw new BlueprintError('blueprint_invalid', 'Missing exact source dependency.');
    output.push(source);
  }
  for (const key of [...selected.keys()].sort()) visit(key);
  return output;
}
function logicalSource(source: CopyDefinitionSource) {
  return {
    sourceKey: copyIdentityKey(source.identity),
    definitionKey: copyDefinitionKey(source.identity),
    scopeKey: copyIdentityScope(source.identity),
    kind: source.kind,
    definition: source.definition,
  };
}
/** Reuse the canonical hierarchy/timing/dependency validator without manufacturing publication or projection facts. */
export function validateProspectiveCopyExpansion(
  catalog: ProspectiveCopyCatalog,
  source: CopyDefinitionSource,
): ProspectiveBlueprintGraph {
  return validateProspectiveBlueprintDefinition({
    root: logicalSource(source),
    sources: [...catalog.sources.values()].map(logicalSource),
    bindings: [...catalog.bindings.values()]
      .filter((entry) => entry.slot.kind === 'blueprint_step')
      .map((entry) => ({
        ownerSourceKey: copyIdentityKey(entry.source),
        stepKey: entry.slot.key,
        targetSourceKey: copyIdentityKey(entry.target),
      })),
  });
}
