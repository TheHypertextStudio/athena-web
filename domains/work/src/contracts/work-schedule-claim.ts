import { z } from 'zod';
import { RecurrenceSeriesRevisionId, WorkTypeId, WorkTypeVersionId } from '../ids';
import { BlueprintCivilDate, ResolvedVersionAtPath, StepKey } from './work-template-blueprint';
import { ScheduleTimezone, WorkScheduleOptionalChoices } from './work-schedule';

/** Selected pre-work path; there are deliberately no fabricated physical work identifiers. */
export const AcceptedSchedulePath = z.strictObject({
  path: z.array(StepKey).max(499),
  kind: z.enum(['task', 'project', 'program', 'milestone']),
});
/** One accepted logical node, including versionless Milestones in the aggregate work budget. */
export type AcceptedSchedulePath = z.infer<typeof AcceptedSchedulePath>;
const rootFields = {
  key: StepKey,
  kind: z.enum(['task', 'project']),
  workTypeId: WorkTypeId,
  versionId: WorkTypeVersionId,
  resolvedManifest: z.array(ResolvedVersionAtPath).min(1).max(500),
  optionalChoices: WorkScheduleOptionalChoices,
  selectedPaths: z.array(AcceptedSchedulePath).min(1).max(500),
};
type Root = z.infer<z.ZodObject<typeof rootFields>>;
function validatePaths(value: Root, ctx: z.RefinementCtx): Map<string, AcceptedSchedulePath> {
  const paths = new Map(value.selectedPaths.map((entry) => [JSON.stringify(entry.path), entry]));
  const root = paths.get('[]');
  if (paths.size !== value.selectedPaths.length || root?.kind !== value.kind)
    ctx.addIssue({
      code: 'custom',
      path: ['selectedPaths'],
      message: 'Accept each selected path once, including the matching root.',
    });
  for (const entry of value.selectedPaths) {
    if (entry.path.length > 0 && !paths.has(JSON.stringify(entry.path.slice(0, -1))))
      ctx.addIssue({
        code: 'custom',
        path: ['selectedPaths'],
        message: 'Every selected child requires its selected parent.',
      });
  }
  return paths;
}
function validateRoot(value: Root, ctx: z.RefinementCtx): void {
  const paths = validatePaths(value, ctx);
  const versions = new Map(
    value.resolvedManifest.map((entry) => [JSON.stringify(entry.path), entry]),
  );
  for (const entry of value.selectedPaths) {
    if (entry.kind !== 'milestone' && !versions.has(JSON.stringify(entry.path)))
      ctx.addIssue({
        code: 'custom',
        path: ['resolvedManifest'],
        message: 'Every selected non-Milestone path requires its exact publication.',
      });
  }
  const publication = versions.get('[]');
  if (
    versions.size !== value.resolvedManifest.length ||
    publication?.workTypeId !== value.workTypeId ||
    publication.versionId !== value.versionId
  )
    ctx.addIssue({
      code: 'custom',
      path: ['resolvedManifest'],
      message: 'Retain the exact selected root publication once.',
    });
  for (const entry of value.resolvedManifest) {
    const selected = paths.get(JSON.stringify(entry.path));
    if (!selected || selected.kind === 'milestone')
      ctx.addIssue({
        code: 'custom',
        path: ['resolvedManifest'],
        message: 'A publication must belong to selected non-Milestone work.',
      });
  }
}
/** Exact accepted root and nested closure before the work transaction begins. */
export const AcceptedScheduleRoot = z.strictObject(rootFields).superRefine(validateRoot);
/** Accepted root data; publication/tenant membership is additionally guarded by the claim transaction. */
export type AcceptedScheduleRoot = z.infer<typeof AcceptedScheduleRoot>;
/** Complete bounded forest closure shared by revision fallback and immutable occurrence claims. */
export const AcceptedScheduleRoots = z
  .array(AcceptedScheduleRoot)
  .min(1)
  .max(500)
  .superRefine((roots, ctx) => {
    if (new Set(roots.map((root) => root.key)).size !== roots.length)
      ctx.addIssue({ code: 'custom', message: 'Accept each root key once.' });
    if (roots.reduce((count, root) => count + root.selectedPaths.length, 0) > 500)
      ctx.addIssue({ code: 'custom', message: 'A run may select at most 500 work rows.' });
  });
/** Guarded immutable schedule claim; only persisted registration turns it into execution authority. */
export const AcceptedScheduleClaim = z.strictObject({
  kind: z.literal('schedule'),
  revision: z.literal(1),
  sourceInvocationId: z
    .string()
    .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    .nullable(),
  seriesRevisionId: RecurrenceSeriesRevisionId,
  runDate: BlueprintCivilDate,
  timezone: ScheduleTimezone,
  draftFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  roots: AcceptedScheduleRoots,
});
/** Accepted native or compatibility forest execution data, immutable across failed attempts and retries. */
export type AcceptedScheduleClaim = z.infer<typeof AcceptedScheduleClaim>;
