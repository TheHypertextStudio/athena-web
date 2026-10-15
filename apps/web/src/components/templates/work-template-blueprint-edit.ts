import {
  BlueprintStep,
  type Blueprint,
  type BlueprintDateRule,
} from '@docket/work/work-template-blueprint';
import type { BlueprintWorkKind } from '@docket/work/blueprints';

/** Child kinds from the ordinary work hierarchy; Milestones are Project checkpoints. */
export function blueprintChildKinds(kind: BlueprintWorkKind): readonly BlueprintStep['kind'][] {
  switch (kind) {
    case 'initiative':
      return ['program', 'project'];
    case 'program':
      return ['project', 'task'];
    case 'project':
      return ['milestone', 'task'];
    case 'milestone':
    case 'task':
      return ['task'];
  }
}
/** Human-facing authored child name, including incomplete drafts. */
export function blueprintStepName(step: BlueprintStep): string {
  return (step.kind === 'task' ? step.fields.title : step.fields.name) || `Unnamed ${step.kind}`;
}
/**
 * Create a named inline child with a stable unused key and ordinary parent rules.
 * @param name - Initial name in the workspace vocabulary, when supplied by an authoring surface.
 */
export function addBlueprintChild(
  blueprint: Blueprint,
  kind: BlueprintStep['kind'],
  parent: string | null,
  name?: string,
): Blueprint {
  const key = `child_${crypto.randomUUID().replaceAll('-', '')}`;
  const siblings = blueprint.steps.filter((step) => step.parentStepKey === parent);
  const sort = Math.max(0, ...siblings.map((step) => step.sort + 1));
  const child = BlueprintStep.parse({
    key,
    kind,
    parentStepKey: parent,
    sort,
    optional: { enabled: false, selectedByDefault: true },
    template: null,
    fields: kind === 'task' ? { title: name ?? 'New task' } : { name: name ?? `New ${kind}` },
    teamRule: 'parent_team',
    actorRule: 'unassigned',
    dates: {},
    ...(kind === 'task' ? { cycleRule: 'none' } : {}),
  });
  return { ...blueprint, steps: [...blueprint.steps, child] };
}
/** Remove a draft subtree and clean every dependency/timing reference to its removed steps. */
export function removeBlueprintChild(blueprint: Blueprint, key: string): Blueprint {
  const removed = new Set([key]);
  let count = 0;
  while (count !== removed.size) {
    count = removed.size;
    for (const step of blueprint.steps)
      if (step.parentStepKey && removed.has(step.parentStepKey)) removed.add(step.key);
  }
  const steps = blueprint.steps
    .filter((step) => !removed.has(step.key))
    .map((step) => {
      const dates = Object.fromEntries(
        Object.entries(step.dates).map(([field, rule]) => {
          if (
            rule?.kind === 'anchor' &&
            rule.anchor.kind === 'milestone' &&
            removed.has(rule.anchor.stepKey)
          )
            return [field, { kind: 'none' }];
          if (rule?.kind === 'after_completion') {
            const keys = rule.stepKeys.filter((value) => !removed.has(value));
            return [field, keys.length ? { ...rule, stepKeys: keys } : { kind: 'none' }];
          }
          return [field, rule];
        }),
      );
      return withBlueprintStepDates(step, dates);
    });
  return {
    steps,
    dependencies: blueprint.dependencies.filter(
      (edge) => !removed.has(edge.blockerStepKey) && !removed.has(edge.blockedStepKey),
    ),
  };
}
/** Reorder siblings without changing stable keys or their authored references. */
export function moveBlueprintChild(
  blueprint: Blueprint,
  key: string,
  direction: -1 | 1,
): Blueprint {
  const current = blueprint.steps.find((step) => step.key === key);
  if (!current) return blueprint;
  const siblings = blueprint.steps
    .filter((step) => step.parentStepKey === current.parentStepKey)
    .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  const index = siblings.findIndex((step) => step.key === key);
  const target = siblings[index + direction];
  if (!target) return blueprint;
  const order = siblings.map((step) => step.key);
  order[index] = target.key;
  order[index + direction] = current.key;
  return {
    ...blueprint,
    steps: blueprint.steps.map((step) => {
      const position = order.indexOf(step.key);
      return position < 0 ? step : { ...step, sort: position };
    }),
  };
}

/** Preserve the discriminated child kind while editing temporarily incomplete field text. */
export function patchBlueprintStepFields(
  step: BlueprintStep,
  patch: Readonly<Record<string, unknown>>,
): BlueprintStep {
  switch (step.kind) {
    case 'task':
      return { ...step, fields: { ...step.fields, ...patch } };
    case 'project':
      return { ...step, fields: { ...step.fields, ...patch } };
    case 'program':
      return { ...step, fields: { ...step.fields, ...patch } };
    case 'milestone':
      return { ...step, fields: { ...step.fields, ...patch } };
  }
}
/** Replace supported relative date fields while preserving the child kind correlation. */
export function withBlueprintStepDates(
  step: BlueprintStep,
  dates: Readonly<
    Partial<Record<'startDate' | 'dueDate' | 'targetDate', BlueprintDateRule | undefined>>
  >,
): BlueprintStep {
  if (step.kind === 'program') return step;
  return { ...step, dates };
}

function retainSiblingDateRule(
  steps: readonly BlueprintStep[],
  step: BlueprintStep,
  rule: BlueprintDateRule | undefined,
): BlueprintDateRule | undefined {
  const siblings = steps.filter(
    (other) => other.key !== step.key && other.parentStepKey === step.parentStepKey,
  );
  if (rule?.kind === 'anchor' && rule.anchor.kind === 'milestone') {
    const anchor = rule.anchor.stepKey;
    return siblings.some((other) => other.kind === 'milestone' && other.key === anchor)
      ? rule
      : { kind: 'none' };
  }
  if (rule?.kind !== 'after_completion') return rule;
  const keys = rule.stepKeys.filter((key) =>
    siblings.some((other) => other.kind === 'task' && other.key === key),
  );
  return keys.length ? { ...rule, stepKeys: keys } : { kind: 'none' };
}
/** Move a draft branch while removing only references that no longer have valid sibling scope. */
export function reparentBlueprintChild(
  blueprint: Blueprint,
  key: string,
  parent: string | null,
): Blueprint {
  const steps = blueprint.steps.map((step) =>
    step.key === key ? { ...step, parentStepKey: parent } : step,
  );
  const byKey = new Map(steps.map((step) => [step.key, step]));
  return {
    steps: steps.map((step) =>
      withBlueprintStepDates(
        step,
        Object.fromEntries(
          Object.entries(step.dates).map(([field, rule]) => [
            field,
            retainSiblingDateRule(steps, step, rule),
          ]),
        ),
      ),
    ),
    dependencies: blueprint.dependencies.filter((edge) => {
      const blocker = byKey.get(edge.blockerStepKey);
      const blocked = byKey.get(edge.blockedStepKey);
      return (
        blocker?.kind === 'task' &&
        blocked?.kind === 'task' &&
        blocker.parentStepKey === blocked.parentStepKey
      );
    }),
  };
}

/** Parent-first authoring order, with stable sibling ordering and visible malformed orphan drafts. */
export function orderedBlueprintChildren(blueprint: Blueprint): BlueprintStep[] {
  const children = (parent: string | null): BlueprintStep[] =>
    blueprint.steps
      .filter((step) => step.parentStepKey === parent)
      .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  const pending = children(null).reverse();
  const ordered: BlueprintStep[] = [];
  const seen = new Set<string>();
  while (pending.length) {
    const step = pending.pop();
    if (!step || seen.has(step.key)) continue;
    seen.add(step.key);
    ordered.push(step);
    pending.push(...children(step.key).reverse());
  }
  return [...ordered, ...blueprint.steps.filter((step) => !seen.has(step.key))];
}

/** One authored parent and its ordered direct descendants, shared by editing and review. */
export interface BlueprintOutlineNode {
  readonly step: BlueprintStep;
  readonly children: BlueprintOutlineNode[];
}

/** Project stable sibling order and parentage while keeping malformed orphan drafts visible. */
export function blueprintOutlineNodes(blueprint: Blueprint): BlueprintOutlineNode[] {
  const roots: BlueprintOutlineNode[] = [];
  const byKey = new Map<string, BlueprintOutlineNode>();
  for (const step of orderedBlueprintChildren(blueprint)) {
    const node: BlueprintOutlineNode = { step, children: [] };
    const parent = step.parentStepKey ? byKey.get(step.parentStepKey) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
    byKey.set(step.key, node);
  }
  return roots;
}
