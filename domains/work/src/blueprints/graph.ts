import {
  Blueprint,
  type BlueprintStep,
  type BlueprintDateRule,
} from '../contracts/work-template-blueprint';
import { BlueprintError, pathKey, requireBlueprintValue } from './errors';
import type {
  BlueprintPath,
  BlueprintWorkKind,
  ExpandedBlueprint,
  ExpandedBlueprintNode,
  PublishedBlueprintSnapshot,
  ResolvedBlueprintGraph,
} from './types';

const children: Readonly<Record<BlueprintWorkKind, readonly BlueprintWorkKind[]>> = {
  initiative: ['program', 'project'],
  program: ['project', 'task'],
  project: ['milestone', 'task'],
  milestone: ['task'],
  task: ['task'],
};
/**
 * Assert the existing physical containment matrix without inventing work kinds.
 * @throws For invalid or ambiguous resolved snapshots, graph limits, or calendar inputs.
 */
export function assertBlueprintHierarchy(
  parent: BlueprintWorkKind,
  child: BlueprintWorkKind,
): void {
  if (!children[parent].includes(child))
    throw new BlueprintError(
      'blueprint_invalid',
      `Invalid blueprint hierarchy: ${parent} cannot contain ${child}.`,
    );
}
/**
 * Refuse cycles in a qualified prerequisite graph.
 * @throws For invalid or ambiguous resolved snapshots, graph limits, or calendar inputs.
 */
export function assertAcyclic(edges: ReadonlyMap<string, readonly string[]>): void {
  const visited = new Set<string>();
  const active = new Set<string>();
  for (const root of edges.keys()) {
    const pending = [{ key: root, exit: false }];
    while (pending.length > 0) {
      const entry = requireBlueprintValue(pending.pop());
      if (entry.exit) {
        active.delete(entry.key);
        visited.add(entry.key);
        continue;
      }
      if (active.has(entry.key))
        throw new BlueprintError('blueprint_loop', 'Blueprint prerequisite cycle.');
      if (visited.has(entry.key)) continue;
      active.add(entry.key);
      pending.push({ key: entry.key, exit: true });
      for (const next of edges.get(entry.key) ?? []) pending.push({ key: next, exit: false });
    }
  }
}

interface BuildState {
  readonly input: ResolvedBlueprintGraph;
  readonly nodes: ExpandedBlueprintNode[];
  readonly dependencies: ExpandedBlueprint['dependencies'][number][];
  readonly manifest: ExpandedBlueprint['manifest'][number][];
  readonly edges: Map<string, string[]>;
  readonly latest: Map<string, string>;
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
function assertLatest(
  state: BuildState,
  step: BlueprintStep,
  snapshot: PublishedBlueprintSnapshot,
): void {
  if (step.template?.selection.kind !== 'latest') return;
  const prior = state.latest.get(snapshot.workTypeId);
  if (prior && prior !== snapshot.versionId)
    throw new BlueprintError(
      'blueprint_invalid',
      'Latest template references must use one frozen publication.',
    );
  state.latest.set(snapshot.workTypeId, snapshot.versionId);
}
function resolvePublication(
  state: BuildState,
  step: BlueprintStep,
  path: BlueprintPath,
): PublishedBlueprintSnapshot | null {
  if (step.kind === 'milestone') return null;
  const resolved = state.input.resolutions.filter((entry) => pathKey(entry.path) === pathKey(path));
  if (resolved.length !== 1)
    throw new BlueprintError(
      'blueprint_invalid',
      'An exact publication resolution is required for every work step.',
      [path],
    );
  const chosen = requireBlueprintValue(resolved[0]);
  const snapshot = requireBlueprintValue(
    [state.input.root, ...state.input.publications].find(
      (item) => item.workTypeId === chosen.workTypeId && item.versionId === chosen.versionId,
    ),
  );
  if (snapshot.kind !== step.kind || snapshot.organizationId !== state.input.root.organizationId)
    throw new BlueprintError(
      'blueprint_invalid',
      'Resolved template kind or workspace does not match the step.',
      [path],
    );
  assertReferenceSelection(step, snapshot, path);
  assertLatest(state, step, snapshot);
  return snapshot;
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
  readonly snapshot: PublishedBlueprintSnapshot;
  readonly scope: BlueprintPath;
  readonly step: BlueprintStep;
  readonly parent: ExpandedBlueprintNode;
  readonly stack: readonly string[];
}
function appendStep(state: BuildState, input: StepExpansion): ExpandedBlueprintNode {
  const { snapshot, scope, step, parent, stack } = input;
  const path = [...scope, step.key];
  assertBlueprintHierarchy(parent.kind, step.kind);
  const publication = resolvePublication(state, step, path);
  const sourceStepId = snapshot.stepIds[step.key];
  if (!sourceStepId)
    throw new BlueprintError('blueprint_invalid', 'Missing immutable step projection.', [path]);
  const node: ExpandedBlueprintNode = {
    path,
    parentPath: parent.path,
    scopePath: scope,
    kind: step.kind,
    step,
    definition: publication?.definition ?? null,
    workTypeId: publication?.workTypeId ?? null,
    workTypeVersionId: publication?.versionId ?? null,
    sourceStepId,
    sourceWorkTypeId: snapshot.workTypeId,
    sourceVersionId: snapshot.versionId,
    selected: true,
    prerequisitePaths: [],
  };
  state.nodes.push(node);
  if (state.nodes.length > 10000)
    throw new BlueprintError(
      'blueprint_limit',
      'Blueprint expansion exceeds the bounded preview limit.',
    );
  if (publication)
    state.manifest.push({
      path,
      workTypeId: publication.workTypeId,
      versionId: publication.versionId,
    });
  addPrerequisite(state, parent.path, path);
  if (step.template && publication) appendScope(state, publication, node, stack);
  return node;
}
function appendDependencies(
  state: BuildState,
  snapshot: PublishedBlueprintSnapshot,
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
  snapshot: PublishedBlueprintSnapshot,
  owner: ExpandedBlueprintNode,
  stack: readonly string[],
): void {
  if (stack.includes(snapshot.workTypeId))
    throw new BlueprintError(
      'blueprint_loop',
      `Template identity loop: ${[...stack, snapshot.workTypeId].join(' → ')}`,
      [owner.path],
    );
  if (stack.length >= 500)
    throw new BlueprintError('blueprint_limit', 'Template nesting exceeds the 500-row limit.');
  const nextStack = [...stack, snapshot.workTypeId];
  const steps = Blueprint.parse(snapshot.definition.blueprint).steps;
  const finished = new Map<string, ExpandedBlueprintNode>();
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
 * Build every optional branch for publication validation and creation previews.
 * @throws For invalid or ambiguous resolved snapshots, graph limits, or calendar inputs.
 */
export function buildBlueprintGraph(input: ResolvedBlueprintGraph): ExpandedBlueprint {
  const root: ExpandedBlueprintNode = {
    path: [],
    parentPath: null,
    scopePath: [],
    kind: input.root.kind,
    step: null,
    definition: input.root.definition,
    workTypeId: input.root.workTypeId,
    workTypeVersionId: input.root.versionId,
    sourceStepId: null,
    sourceWorkTypeId: null,
    sourceVersionId: null,
    selected: true,
    prerequisitePaths: [],
  };
  const state: BuildState = {
    input,
    nodes: [root],
    dependencies: [],
    manifest: [{ path: [], workTypeId: input.root.workTypeId, versionId: input.root.versionId }],
    edges: new Map(),
    latest: new Map(),
  };
  appendScope(state, input.root, root, []);
  assertAcyclic(state.edges);
  return { nodes: state.nodes, dependencies: state.dependencies, manifest: state.manifest };
}
/**
 * Validate the complete worst-case graph, including all optional children.
 * @throws For invalid or ambiguous resolved snapshots, graph limits, or calendar inputs.
 */
export function validateBlueprintGraph(input: ResolvedBlueprintGraph): void {
  const graph = buildBlueprintGraph(input);
  assertBlueprintEdgeLimit(graph.nodes);
  if (graph.nodes.length > 500)
    throw new BlueprintError(
      'blueprint_limit',
      'Blueprint limit is 500 work rows including the root and Milestones.',
    );
}

/**
 * Bound the distinct combined prerequisite edges for the selected or worst-case graph.
 * @throws For invalid or ambiguous resolved snapshots, graph limits, or calendar inputs.
 */
export function assertBlueprintEdgeLimit(nodes: readonly ExpandedBlueprintNode[]): void {
  const selected = new Set(nodes.filter((node) => node.selected).map((node) => pathKey(node.path)));
  const count = nodes
    .filter((node) => node.selected)
    .reduce(
      (total, node) =>
        total +
        new Set(node.prerequisitePaths.filter((path) => selected.has(pathKey(path))).map(pathKey))
          .size,
      0,
    );
  if (count > 2000)
    throw new BlueprintError('blueprint_limit', 'Combined blueprint graph edge limit is 2000.');
}
