import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { BlueprintStep } from '@docket/work/work-template-blueprint';
import type { RecurrenceBlueprintSource } from './work-template-source';

function reusableFields(
  source: RecurrenceBlueprintSource,
): Readonly<Record<string, string | number | readonly string[]>> {
  const fields: Record<string, string | number | readonly string[]> = {};
  for (const key of [
    'title',
    'name',
    'priority',
    'state',
    'status',
    'health',
    'estimate',
    'labelIds',
  ]) {
    if (key === 'labelIds' && source.kind !== 'task') continue;
    const value = source.preset.fields[key];
    if (typeof value === 'string' || typeof value === 'number' || Array.isArray(value))
      fields[key] = value;
  }
  const minutes = source.preset.fields['estimate_minutes'];
  if (typeof minutes === 'number') fields['estimateMinutes'] = minutes;
  return fields;
}
/** Construct reusable structure only; private bodies, actor IDs and concrete destinations stay in the invocation. */
export function recurrenceWorkTemplateDefinition(
  name: string,
  root: RecurrenceBlueprintSource,
  sources: readonly RecurrenceBlueprintSource[],
): WorkTemplateDefinition {
  const children = sources.filter((source) => source.rootId === root.id && source.id !== root.id);
  const childIds = new Set(children.map((source) => source.id));
  const steps = children.map((source) =>
    BlueprintStep.parse({
      key: source.key,
      kind: source.kind,
      parentStepKey:
        source.parentId && childIds.has(source.parentId)
          ? children.find((parent) => parent.id === source.parentId)?.key
          : null,
      sort: source.sort,
      optional: { enabled: false, selectedByDefault: true },
      template: null,
      fields: reusableFields(source),
      teamRule: 'creation_team',
      actorRule: 'unassigned',
      ...(source.kind === 'task' ? { cycleRule: 'none' } : {}),
      dates: {},
    }),
  );
  return WorkTemplateDefinition.parse({
    name: `${name} (${root.key})`,
    payload: { targetType: root.kind, ...reusableFields(root) },
    blueprint: { steps, dependencies: [] },
  });
}
