import { canonicalJsonFacts } from '../canonical-json-facts';
import { WorkTemplateDefinition } from '../contracts/work-template';
import { BlueprintError, requireBlueprintValue } from './errors';
import { buildStructuralBlueprint } from './structural-graph';
import { assertStructuralEdgeLimit } from './graph-prerequisites';
import type { StructuralBlueprintGraph, StructuralBlueprintSnapshot } from './structural-types';

/** Actual catalog, draft or publication facts normalized without claiming executable provenance. */
export type ProspectiveBlueprintSnapshot = StructuralBlueprintSnapshot;
/** Exact checked target for one authored reference, shared by every expansion of that source. */
export interface ProspectiveBlueprintBinding {
  readonly ownerSourceKey: string;
  readonly stepKey: string;
  readonly targetSourceKey: string;
}
/** Authorized frozen logical facts. Source selection and access are the caller's responsibility. */
export interface ProspectiveBlueprintInput {
  readonly root: ProspectiveBlueprintSnapshot;
  readonly sources: readonly ProspectiveBlueprintSnapshot[];
  readonly bindings: readonly ProspectiveBlueprintBinding[];
}
/** Validation-only qualified nodes; this graph cannot be passed to ordinary work creation. */
export type ProspectiveBlueprintGraph = StructuralBlueprintGraph;

function checkedSources(
  input: ProspectiveBlueprintInput,
): Map<string, ProspectiveBlueprintSnapshot> {
  const sources = new Map<string, ProspectiveBlueprintSnapshot>();
  for (const source of [input.root, ...input.sources]) {
    const definition = WorkTemplateDefinition.parse(source.definition);
    if (
      !source.sourceKey ||
      !source.definitionKey ||
      !source.scopeKey ||
      definition.payload.targetType !== source.kind
    )
      throw new BlueprintError(
        'blueprint_invalid',
        'Prospective source identity or kind is invalid.',
      );
    const normalized = {
      sourceKey: source.sourceKey,
      definitionKey: source.definitionKey,
      scopeKey: source.scopeKey,
      kind: source.kind,
      definition,
    };
    const prior = sources.get(source.sourceKey);
    if (prior && canonicalJsonFacts(prior) !== canonicalJsonFacts(normalized))
      throw new BlueprintError('blueprint_invalid', 'Conflicting exact prospective source facts.');
    sources.set(source.sourceKey, normalized);
  }
  return sources;
}
function bindingKey(owner: string, step: string): string {
  return JSON.stringify([owner, step]);
}
function checkedBindings(input: ProspectiveBlueprintInput): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const binding of input.bindings) {
    const key = bindingKey(binding.ownerSourceKey, binding.stepKey);
    const prior = bindings.get(key);
    if (prior && prior !== binding.targetSourceKey)
      throw new BlueprintError(
        'blueprint_invalid',
        'Conflicting prospective reference resolutions.',
      );
    bindings.set(key, binding.targetSourceKey);
  }
  return bindings;
}
/**
 * Validate unpublished or catalog structure using the ordinary blueprint traversal and limits.
 * Inline work needs no fabricated base publication; exact explicit references use checked bindings.
 * @returns Logical validation facts without publication IDs, projections or execution authority.
 * @throws {BlueprintError} For conflicting sources, missing resolutions, invalid graphs or limits.
 */
export function validateProspectiveBlueprintDefinition(
  input: ProspectiveBlueprintInput,
): ProspectiveBlueprintGraph {
  const sources = checkedSources(input);
  const bindings = checkedBindings(input);
  const graph = buildStructuralBlueprint({
    root: requireBlueprintValue(sources.get(input.root.sourceKey)),
    resolve: (owner, step) => {
      if (!step.template) return null;
      const key = bindings.get(bindingKey(owner.sourceKey, step.key));
      const chosen = key ? sources.get(key) : null;
      if (!chosen)
        throw new BlueprintError(
          'blueprint_invalid',
          'An exact prospective reference resolution is required.',
        );
      return requireBlueprintValue(chosen);
    },
  });
  assertStructuralEdgeLimit(graph.nodes);
  if (graph.nodes.length > 500)
    throw new BlueprintError(
      'blueprint_limit',
      'Blueprint limit is 500 work rows including the root and Milestones.',
    );
  return graph;
}
