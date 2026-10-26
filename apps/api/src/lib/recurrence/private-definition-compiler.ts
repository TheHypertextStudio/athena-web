import { WorkTypeId, WorkTypeVersionId } from '@docket/work/ids';
import {
  CanonicalPrivateWorkDefinition,
  privateScheduleRootFromPreset,
  privateScheduleStepFromPreset,
} from '@docket/work/work-private-definition';
import { translateLegacyScheduleFieldTiming } from '@docket/work/schedule-legacy-timing';
import type { LegacyScheduleSourceMapping } from '@docket/work/work-schedule-import';
import type { WorkScheduleTimingRef } from '@docket/work/work-schedule-field-timing';
import type { PrivateScheduleRootPlacement } from '@docket/work/work-schedule-forest-v2';
import type { ProcessDefinitionCreate } from '../../contracts/recurrence';
import { ConflictError } from '../../error';
import { compilePrivateDefinitionSources } from './private-definition-source';
import type { RecurrenceBlueprintSource } from './work-template-source';

/** Exact immutable root publication returned by the owning current-access publication service. */
export interface PrivateDefinitionRootPublication {
  readonly workTypeId: string;
  readonly workTypeVersionId: string;
}
/** Server-allocated aliases and actual publication descriptions; compilation alone grants no execution. */
export interface CompileAuthoredPrivateDefinition {
  readonly definitionAlias: string;
  readonly revisionAlias: string;
  readonly definition: ProcessDefinitionCreate;
  readonly aliases: ReadonlyMap<string, string>;
  readonly publications: ReadonlyMap<string, PrivateDefinitionRootPublication>;
}
function requireSource(
  sources: readonly RecurrenceBlueprintSource[],
  id: string,
): RecurrenceBlueprintSource {
  const source = sources.find((entry) => entry.id === id);
  if (!source) throw new ConflictError('Private authored containment is unavailable.');
  return source;
}
/**
 * Blueprint path of an authored step: every step beneath a root is in that root's single template
 * scope, so its path is its own key. Containment is carried by the step's parent, not its path.
 */
function reference(
  source: RecurrenceBlueprintSource,
  sources: readonly RecurrenceBlueprintSource[],
): WorkScheduleTimingRef {
  const root = requireSource(sources, source.rootId);
  return { rootKey: root.key, path: source.id === root.id ? [] : [source.key] };
}
function placements(
  sources: readonly RecurrenceBlueprintSource[],
  mappings: readonly LegacyScheduleSourceMapping[],
): PrivateScheduleRootPlacement[] {
  return sources
    .filter((source) => source.id === source.rootId && source.kind === 'task')
    .flatMap((source) => {
      const result: PrivateScheduleRootPlacement = { rootKey: source.key };
      for (const [column, field] of [
        ['project_step_id', 'project'],
        ['milestone_step_id', 'milestone'],
        ['parent_task_step_id', 'parentTask'],
      ] as const) {
        const alias = source.preset.fields[column];
        if (typeof alias !== 'string') continue;
        const parent = mappings.find((mapping) => mapping.alias === alias);
        if (!parent) throw new ConflictError('Private authored containment is unavailable.');
        result[field] = parent.reference;
      }
      return result.project || result.milestone || result.parentTask ? [result] : [];
    });
}
function absentFields(
  mappings: readonly LegacyScheduleSourceMapping[],
  timing: CanonicalPrivateWorkDefinition['timing'],
): CanonicalPrivateWorkDefinition['absentFields'] {
  const managed = new Set(timing.rules.map((rule) => JSON.stringify(rule.target)));
  return mappings.flatMap((mapping) => {
    const fields =
      mapping.kind === 'task'
        ? (['startDate', 'dueDate'] as const)
        : mapping.kind === 'project'
          ? (['startDate', 'targetDate'] as const)
          : (['targetDate'] as const);
    return fields
      .map((field) => ({ ...mapping.reference, field }))
      .filter((target) => !managed.has(JSON.stringify(target)));
  });
}
function roots(
  input: CompileAuthoredPrivateDefinition,
  sources: readonly RecurrenceBlueprintSource[],
): CanonicalPrivateWorkDefinition['roots'] {
  return sources
    .filter((source) => source.id === source.rootId)
    .map((source) => {
      const publication = input.publications.get(source.id);
      if (!publication || source.kind === 'milestone')
        throw new ConflictError('Private root publication is unavailable.');
      return {
        key: source.key,
        template: {
          targetType: source.kind,
          workTypeId: WorkTypeId.parse(publication.workTypeId),
          selection: {
            kind: 'pinned' as const,
            workTypeVersionId: WorkTypeVersionId.parse(publication.workTypeVersionId),
          },
        },
        root: privateScheduleRootFromPreset(source.preset),
        stepOverrides: sources
          .filter((child) => child.rootId === source.id && child.id !== source.id)
          .map((child) =>
            privateScheduleStepFromPreset(child.preset, reference(child, sources).path),
          ),
        optionalChoices: [],
      };
    });
}
/**
 * Compile strictly validated authored DTO and server publication facts without normalized source IDs or SQL.
 * The timezone-neutral payload preserves exact authored readback; current selection and activation are checked later.
 * @throws For incomplete aliases/publications, invalid containment or unsupported field/date policy.
 */
export function compileAuthoredPrivateDefinition(
  input: CompileAuthoredPrivateDefinition,
): CanonicalPrivateWorkDefinition {
  const sources = compilePrivateDefinitionSources(input.definition, input.aliases);
  const sourceMappings: LegacyScheduleSourceMapping[] = sources.map((source) => ({
    alias: source.id,
    sourceKey: source.sourceKey,
    reference: reference(source, sources),
    kind: source.kind,
    sort: source.sort,
  }));
  const byAlias = new Map(sources.map((source) => [source.id, source]));
  const steps = sources.map((source) => {
    const preset = source.preset;
    const timing =
      preset.timing.kind === 'on_trigger'
        ? { kind: 'on_trigger' as const }
        : preset.timing.kind === 'relative_to_trigger'
          ? { kind: 'relative_to_trigger' as const, offsetDays: preset.timing.offsetDays ?? 0 }
          : {
              kind: 'after_step_completion' as const,
              stepKey: requireSource(sources, preset.timing.afterStepId ?? '').sourceKey,
              offsetDays: preset.timing.offsetDays ?? 0,
            };
    return {
      key: source.sourceKey,
      kind: source.kind,
      timing,
      fieldOverrides: preset.fields,
      dependsOn: input.definition.dependencies
        .filter((edge) => edge.blockedStepKey === source.sourceKey)
        .map((edge) => edge.blockingStepKey),
    };
  });
  const timing = translateLegacyScheduleFieldTiming({ steps, sourceMappings });
  const mapping = (key: string): WorkScheduleTimingRef => {
    const mapped = sourceMappings.find((entry) => entry.sourceKey === key);
    if (!mapped) throw new ConflictError('Private authored dependency is unavailable.');
    return mapped.reference;
  };
  const authoringBody: unknown = JSON.parse(JSON.stringify(input.definition));
  return CanonicalPrivateWorkDefinition.parse({
    kind: 'private_definition',
    revision: 1,
    state: 'published',
    creationMode: input.definition.creationMode,
    roots: roots(input, sources),
    sourceMappings,
    dependencies: input.definition.dependencies.map((edge) => ({
      blocker: mapping(edge.blockingStepKey),
      blocked: mapping(edge.blockedStepKey),
    })),
    timing,
    absentFields: absentFields(sourceMappings, timing),
    titlePolicy: { kind: 'legacy_title', revision: 1 },
    titles: sourceMappings.map((entry) => ({
      target: entry.reference,
      kind: entry.kind,
      pattern: byAlias.get(entry.alias)?.preset.fields[entry.kind === 'task' ? 'title' : 'name'],
    })),
    completionPolicy: {
      kind: 'legacy_authored_tasks',
      revision: 1,
      tasks: sourceMappings
        .filter((entry) => entry.kind === 'task')
        .map((entry) => entry.reference),
    },
    placements: placements(sources, sourceMappings),
    authoring: {
      kind: 'process_definition',
      revision: 1,
      definitionAlias: input.definitionAlias,
      revisionAlias: input.revisionAlias,
      definition: authoringBody,
    },
  });
}
