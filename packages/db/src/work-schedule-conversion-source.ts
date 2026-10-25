import {
  LegacyScheduleImportInput,
  type LegacyScheduleSourceEvidence,
} from '@docket/work/work-schedule-import';
import {
  privateScheduleRootFromPreset,
  privateScheduleStepFromPreset,
} from '@docket/work/work-private-definition';
import type { WorkScheduleTimingRef } from '@docket/work/work-schedule-field-timing';
import type { BlueprintInvocationOverride, BlueprintInvocationStep } from './blueprint-invocation';
import type { ScheduleArchiveSource } from './work-schedule-archive-source';
import { ScheduleSourceProofError } from './work-schedule-archive-source';

function root(entry: BlueprintInvocationOverride) {
  try {
    return privateScheduleRootFromPreset(entry);
  } catch {
    throw new ScheduleSourceProofError('invalid_structure');
  }
}
function override(entry: BlueprintInvocationOverride, step: BlueprintInvocationStep) {
  try {
    return privateScheduleStepFromPreset(entry, step.path);
  } catch {
    throw new ScheduleSourceProofError('invalid_structure');
  }
}
function originalSteps(source: ScheduleArchiveSource): Record<string, unknown>[] {
  const steps = source.source['steps'];
  if (!Array.isArray(steps) || steps.some((step) => !step || typeof step !== 'object'))
    throw new ScheduleSourceProofError('invalid_structure');
  return steps as Record<string, unknown>[];
}
function sourceTiming(
  entry: BlueprintInvocationOverride,
  keys: ReadonlyMap<string, string>,
): LegacyScheduleImportInput['steps'][number]['timing'] {
  if (entry.timing.kind === 'on_trigger') return { kind: 'on_trigger' };
  if (entry.timing.kind === 'relative_to_trigger')
    return { kind: 'relative_to_trigger', offsetDays: entry.timing.offsetDays ?? 0 };
  const stepKey = keys.get(entry.timing.afterStepId ?? '');
  if (!stepKey) throw new ScheduleSourceProofError('invalid_structure');
  return { kind: 'after_step_completion', stepKey, offsetDays: entry.timing.offsetDays ?? 0 };
}
/**
 * Project already-proved immutable source into pure private compiler input, preserving aliases and raw evidence.
 * This transformation grants no execution, actual-work adoption, publication or timezone authority.
 * @throws For incomplete mappings or a source shape outside the existing private root validators.
 */
export function compileScheduleConversionInput(
  source: ScheduleArchiveSource,
  evidence: LegacyScheduleSourceEvidence,
  selectedWork: LegacyScheduleImportInput['selectedWork'],
  references: ReadonlyMap<string, WorkScheduleTimingRef>,
): LegacyScheduleImportInput {
  const originals = [...originalSteps(source)].sort(
    (a, b) =>
      Number(a['sort']) - Number(b['sort']) || String(a['id']).localeCompare(String(b['id'])),
  );
  const keys = new Map(originals.map((step) => [String(step['id']), String(step['key'])]));
  const presets = new Map(source.overrides.map((entry) => [entry.sourceStepId, entry]));
  const mappings = new Map(source.manifest.steps.map((step) => [step.sourceStepId, step]));
  const required = <T>(value: T | undefined): T => {
    if (value === undefined) throw new ScheduleSourceProofError('invalid_structure');
    return value;
  };
  const parsed = LegacyScheduleImportInput.safeParse({
    source: evidence,
    sourceBody: source.source,
    state: source.manifest.kind,
    creationMode: source.revisionAudit['creation_mode'],
    roots: source.manifest.roots.map((entry) => ({
      key: entry.key,
      template:
        entry.workTypeId && entry.workTypeVersionId
          ? {
              targetType: entry.kind,
              workTypeId: entry.workTypeId,
              selection: { kind: 'pinned', workTypeVersionId: entry.workTypeVersionId },
            }
          : null,
      root: root(required(presets.get(entry.sourceStepId))),
      stepOverrides: source.manifest.steps
        .filter((step) => step.rootKey === entry.key && step.path.length)
        .map((step) =>
          override(required(presets.get(step.sourceStepId)), {
            ...step,
            path: required(references.get(step.sourceStepId)).path,
          }),
        ),
      optionalChoices: [],
    })),
    sourceMappings: originals.map((original) => {
      const step = required(mappings.get(String(original['id'])));
      return {
        alias: step.sourceStepId,
        sourceKey: step.sourceKey,
        reference: required(references.get(step.sourceStepId)),
        kind: required(presets.get(step.sourceStepId)).kind,
        sort: original['sort'],
      };
    }),
    steps: originals.map((original) => {
      const entry = required(presets.get(String(original['id'])));
      return {
        key: original['key'],
        kind: entry.kind,
        timing: sourceTiming(entry, keys),
        fieldOverrides: entry.fields,
        dependsOn: source.manifest.dependencies
          .filter((edge) => edge.blockedStepId === entry.sourceStepId)
          .map((edge) => required(keys.get(edge.blockerStepId))),
      };
    }),
    selectedWork,
  });
  if (!parsed.success) throw new ScheduleSourceProofError('invalid_structure');
  return parsed.data;
}
