import { z } from 'zod';
import { StepKey } from './work-template-blueprint';
import { WorkScheduleDraft } from './work-schedule';
import { WorkScheduleForestPath } from './work-schedule-forest';
import { WorkScheduleFieldTarget, WorkScheduleFieldTiming } from './work-schedule-field-timing';
import { LegacyScheduleCompletionPolicy, LegacyScheduleTitlePolicy } from './work-schedule-import';

const title = z.strictObject({
  target: WorkScheduleForestPath,
  kind: z.enum(['task', 'project', 'milestone']),
  pattern: z.string(),
});
/** Qualified parent descriptions; only checked earlier prospective work can supply physical IDs. */
export const PrivateScheduleRootPlacement = z
  .strictObject({
    rootKey: StepKey,
    project: WorkScheduleForestPath.optional(),
    milestone: WorkScheduleForestPath.optional(),
    parentTask: WorkScheduleForestPath.optional(),
  })
  .refine(
    (value) => Boolean(value.project ?? value.milestone ?? value.parentTask),
    'Choose a qualified parent.',
  );
/** Private logical placement metadata, never permission to read or use a parent. */
export type PrivateScheduleRootPlacement = z.infer<typeof PrivateScheduleRootPlacement>;
const forest = z.strictObject({
  kind: z.literal('forest'),
  revision: z.literal(2),
  state: z.enum(['published', 'pending_draft']),
  creationMode: z.enum(['all_at_once', 'when_ready']),
  roots: z
    .array(z.strictObject({ key: StepKey, draft: WorkScheduleDraft }))
    .min(1)
    .max(500),
  dependencies: z
    .array(z.strictObject({ blocker: WorkScheduleForestPath, blocked: WorkScheduleForestPath }))
    .max(500),
  timing: WorkScheduleFieldTiming,
  absentFields: z.array(WorkScheduleFieldTarget).max(1000),
  titlePolicy: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('native_title'), revision: z.literal(1) }),
    LegacyScheduleTitlePolicy,
  ]),
  titles: z.array(title).max(500),
  completionPolicy: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('terminal_actual_tree'), revision: z.literal(1) }),
    LegacyScheduleCompletionPolicy,
  ]),
  placements: z.array(PrivateScheduleRootPlacement).max(500).optional(),
});
type Forest = z.infer<typeof forest>;
/**
 * Order physical roots independently from date/completion dependencies using explicit qualified parent links.
 * @throws For unknown roots, duplicate target declarations or physical placement cycles.
 */
export function orderPrivateScheduleRoots<T extends { readonly key: string }>(
  roots: readonly T[],
  placements: readonly PrivateScheduleRootPlacement[] = [],
): readonly T[] {
  const byKey = new Map(roots.map((root) => [root.key, root]));
  const links = new Map(placements.map((placement) => [placement.rootKey, placement]));
  if (links.size !== placements.length)
    throw new RangeError('Declare every private root placement once.');
  const result: T[] = [],
    visiting = new Set<string>(),
    seen = new Set<string>();
  const visit = (key: string): void => {
    if (seen.has(key)) return;
    const root = byKey.get(key);
    if (!root || visiting.has(key))
      throw new RangeError('Private root placement requires an acyclic existing parent.');
    visiting.add(key);
    const link = links.get(key);
    for (const parent of [link?.project, link?.milestone, link?.parentTask])
      if (parent) visit(parent.rootKey);
    visiting.delete(key);
    seen.add(key);
    result.push(root);
  };
  for (const placement of placements)
    if (!byKey.has(placement.rootKey))
      throw new RangeError('Private placement requires an existing target root.');
  for (const root of roots) visit(root.key);
  return result;
}
function referenceKey(ref: WorkScheduleForestPath): string {
  return JSON.stringify([ref.rootKey, ref.path]);
}
function fieldKey(ref: WorkScheduleFieldTarget): string {
  return JSON.stringify([ref.rootKey, ref.path, ref.field]);
}
function references(value: Forest): WorkScheduleForestPath[] {
  return [
    ...value.dependencies.flatMap(({ blocker, blocked }) => [blocker, blocked]),
    ...value.timing.rules.flatMap((rule) => [
      rule.target,
      ...(rule.source.kind === 'work_date'
        ? [rule.source.work]
        : rule.source.kind === 'after_completion'
          ? rule.source.works
          : []),
    ]),
    ...value.absentFields,
    ...value.titles.map((entry) => entry.target),
    ...(value.completionPolicy.kind === 'legacy_authored_tasks'
      ? value.completionPolicy.tasks
      : []),
    ...(value.placements ?? []).flatMap((placement) => [
      { rootKey: placement.rootKey, path: [] },
      ...[placement.project, placement.milestone, placement.parentTask].filter(
        (ref): ref is WorkScheduleForestPath => ref !== undefined,
      ),
    ]),
  ];
}
function validate(value: Forest, ctx: z.RefinementCtx): void {
  validatePlacements(value, ctx);
  const roots = new Set(value.roots.map((root) => root.key));
  if (roots.size !== value.roots.length || references(value).some((ref) => !roots.has(ref.rootKey)))
    ctx.addIssue({
      code: 'custom',
      message: 'Private rules require distinct existing forest roots.',
    });
  if (new Set(value.roots.map((root) => root.draft.timezone)).size !== 1)
    ctx.addIssue({
      code: 'custom',
      message: 'All schedule roots must share their saved timezone.',
    });
  const managed = value.timing.rules.map((rule) => fieldKey(rule.target));
  const absent = value.absentFields.map(fieldKey);
  if (new Set([...managed, ...absent]).size !== managed.length + absent.length)
    ctx.addIssue({ code: 'custom', message: 'Every private date field has one explicit policy.' });
  if (new Set(value.titles.map((entry) => referenceKey(entry.target))).size !== value.titles.length)
    ctx.addIssue({ code: 'custom', message: 'Every authored title has one exact selected path.' });
  if (value.titlePolicy.kind === 'native_title' && value.titles.length)
    ctx.addIssue({
      code: 'custom',
      message: 'Native titles use the existing draft and publication fields.',
    });
  if (
    value.titlePolicy.kind === 'legacy_title' &&
    value.roots.some(
      (root) =>
        !value.titles.some(
          (entry) =>
            entry.target.rootKey === root.key &&
            !entry.target.path.length &&
            entry.kind === root.draft.root.kind,
        ),
    )
  )
    ctx.addIssue({
      code: 'custom',
      message: 'Every authored root requires its exact compatibility title.',
    });
}
function validatePlacements(value: Forest, ctx: z.RefinementCtx): void {
  try {
    orderPrivateScheduleRoots(value.roots, value.placements);
  } catch {
    ctx.addIssue({
      code: 'custom',
      message: 'Private root placement requires distinct acyclic existing roots.',
    });
  }
  if (
    value.placements?.some(
      (placement) =>
        value.roots.find((root) => root.key === placement.rootKey)?.draft.root.kind !== 'task',
    )
  )
    ctx.addIssue({
      code: 'custom',
      message: 'Only Task roots declare private Project, Milestone or parent Task placement.',
    });
}
/** Bound private v2 semantics; parsing grants neither execution nor retained activation authority. */
export const WorkScheduleForestV2 = forest.superRefine(validate);
/** Saved field/title/completion semantics with timezone supplied by the installed schedule roots. */
export type WorkScheduleForestV2 = z.infer<typeof WorkScheduleForestV2>;
