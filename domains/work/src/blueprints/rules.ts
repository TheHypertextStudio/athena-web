import type { ActorId, TeamId } from '@docket/identity-access/ids';
import type { CycleId } from '../ids';
import { BlueprintCivilDate, WorkingWeekdays } from '../contracts/work-template-blueprint';
import { templateMerge } from '../template-merge';
import { assertBlueprintDateWindow, blueprintAnchor, deriveBlueprintDate } from './dates';
import { BlueprintError, pathKey, requireBlueprintValue } from './errors';
import { expandBlueprint } from './expand';
import type {
  BlueprintCreationContext,
  BlueprintDateField,
  BlueprintFields,
  BlueprintNodeOverride,
  BlueprintWarning,
  ExpandedBlueprintNode,
  PlannedWorkNode,
  PlannedWorkTree,
  ResolvedBlueprintInput,
  ResolvedBlueprintFields,
} from './types';

/** Aggregate warnings by stable code, bounding previews without losing affected counts. */
export function aggregateBlueprintWarnings(
  warnings: readonly BlueprintWarning[],
): BlueprintWarning[] {
  const grouped = new Map<BlueprintWarning['code'], Map<string, readonly string[]>>();
  for (const warning of warnings) {
    const paths = grouped.get(warning.code) ?? new Map<string, readonly string[]>();
    for (const path of warning.paths) paths.set(pathKey(path), path);
    grouped.set(warning.code, paths);
  }
  return [...grouped].map(([code, paths]) => ({
    code,
    paths: [...paths.values()].slice(0, 100),
    count: paths.size,
  }));
}
function warn(
  warnings: BlueprintWarning[],
  code: BlueprintWarning['code'],
  node: ExpandedBlueprintNode,
): null {
  warnings.push({ code, paths: [node.path], count: 1 });
  return null;
}
function activeActor(id: ActorId | null, context: BlueprintCreationContext): boolean {
  return id !== null && context.actors.some((actor) => actor.id === id && actor.active);
}
function resolveActor(
  node: ExpandedBlueprintNode,
  parent: PlannedWorkNode,
  context: BlueprintCreationContext,
  warnings: BlueprintWarning[],
): ActorId | null {
  if (node.kind === 'milestone') return parent.responsibleActorId;
  const rule = requireBlueprintValue(node.step).actorRule;
  if (rule === 'unassigned') return null;
  const id =
    rule === 'creator'
      ? context.initiatingActorId
      : rule === 'athena'
        ? context.athenaActorId
        : parent.responsibleActorId;
  if (activeActor(id, context)) return id;
  return warn(warnings, rule === 'athena' ? 'athena_unavailable' : 'actor_unavailable', node);
}
function resolveTeam(
  node: ExpandedBlueprintNode,
  parent: PlannedWorkNode,
  context: BlueprintCreationContext,
  override?: BlueprintNodeOverride,
): TeamId | null {
  if (node.kind === 'milestone') return parent.teamId;
  const team =
    override?.teamId !== undefined
      ? override.teamId
      : requireBlueprintValue(node.step).teamRule === 'none'
        ? null
        : requireBlueprintValue(node.step).teamRule === 'creation_team'
          ? context.creationTeamId
          : (parent.teamId ?? context.creationTeamId);
  if (node.kind === 'task' && team === null)
    throw new BlueprintError(
      'blueprint_destination_required',
      'Choose an authorized creation team for the required Task team.',
      [node.path],
    );
  return team;
}
function nearestCycle(parent: PlannedWorkNode, nodes: readonly PlannedWorkNode[]): CycleId | null {
  let ancestor: PlannedWorkNode | undefined = parent;
  while (ancestor) {
    if (ancestor.kind === 'task' && ancestor.cycleId) return ancestor.cycleId;
    const parentPath: PlannedWorkNode['parentPath'] = ancestor.parentPath;
    ancestor =
      parentPath === null
        ? undefined
        : nodes.find((node) => pathKey(node.path) === pathKey(parentPath));
  }
  return null;
}
function validCycle(id: CycleId, team: TeamId | null, context: BlueprintCreationContext): boolean {
  return context.cycles.some(
    (cycle) =>
      cycle.id === id &&
      cycle.organizationId === context.organizationId &&
      cycle.teamId === team &&
      !cycle.archived &&
      !cycle.closed,
  );
}
interface CycleResolution {
  readonly node: ExpandedBlueprintNode;
  readonly parent: PlannedWorkNode;
  readonly nodes: readonly PlannedWorkNode[];
  readonly team: TeamId | null;
  readonly context: BlueprintCreationContext;
  readonly warnings: BlueprintWarning[];
  readonly override: BlueprintNodeOverride | undefined;
}
function currentCycle(input: CycleResolution): CycleId | null {
  const { node, team, context, warnings } = input;
  const date = context.runDate ?? context.creationDate;
  const cycles = context.cycles.filter(
    (cycle) =>
      cycle.organizationId === context.organizationId &&
      cycle.teamId === team &&
      !cycle.archived &&
      !cycle.closed &&
      cycle.startDate <= date &&
      cycle.endDate >= date,
  );
  if (cycles.length > 1)
    throw new BlueprintError(
      'blueprint_invalid',
      'Multiple current cycle windows match the selected Task team.',
      [node.path],
    );
  return cycles[0]?.id ?? warn(warnings, 'cycle_unavailable', node);
}
function resolveCycle(input: CycleResolution): CycleId | null {
  const { node, parent, nodes, team, context, warnings, override } = input;
  if (node.step?.kind !== 'task') return null;
  if (override?.cycleId !== undefined) {
    if (override.cycleId !== null && !validCycle(override.cycleId, team, context))
      throw new BlueprintError(
        'blueprint_invalid',
        'Explicit cycle is unavailable for the selected team.',
        [node.path],
      );
    return override.cycleId;
  }
  if (node.step.cycleRule === 'none') return null;
  if (node.step.cycleRule === 'current_cycle') return currentCycle(input);
  const inherited = nearestCycle(parent, nodes);
  return inherited && validCycle(inherited, team, context)
    ? inherited
    : warn(warnings, 'cycle_unavailable', node);
}
function definedFields(fields: ResolvedBlueprintFields): ResolvedBlueprintFields {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}
function templateStartingFields(node: ExpandedBlueprintNode): BlueprintFields {
  const { targetType: _kind, ...defaults } = node.definition?.payload ?? { targetType: node.kind };
  const status = node.definition?.defaultStatusKey;
  return status ? { ...defaults, [node.kind === 'task' ? 'state' : 'status']: status } : defaults;
}
function startingFields(
  node: ExpandedBlueprintNode,
  override?: BlueprintNodeOverride,
): ResolvedBlueprintFields {
  const defaults = templateStartingFields(node);
  const authored = definedFields(requireBlueprintValue(node.step).fields);
  // A step's authored single-line values win. Its document appends to the referenced outline once.
  const merged =
    node.step?.template === null
      ? { ...defaults, ...authored }
      : {
          ...defaults,
          ...authored,
          ...templateMerge<Record<string, unknown>>(defaults, authored, {
            document: 'description',
          }),
        };
  if (!override?.fields) return merged;
  const explicit = definedFields(override.fields);
  const patch = override.documentPrepared
    ? explicit
    : templateMerge<Record<string, unknown>>(merged, explicit, { document: 'description' });
  return { ...merged, ...patch };
}
function inheritedPlacement(parent: PlannedWorkNode): PlannedWorkNode['placement'] {
  // Generated references are allocated by parentPath; inherited existing destination IDs stay literal only here.
  return parent.placement;
}
interface PlanState {
  readonly input: ResolvedBlueprintInput;
  readonly expanded: ReturnType<typeof expandBlueprint>;
  readonly nodes: Map<string, PlannedWorkNode>;
  readonly active: Set<string>;
  readonly warnings: BlueprintWarning[];
}
function resolveDates(
  state: PlanState,
  node: ExpandedBlueprintNode,
  parent: PlannedWorkNode,
  override?: BlueprintNodeOverride,
): Pick<PlannedWorkNode, 'dates' | 'dateBindings' | 'unresolvedReasons'> {
  const dates: Partial<Record<BlueprintDateField, string | null>> = {};
  const dateBindings: PlannedWorkNode['dateBindings'] = {};
  const unresolvedReasons: Partial<
    Record<BlueprintDateField, 'missing_anchor' | 'waiting_completion'>
  > = {};
  for (const [fieldName, rule] of Object.entries(requireBlueprintValue(node.step).dates)) {
    if (!rule) continue;
    const field = fieldName as BlueprintDateField;
    const milestoneAnchors: Record<string, string | null> = {};
    if (rule.kind === 'anchor' && rule.anchor.kind === 'milestone') {
      const path = [...node.scopePath, rule.anchor.stepKey];
      const milestone = planNode(state, pathKey(path));
      milestoneAnchors[rule.anchor.stepKey] = blueprintAnchor(
        milestone.kind,
        milestone.dates,
        state.input.context.creationDate,
      );
    }
    const derived = deriveBlueprintDate({
      rule,
      parentAnchor: blueprintAnchor(parent.kind, parent.dates, state.input.context.creationDate),
      milestoneAnchors,
      scopePath: node.scopePath,
      ...state.input.context,
    });
    dates[field] = derived.value;
    const explicit = override?.dates?.[field];
    if (explicit !== undefined) dates[field] = explicit;
    else if (derived.unresolvedReason) {
      unresolvedReasons[field] = derived.unresolvedReason;
      warn(state.warnings, derived.unresolvedReason, node);
    }
    dateBindings[field] = {
      sourceStepId: requireBlueprintValue(node.sourceStepId),
      sourceVersionId: requireBlueprintValue(node.sourceVersionId),
      rule,
      manual: explicit !== undefined,
      lastDerivedDate: derived.value,
    };
  }
  for (const [field, value] of Object.entries(override?.dates ?? {}))
    dates[field as BlueprintDateField] = value;
  assertBlueprintDateWindow(node.kind, dates);
  return { dates, dateBindings, unresolvedReasons };
}
function adoptedNode(
  input: ResolvedBlueprintInput,
  node: ExpandedBlueprintNode,
  placement: PlannedWorkNode['placement'],
): PlannedWorkNode | undefined {
  const existing = input.context.existingNodes?.find(
    (entry) => pathKey(entry.path) === pathKey(node.path),
  );
  if (!existing) return undefined;
  if (existing.kind !== node.kind)
    throw new BlueprintError(
      'blueprint_invalid',
      'Existing work kind differs from its retained path.',
      [node.path],
    );
  return {
    ...node,
    fields: existing.fields,
    teamId: existing.teamId,
    responsibleActorId: existing.responsibleActorId,
    cycleId: existing.cycleId,
    dates: existing.dates,
    dateBindings: existing.dateBindings,
    unresolvedReasons: {},
    placement,
  };
}
function planNode(state: PlanState, key: string): PlannedWorkNode {
  const resolved = state.nodes.get(key);
  if (resolved) return resolved;
  if (state.active.has(key))
    throw new BlueprintError('blueprint_loop', 'Blueprint date prerequisite cycle.');
  const node = state.expanded.nodes.find((entry) => pathKey(entry.path) === key && entry.selected);
  if (node?.parentPath === null || !node)
    throw new BlueprintError('blueprint_invalid', 'Missing selected blueprint parent.');
  state.active.add(key);
  const parent = planNode(state, pathKey(node.parentPath));
  const adopted = adoptedNode(state.input, node, inheritedPlacement(parent));
  if (adopted) {
    state.active.delete(key);
    state.nodes.set(key, adopted);
    return adopted;
  }
  const override = state.input.context.overrides?.find((entry) => pathKey(entry.path) === key);
  const context = state.input.context;
  const teamId = resolveTeam(node, parent, context, override);
  let responsibleActorId = resolveActor(node, parent, context, state.warnings);
  if (override?.responsibleActorId !== undefined) {
    if (override.responsibleActorId !== null && !activeActor(override.responsibleActorId, context))
      throw new BlueprintError('blueprint_invalid', 'Explicit responsible actor is unavailable.', [
        node.path,
      ]);
    responsibleActorId = override.responsibleActorId;
  }
  const cycleId = resolveCycle({
    node,
    parent,
    nodes: [...state.nodes.values()],
    team: teamId,
    context,
    warnings: state.warnings,
    override,
  });
  const planned: PlannedWorkNode = {
    ...node,
    fields: startingFields(node, override),
    teamId,
    responsibleActorId,
    cycleId,
    ...resolveDates(state, node, parent, override),
    placement: inheritedPlacement(parent),
  };
  state.active.delete(key);
  state.nodes.set(key, planned);
  return planned;
}
function planRoot(
  input: ResolvedBlueprintInput,
  expanded: ReturnType<typeof expandBlueprint>,
): PlannedWorkNode {
  const rootNode = requireBlueprintValue(expanded.nodes[0]);
  const adopted = adoptedNode(input, rootNode, input.root.placement ?? {});
  if (adopted) return adopted;
  const { targetType: _kind, ...defaults } = input.graph.root.definition.payload;
  const rootDates = resolvedRootDates(input);
  const root: PlannedWorkNode = {
    ...rootNode,
    fields: { ...defaults, ...definedFields(input.root.fields) },
    teamId:
      input.root.teamId ?? (input.root.kind === 'program' ? input.context.creationTeamId : null),
    responsibleActorId: input.root.responsibleActorId,
    cycleId: input.root.cycleId,
    dates: rootDates,
    dateBindings: {},
    unresolvedReasons: {},
    placement: input.root.placement ?? {},
  };
  if (root.kind === 'task' && root.teamId === null)
    throw new BlueprintError(
      'blueprint_destination_required',
      'Choose an authorized creation team for the required Task team.',
      [[]],
    );
  return root;
}

function resolvedRootDates(input: ResolvedBlueprintInput): PlannedWorkNode['dates'] {
  const dates = { ...input.root.dates };
  if (input.context.runDate && input.root.kind !== 'initiative' && input.root.kind !== 'program')
    dates[input.root.kind === 'task' ? 'dueDate' : 'targetDate'] = input.context.runDate;
  const override = input.context.overrides?.find((entry) => entry.path.length === 0);
  Object.assign(dates, override?.dates);
  assertBlueprintDateWindow(input.root.kind, dates);
  return dates;
}
/**
 * Plan selected descendants from authorized immutable snapshots, without clocks, IDs or effects.
 * @throws For invalid or ambiguous resolved snapshots, graph limits, or calendar inputs.
 */
export function planBlueprint(input: ResolvedBlueprintInput): PlannedWorkTree {
  if (
    input.root.kind !== input.graph.root.kind ||
    input.context.organizationId !== input.graph.root.organizationId
  )
    throw new BlueprintError('blueprint_invalid', 'Root kind or workspace mismatch.');
  BlueprintCivilDate.parse(input.context.runDate ?? input.context.creationDate);
  WorkingWeekdays.parse(input.context.workingWeekdays);
  const existing = input.context.existingNodes ?? [];
  if (new Set(existing.map((node) => pathKey(node.path))).size !== existing.length)
    throw new BlueprintError('blueprint_invalid', 'Existing retained paths must be unique.');
  const expanded = expandBlueprint(input.graph, input.choices);
  const root = planRoot(input, expanded);
  const state: PlanState = {
    input,
    expanded,
    nodes: new Map([[pathKey([]), root]]),
    active: new Set(),
    warnings: [],
  };
  const nodes = expanded.nodes
    .filter((node) => node.selected)
    .map((node) => planNode(state, pathKey(node.path)));
  const selected = new Set(nodes.map((node) => pathKey(node.path)));
  return {
    nodes,
    dependencies: expanded.dependencies.filter(
      (edge) => selected.has(pathKey(edge.blockerPath)) && selected.has(pathKey(edge.blockedPath)),
    ),
    manifest: expanded.manifest.filter((entry) => selected.has(pathKey(entry.path))),
    warnings: aggregateBlueprintWarnings(state.warnings),
    fingerprint: input.graph.fingerprint,
  };
}
