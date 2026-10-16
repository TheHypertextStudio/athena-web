import {
  CanonicalImportedSchedule,
  LegacyScheduleImportInput,
  type LegacyScheduleImportResult,
  type LegacyScheduleImportDisposition,
  type LegacyScheduleSourceMapping,
} from './contracts/work-schedule-import';
import type {
  WorkScheduleFieldTarget,
  WorkScheduleField,
  WorkScheduleFieldTiming,
} from './contracts/work-schedule-field-timing';
import { scheduleTimingFieldKey } from './schedule-field-timing-types';
import { translateLegacyScheduleFieldTiming } from './schedule-legacy-timing';
import { legacyImportDisposition } from './schedule-import-validation';
function pending(
  source: LegacyScheduleImportInput,
  disposition: LegacyScheduleImportDisposition,
): LegacyScheduleImportResult {
  return {
    kind: 'nonexecuting_import',
    pending: { kind: 'pending_private_definition', revision: 1, disposition, source },
  };
}
function absentFields(
  mappings: readonly LegacyScheduleSourceMapping[],
  timing: WorkScheduleFieldTiming,
): WorkScheduleFieldTarget[] {
  const managed = new Set(timing.rules.map((rule) => scheduleTimingFieldKey(rule.target)));
  return mappings.flatMap((mapping) => {
    const fields: readonly WorkScheduleField[] =
      mapping.kind === 'task'
        ? ['startDate', 'dueDate']
        : mapping.kind === 'project'
          ? ['startDate', 'targetDate']
          : ['targetDate'];
    return fields
      .map((field) => ({ ...mapping.reference, field }))
      .filter((target) => !managed.has(scheduleTimingFieldKey(target)));
  });
}
function compareAliases(a: LegacyScheduleSourceMapping, b: LegacyScheduleSourceMapping): number {
  return a.sort - b.sort || (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0);
}
function candidate(
  input: LegacyScheduleImportInput,
  timing: WorkScheduleFieldTiming,
): CanonicalImportedSchedule {
  const sourceMappings = [...input.sourceMappings].sort(compareAliases);
  const byKey = new Map(input.steps.map((step) => [step.key, step]));
  const rootOrder = new Map(
    sourceMappings
      .filter((mapping) => !mapping.reference.path.length)
      .map((mapping, index) => [mapping.reference.rootKey, index]),
  );
  const roots = [...input.roots].sort(
    (a, b) => (rootOrder.get(a.key) ?? 0) - (rootOrder.get(b.key) ?? 0),
  );
  return CanonicalImportedSchedule.parse({
    kind: 'imported_schedule',
    revision: 2,
    state: 'published',
    creationMode: input.creationMode,
    source: input.source,
    roots,
    sourceMappings,
    selectedWork: input.selectedWork,
    timing,
    absentFields: absentFields(sourceMappings, timing),
    titlePolicy: { kind: 'legacy_title', revision: 1 },
    titles: sourceMappings.map((mapping) => ({
      target: mapping.reference,
      kind: mapping.kind,
      pattern: byKey.get(mapping.sourceKey)?.fieldOverrides[
        mapping.kind === 'task' ? 'title' : 'name'
      ],
    })),
    completionPolicy: {
      kind: 'legacy_authored_tasks',
      revision: 1,
      tasks: sourceMappings
        .filter((mapping) => mapping.kind === 'task')
        .map((mapping) => mapping.reference),
    },
  });
}
/**
 * Compile caller-proved source aliases into a pure v2 candidate without changing evidence or creating execution claims.
 * Invalid/pending/oversized retained sources stay losslessly nonexecuting. Timezone, actual work identity,
 * accepted closure, activation and live authorization are deliberately supplied/verified by later registration.
 * @throws For malformed internal input or caller-supplied authority fields.
 */
export function compileLegacyScheduleImport(value: unknown): LegacyScheduleImportResult {
  const input = LegacyScheduleImportInput.parse(value);
  const disposition = legacyImportDisposition(input);
  if (disposition) return pending(input, disposition);
  let timing: WorkScheduleFieldTiming;
  try {
    timing = translateLegacyScheduleFieldTiming({
      steps: input.steps.map(({ dependsOn, ...step }) => ({
        ...step,
        ...(dependsOn ? { dependsOn } : {}),
      })),
      sourceMappings: input.sourceMappings,
    });
  } catch {
    return pending(input, 'unsupported_timing');
  }
  return { kind: 'compiled_import', candidate: candidate(input, timing) };
}
