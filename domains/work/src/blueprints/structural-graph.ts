import {
  Blueprint,
  type BlueprintStep,
  type BlueprintDateRule,
} from '../contracts/work-template-blueprint';
import { BlueprintError, pathKey, requireBlueprintValue } from './errors';
import type { BlueprintPath } from './types';
import type {
  StructuralBlueprintSnapshot,
  StructuralBlueprintNode,
  StructuralBlueprintGraph,
  StructuralBlueprintInput,
} from './structural-types';
import { assertAcyclic, assertBlueprintHierarchy } from './graph-prerequisites';

interface BuildState {
  readonly input: StructuralBlueprintInput;
  readonly nodes: StructuralBlueprintNode[];
  readonly dependencies: StructuralBlueprintGraph['dependencies'][number][];
  readonly edges: Map<string, string[]>;
}
function addPrerequisite(
  state: BuildState,
  prerequisite: BlueprintPath,
  consumer: BlueprintPath,
): void {
  const key = pathKey(consumer);
  state.edges.set(key, [...(state.edges.get(key) ?? []), pathKey(prerequisite)]);
  const index = state.nodes.findIndex((node) => pathKey(node.path) === key);
  const node = state.nodes[index];
  if (node)
    state.nodes[index] = { ...node, prerequisitePaths: [...node.prerequisitePaths, prerequisite] };
}
function timingKeys(rule: BlueprintDateRule): readonly string[] {
  if (rule.kind === 'after_completion') return rule.stepKeys;
  return rule.kind === 'anchor' && rule.anchor.kind === 'milestone' ? [rule.anchor.stepKey] : [];
}
function validTimingTarget(
  rule: BlueprintDateRule,
  target: BlueprintStep | undefined,
  consumer: BlueprintStep,
): boolean {
  if (rule.kind === 'anchor') return target?.kind === 'milestone';
  return target?.kind === 'task' && target.parentStepKey === consumer.parentStepKey;
}
function prerequisitePaths(
  step: BlueprintStep,
  steps: readonly BlueprintStep[],
  scope: BlueprintPath,
): BlueprintPath[] {
  const paths: BlueprintPath[] = [];
  for (const rule of Object.values(step.dates)) {
    if (!rule) continue;
    for (const key of timingKeys(rule)) {
      if (
        !validTimingTarget(
          rule,
          steps.find((entry) => entry.key === key),
          step,
        )
      )
        throw new BlueprintError(
          'blueprint_invalid',
          'Timing needs an authored Milestone or sibling Task prerequisite.',
          [[...scope, step.key]],
        );
      paths.push([...scope, key]);
    }
  }
  return paths;
}
interface StepExpansion {
  readonly snapshot: StructuralBlueprintSnapshot;
  readonly scope: BlueprintPath;
  readonly step: BlueprintStep;
  readonly parent: StructuralBlueprintNode;
  readonly stack: readonly string[];
}
function resolveStep(
  state: BuildState,
  snapshot: StructuralBlueprintSnapshot,
  step: BlueprintStep,
  path: BlueprintPath,
): StructuralBlueprintSnapshot | null {
  const publication = step.kind === 'milestone' ? null : state.input.resolve(snapshot, step, path);
  if (step.template && !publication)
    throw new BlueprintError('blueprint_invalid', 'An exact reference resolution is required.', [
      path,
    ]);
  if (publication && (publication.kind !== step.kind || publication.scopeKey !== snapshot.scopeKey))
    throw new BlueprintError('blueprint_invalid', 'Resolved source kind or scope does not match.', [
      path,
    ]);
  return publication;
}
function appendStep(state: BuildState, input: StepExpansion): StructuralBlueprintNode {
  const { snapshot, scope, step, parent, stack } = input;
  const path = [...scope, step.key];
  assertBlueprintHierarchy(parent.kind, step.kind);
  const publication = resolveStep(state, snapshot, step, path);
  const node: StructuralBlueprintNode = {
    path,
    parentPath: parent.path,
    scopePath: scope,
    kind: step.kind,
    step,
    definition: publication?.definition ?? null,
    ownerSourceKey: snapshot.sourceKey,
    selectedSourceKey: publication?.sourceKey ?? null,
    sourceStepKey: step.key,
    selected: true,
    prerequisitePaths: [],
  };
  state.nodes.push(node);
  if (state.nodes.length > 10000)
    throw new BlueprintError(
      'blueprint_limit',
      'Blueprint expansion exceeds the bounded preview limit.',
    );
  addPrerequisite(state, parent.path, path);
  if (step.template && publication) appendScope(state, publication, node, stack);
  return node;
}
function appendDependencies(
  state: BuildState,
  snapshot: StructuralBlueprintSnapshot,
  scope: BlueprintPath,
): void {
  for (const edge of snapshot.definition.blueprint.dependencies) {
    const steps = snapshot.definition.blueprint.steps;
    if (
      [edge.blockerStepKey, edge.blockedStepKey].some(
        (key) => steps.find((entry) => entry.key === key)?.kind !== 'task',
      )
    )
      throw new BlueprintError(
        'blueprint_invalid',
        'Dependencies require authored Task endpoints.',
      );
    const blockerPath = [...scope, edge.blockerStepKey];
    const blockedPath = [...scope, edge.blockedStepKey];
    state.dependencies.push({ blockerPath, blockedPath });
    addPrerequisite(state, blockerPath, blockedPath);
  }
}
function appendScope(
  state: BuildState,
  snapshot: StructuralBlueprintSnapshot,
  owner: StructuralBlueprintNode,
  stack: readonly string[],
): void {
  if (stack.includes(snapshot.definitionKey))
    throw new BlueprintError(
      'blueprint_loop',
      `Template identity loop: ${[...stack, snapshot.definitionKey].join(' → ')}`,
      [owner.path],
    );
  if (stack.length >= 500)
    throw new BlueprintError('blueprint_limit', 'Template nesting exceeds the 500-row limit.');
  const nextStack = [...stack, snapshot.definitionKey];
  const steps = Blueprint.parse(snapshot.definition.blueprint).steps;
  const finished = new Map<string, StructuralBlueprintNode>();
  const pending = [...steps].sort(
    (a, b) => a.sort - b.sort || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  while (pending.length > 0) {
    const index = pending.findIndex(
      (step) => step.parentStepKey === null || finished.has(step.parentStepKey),
    );
    if (index < 0)
      throw new BlueprintError('blueprint_loop', 'Blueprint containment cycle or unknown parent.');
    const step = requireBlueprintValue(pending.splice(index, 1)[0]);
    const parent =
      step.parentStepKey === null ? owner : requireBlueprintValue(finished.get(step.parentStepKey));
    const node = appendStep(state, { snapshot, scope: owner.path, step, parent, stack: nextStack });
    finished.set(step.key, node);
  }
  for (const step of steps)
    for (const prerequisite of prerequisitePaths(step, steps, owner.path))
      addPrerequisite(state, prerequisite, [...owner.path, step.key]);
  appendDependencies(state, snapshot, owner.path);
}
/**
 * Shared structural traversal for executable publication adapters and validation-only previews.
 * @throws {BlueprintError} For hierarchy, containment, timing or reference cycles and preview limits.
 */
export function buildStructuralBlueprint(
  input: StructuralBlueprintInput,
): StructuralBlueprintGraph {
  const root: StructuralBlueprintNode = {
    path: [],
    parentPath: null,
    scopePath: [],
    kind: input.root.kind,
    step: null,
    definition: input.root.definition,
    ownerSourceKey: null,
    selectedSourceKey: input.root.sourceKey,
    sourceStepKey: null,
    selected: true,
    prerequisitePaths: [],
  };
  const state: BuildState = { input, nodes: [root], dependencies: [], edges: new Map() };
  appendScope(state, input.root, root, []);
  assertAcyclic(state.edges);
  return { nodes: state.nodes, dependencies: state.dependencies };
}
