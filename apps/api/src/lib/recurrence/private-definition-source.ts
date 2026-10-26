import type { ProcessDefinitionCreate, ProcessStepTiming } from '../../contracts/recurrence';
import { ConflictError } from '../../error';
import { canonicalSourceKey, privateDefinitionFields } from './private-definition-source-fields';
import type { RecurrenceBlueprintSource } from './work-template-source';

type Source = Omit<RecurrenceBlueprintSource, 'rootId'>;
function requireAlias(aliases: ReadonlyMap<string, string>, key: string): string {
  const alias = aliases.get(key);
  if (!alias) throw new ConflictError('Private authoring aliases are incomplete.');
  return alias;
}
function selected(source: Source): boolean {
  return (
    source.kind === 'task' &&
    typeof source.preset.fields['work_type_id'] === 'string' &&
    typeof source.preset.fields['work_type_version_id'] === 'string'
  );
}
function rootFor(id: string, sources: ReadonlyMap<string, Source>, visiting: Set<string>): string {
  const source = sources.get(id);
  if (!source || visiting.has(id))
    throw new ConflictError('Private authoring hierarchy is invalid.');
  if (!source.parentId || selected(source)) return id;
  visiting.add(id);
  const root = rootFor(source.parentId, sources, visiting);
  visiting.delete(id);
  const parent = sources.get(root);
  if (!parent) throw new ConflictError('Private authoring hierarchy is invalid.');
  return selected(parent) ? id : root;
}
function timing(
  value: ProcessStepTiming,
  aliases: ReadonlyMap<string, string>,
): Source['preset']['timing'] {
  if (value.kind === 'on_trigger') return { kind: value.kind, offsetDays: null, afterStepId: null };
  return {
    kind: value.kind,
    offsetDays: value.offsetDays,
    afterStepId:
      value.kind === 'after_step_completion' ? requireAlias(aliases, value.stepKey) : null,
  };
}
interface AuthoredStep {
  readonly kind: Source['kind'];
  readonly sort: number;
  readonly value:
    | NonNullable<ProcessDefinitionCreate['project']>
    | ProcessDefinitionCreate['milestones'][number]
    | ProcessDefinitionCreate['tasks'][number];
}
function steps(definition: ProcessDefinitionCreate): AuthoredStep[] {
  return [
    ...(definition.project
      ? [{ kind: 'project' as const, sort: 0, value: definition.project }]
      : []),
    ...definition.milestones.map((value) => ({
      kind: 'milestone' as const,
      sort: value.sort,
      value,
    })),
    ...definition.tasks.map((value, sort) => ({ kind: 'task' as const, sort, value })),
  ];
}
function source(step: AuthoredStep, aliases: ReadonlyMap<string, string>): Source {
  const value = step.value;
  const body: Readonly<Record<string, unknown>> = value;
  const labelIds = 'labelIds' in value ? (value.labelIds ?? []) : undefined;
  // Prepared authoring already resolved template defaults, so an empty list means no labels and
  // must not fall back to the selected template's default labels.
  const fields: Record<string, string | number | readonly string[] | null> = {
    ...privateDefinitionFields(value, labelIds ?? []),
    ...(labelIds ? { labelIds } : {}),
  };
  for (const [key, column] of [
    ['projectKey', 'project_step_id'],
    ['milestoneKey', 'milestone_step_id'],
    ['parentTaskKey', 'parent_task_step_id'],
  ] as const) {
    const parent = body[key];
    if (typeof parent === 'string') fields[column] = requireAlias(aliases, parent);
  }
  const parentKey = ['parentTaskKey', 'milestoneKey', 'projectKey']
    .map((key) => body[key])
    .find((key): key is string => typeof key === 'string');
  return {
    id: requireAlias(aliases, value.key),
    key: canonicalSourceKey(value.key),
    sourceKey: value.key,
    kind: step.kind,
    sort: step.sort,
    parentId: parentKey ? requireAlias(aliases, parentKey) : null,
    preset: {
      sourceStepId: requireAlias(aliases, value.key),
      kind: step.kind,
      fields,
      timing: timing(value.timing, aliases),
    },
  };
}
/**
 * Compile validated private authoring into stable alias facts without normalized process reads or writes.
 * IDs are allocated by the owning publication service; these descriptions grant no placement or execution rights.
 * @throws For missing/duplicate aliases or cyclic/inconsistent authored containment.
 */
export function compilePrivateDefinitionSources(
  definition: ProcessDefinitionCreate,
  aliases: ReadonlyMap<string, string>,
): readonly RecurrenceBlueprintSource[] {
  const authored = steps(definition);
  if (aliases.size !== authored.length || new Set(aliases.values()).size !== aliases.size)
    throw new ConflictError('Private authoring aliases are incomplete.');
  const sources = authored.map((step) => source(step, aliases)),
    byId = new Map(sources.map((entry) => [entry.id, entry]));
  return sources.map((entry) => ({ ...entry, rootId: rootFor(entry.id, byId, new Set()) }));
}
