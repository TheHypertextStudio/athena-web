import { z } from 'zod';
import {
  LegacyScheduleImportRoot,
  LegacyScheduleSourceMapping,
  LegacyScheduleCompletionPolicy,
  LegacyScheduleTitlePolicy,
} from './work-schedule-import';
import {
  WorkScheduleFieldTarget,
  WorkScheduleFieldTiming,
  type WorkScheduleTimingRef,
} from './work-schedule-field-timing';
import { WorkScheduleForestV2, orderPrivateScheduleRoots } from './work-schedule-forest-v2';
import { validateScheduleFieldTiming } from '../schedule-field-timing';

const definition = z.strictObject({
  kind: z.literal('private_definition'),
  revision: z.literal(1),
  state: z.enum(['published', 'pending_draft']),
  creationMode: z.enum(['all_at_once', 'when_ready']),
  roots: z.array(LegacyScheduleImportRoot).max(500),
  sourceMappings: z.array(LegacyScheduleSourceMapping).max(500),
  dependencies: WorkScheduleForestV2.shape.dependencies,
  timing: WorkScheduleFieldTiming,
  absentFields: z.array(WorkScheduleFieldTarget).max(1000),
  titlePolicy: LegacyScheduleTitlePolicy,
  titles: WorkScheduleForestV2.shape.titles,
  completionPolicy: LegacyScheduleCompletionPolicy,
  placements: WorkScheduleForestV2.shape.placements,
  authoring: z.strictObject({
    kind: z.literal('process_definition'),
    revision: z.literal(1),
    definitionAlias: z.string().min(1),
    revisionAlias: z.string().min(1),
    definition: z.json(),
  }),
});
type Definition = z.infer<typeof definition>;
function key(reference: WorkScheduleTimingRef): string {
  return JSON.stringify([reference.rootKey, reference.path]);
}
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return (
    a.length === b.length && new Set(a).size === a.length && a.every((value) => b.includes(value))
  );
}
function completeRoots(value: Definition): boolean {
  return (
    value.roots.length > 0 &&
    value.roots.every(
      (root) =>
        root.template !== null &&
        root.root !== null &&
        root.template.selection.kind === 'pinned' &&
        root.template.targetType === root.root.kind &&
        value.sourceMappings.some(
          (mapping) =>
            mapping.reference.rootKey === root.key &&
            !mapping.reference.path.length &&
            mapping.kind === root.root?.kind,
        ),
    )
  );
}
function completePolicies(value: Definition): boolean {
  const tasks = value.sourceMappings
    .filter((mapping) => mapping.kind === 'task')
    .map((mapping) => key(mapping.reference));
  const titles = value.sourceMappings.map((mapping) =>
    JSON.stringify([key(mapping.reference), mapping.kind]),
  );
  return (
    sameSet(tasks, value.completionPolicy.tasks.map(key)) &&
    sameSet(
      titles,
      value.titles.map((title) => JSON.stringify([key(title.target), title.kind])),
    )
  );
}
function validate(value: Definition, ctx: z.RefinementCtx): void {
  if (
    new Set(value.roots.map((root) => root.key)).size !== value.roots.length ||
    new Set(value.sourceMappings.map((mapping) => mapping.alias)).size !==
      value.sourceMappings.length ||
    new Set(value.sourceMappings.map((mapping) => mapping.sourceKey)).size !==
      value.sourceMappings.length
  )
    ctx.addIssue({
      code: 'custom',
      message: 'Private roots and compatibility aliases must be distinct.',
    });
  if (value.state !== 'published') return;
  validatePlacements(value, ctx);
  const roots = new Set(value.roots.map((root) => root.key));
  if (value.sourceMappings.some((mapping) => !roots.has(mapping.reference.rootKey)))
    ctx.addIssue({
      code: 'custom',
      message: 'Published aliases require their declared private root.',
    });
  if (!completeRoots(value) || !completePolicies(value))
    ctx.addIssue({
      code: 'custom',
      message:
        'Publication requires complete pinned roots and every authored title and Task completion requirement.',
    });
  const fields = [...value.timing.rules.map((rule) => rule.target), ...value.absentFields];
  const expected = value.sourceMappings.flatMap((mapping) =>
    (mapping.kind === 'task'
      ? ['startDate', 'dueDate']
      : mapping.kind === 'project'
        ? ['startDate', 'targetDate']
        : ['targetDate']
    ).map((field) => JSON.stringify([key(mapping.reference), field])),
  );
  if (
    !sameSet(
      expected,
      fields.map((target) => JSON.stringify([key(target), target.field])),
    )
  )
    ctx.addIssue({ code: 'custom', message: 'Every authored date field has one explicit policy.' });
  try {
    validateScheduleFieldTiming(
      {
        ...value.timing,
        rules: [
          ...value.timing.rules,
          ...value.absentFields.map((target) => ({
            target,
            source: { kind: 'run' as const },
            offset: { days: 0, unit: 'calendar' as const },
          })),
        ],
      },
      value.sourceMappings,
      value.dependencies,
    );
  } catch {
    ctx.addIssue({
      code: 'custom',
      message: 'Publish a valid bounded private date and dependency graph.',
    });
  }
}
/** Timezone-neutral private authoring payload; its distinct manifest kind grants no execution or retained authority. */
export const CanonicalPrivateWorkDefinition = definition.superRefine(validate);
/** Immutable authored source-key, selection, date, title and completion contract for private definitions. */
export type CanonicalPrivateWorkDefinition = z.infer<typeof CanonicalPrivateWorkDefinition>;

function validatePlacements(value: Definition, ctx: z.RefinementCtx): void {
  try {
    orderPrivateScheduleRoots(value.roots, value.placements);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Publish acyclic private root placement.' });
  }
  if (
    value.placements?.some(
      (placement) =>
        value.roots.find((root) => root.key === placement.rootKey)?.root?.kind !== 'task',
    )
  )
    ctx.addIssue({
      code: 'custom',
      message: 'Private Task roots require their exact declared parents.',
    });
}

/** Shared literal preset projection; these descriptions carry no source proof or execution authority. */
export {
  privateScheduleRootFromPreset,
  privateScheduleStepFromPreset,
  type PrivateSchedulePreset,
} from '../schedule-private-presets';
