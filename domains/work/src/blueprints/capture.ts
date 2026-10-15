import { calendarDaysBetween } from '../calendar-date';
import {
  BlueprintStep,
  type BlueprintDateRule,
  type StepKey,
} from '../contracts/work-template-blueprint';
import { WorkTemplateDefinition } from '../contracts/work-template';
import { blueprintAnchor } from './dates';
import { BlueprintError, requireBlueprintValue } from './errors';
import { assertAcyclic, assertBlueprintHierarchy } from './graph';
import { aggregateBlueprintWarnings } from './rules';
import { existingParent, existingNodeAtPath } from './snapshot';
import type {
  BlueprintDateField,
  BlueprintWarning,
  CapturableWorkTree,
  CapturedTemplateDraft,
  ExistingBlueprintNode,
  ResolvedBlueprintFields,
} from './types';

interface CaptureState {
  readonly input: CapturableWorkTree;
  readonly nodes: readonly ExistingBlueprintNode[];
  readonly keys: ReadonlyMap<string, StepKey>;
  readonly warnings: BlueprintWarning[];
}
function reusableFields(fields: ResolvedBlueprintFields): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([key, value]) => key !== 'health' || value !== null)
      .map(([key, value]) => [key, key === 'summary' && value === null ? '' : value]),
  );
}
function warning(
  state: CaptureState,
  code: BlueprintWarning['code'],
  node: ExistingBlueprintNode,
): void {
  const key = state.keys.get(node.id);
  state.warnings.push({ code, paths: [key ? [key] : []], count: 1 });
}
function actorRule(
  state: CaptureState,
  node: ExistingBlueprintNode,
  parent: ExistingBlueprintNode,
): BlueprintStep['actorRule'] {
  if (node.responsibleActorId === null) return 'unassigned';
  if (node.responsibleActorId === parent.responsibleActorId) return 'parent_responsible';
  if (node.responsibleActorId === state.input.context.initiatingActorId) return 'creator';
  if (node.responsibleActorId === state.input.context.athenaActorId) return 'athena';
  warning(state, 'capture_actor', node);
  return 'unassigned';
}
function teamRule(
  state: CaptureState,
  node: ExistingBlueprintNode,
  parent: ExistingBlueprintNode,
): BlueprintStep['teamRule'] {
  if (node.teamId === parent.teamId && node.teamId !== null) return 'parent_team';
  if (node.teamId === state.input.context.creationTeamId && node.teamId !== null)
    return 'creation_team';
  if (node.teamId !== null) warning(state, 'capture_team', node);
  return 'none';
}
function cycleRule(
  state: CaptureState,
  node: ExistingBlueprintNode,
  parent: ExistingBlueprintNode,
): 'none' | 'parent_cycle' | 'current_cycle' {
  if (node.cycleId === null) return 'none';
  let ancestor: ExistingBlueprintNode | undefined = parent;
  while (ancestor) {
    if (ancestor.kind === 'task' && ancestor.cycleId === node.cycleId) return 'parent_cycle';
    ancestor = existingParent(ancestor, [state.input.root, ...state.nodes]);
  }
  const date = state.input.context.runDate ?? state.input.context.creationDate;
  const cycle = state.input.context.cycles.find(
    (entry) =>
      entry.id === node.cycleId &&
      entry.organizationId === state.input.context.organizationId &&
      entry.teamId === node.teamId &&
      !entry.archived &&
      !entry.closed &&
      entry.startDate <= date &&
      entry.endDate >= date,
  );
  if (cycle) return 'current_cycle';
  warning(state, 'capture_cycle', node);
  return 'none';
}
function capturedDates(
  state: CaptureState,
  node: ExistingBlueprintNode,
  parent: ExistingBlueprintNode,
): Partial<Record<BlueprintDateField, BlueprintDateRule>> {
  const dates: Partial<Record<BlueprintDateField, BlueprintDateRule>> = {};
  const anchor = blueprintAnchor(parent.kind, parent.dates, state.input.context.creationDate);
  for (const [field, date] of Object.entries(node.dates)) {
    if (!date) continue;
    if (!anchor) {
      warning(state, 'missing_anchor', node);
      continue;
    }
    dates[field as BlueprintDateField] = {
      kind: 'anchor',
      anchor: { kind: 'parent' },
      offset: { days: calendarDaysBetween(anchor, date), unit: 'calendar' },
    };
  }
  return dates;
}
function captureStep(
  state: CaptureState,
  node: ExistingBlueprintNode,
  sort: number,
): BlueprintStep {
  const parent = existingParent(node, [state.input.root, ...state.nodes]);
  if (!parent)
    throw new BlueprintError(
      'blueprint_incomplete_capture',
      'Incomplete capture: a visible child has no authorized parent.',
    );
  assertBlueprintHierarchy(parent.kind, node.kind);
  const common = {
    key: requireBlueprintValue(state.keys.get(node.id)),
    kind: node.kind,
    parentStepKey:
      parent.id === state.input.root.id ? null : requireBlueprintValue(state.keys.get(parent.id)),
    sort,
    optional: { enabled: false, selectedByDefault: true },
    template: null,
    fields: reusableFields(node.fields),
    teamRule: teamRule(state, node, parent),
    actorRule: actorRule(state, node, parent),
    dates: capturedDates(state, node, parent),
  };
  return BlueprintStep.parse(
    node.kind === 'task' ? { ...common, cycleRule: cycleRule(state, node, parent) } : common,
  );
}
function validDependency(
  state: CaptureState,
  blocker: ExistingBlueprintNode | undefined,
  blocked: ExistingBlueprintNode | undefined,
): boolean {
  const nodes = [state.input.root, ...state.nodes];
  return (
    blocker?.kind === 'task' &&
    blocked?.kind === 'task' &&
    existingParent(blocker, nodes)?.id === existingParent(blocked, nodes)?.id &&
    blocker.id !== blocked.id
  );
}
function captureDependencies(
  state: CaptureState,
): WorkTemplateDefinition['blueprint']['dependencies'] {
  const dependencies: WorkTemplateDefinition['blueprint']['dependencies'] = [];
  const seen = new Set<string>();
  for (const edge of state.input.dependencies) {
    const blocker =
      'blockerId' in edge
        ? state.nodes.find((node) => node.id === edge.blockerId)
        : existingNodeAtPath(state.nodes, edge.blockerPath);
    const blocked =
      'blockedId' in edge
        ? state.nodes.find((node) => node.id === edge.blockedId)
        : existingNodeAtPath(state.nodes, edge.blockedPath);
    if (!validDependency(state, blocker, blocked)) {
      warning(state, 'capture_dependency', blocker ?? blocked ?? state.input.root);
      continue;
    }
    const dependency = {
      blockerStepKey: requireBlueprintValue(state.keys.get(requireBlueprintValue(blocker).id)),
      blockedStepKey: requireBlueprintValue(state.keys.get(requireBlueprintValue(blocked).id)),
    };
    const key = JSON.stringify(dependency);
    if (!seen.has(key)) dependencies.push(dependency);
    seen.add(key);
  }
  return dependencies;
}
/**
 * Capture authorized current work as an independent inline draft, removing location-specific references.
 * @throws For invalid or ambiguous resolved snapshots, graph limits, or calendar inputs.
 */
export function captureBlueprint(input: CapturableWorkTree): CapturedTemplateDraft {
  if (!input.complete)
    throw new BlueprintError(
      'blueprint_incomplete_capture',
      'Incomplete capture: authorized descendants do not cover the source tree.',
    );
  const nodes = input.nodes.filter((node) => node.id !== input.root.id);
  if (nodes.length > 499)
    throw new BlueprintError('blueprint_limit', 'Capture limit is 499 descendants.');
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length)
    throw new BlueprintError(
      'blueprint_incomplete_capture',
      'Incomplete capture: duplicate source nodes.',
    );
  const containment = new Map(
    nodes.map((node) => [
      node.id,
      [existingParent(node, [input.root, ...nodes])?.id ?? input.root.id],
    ]),
  );
  assertAcyclic(containment);
  const keys = new Map(nodes.map((node, index) => [node.id, `step_${index + 1}`]));
  const state: CaptureState = { input, nodes, keys, warnings: [] };
  const steps = nodes.map((node, index) => captureStep(state, node, index));
  const definition = WorkTemplateDefinition.parse({
    name: input.name,
    payload: { targetType: input.root.kind, ...reusableFields(input.root.fields) },
    blueprint: { steps, dependencies: captureDependencies(state) },
  });
  const origin =
    input.root.workTypeId && input.root.workTypeVersionId
      ? { workTypeId: input.root.workTypeId, workTypeVersionId: input.root.workTypeVersionId }
      : null;
  return { definition, origin, warnings: aggregateBlueprintWarnings(state.warnings) };
}
