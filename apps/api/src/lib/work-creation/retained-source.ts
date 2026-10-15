import {
  processStep,
  type BlueprintInvocationManifest,
  type BlueprintInvocationOverride,
} from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { ConflictError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
type SourceRow = Pick<typeof processStep.$inferSelect, 'id' | 'key' | 'kind'>;
function assertSteps(
  manifest: BlueprintInvocationManifest,
  source: ReadonlyMap<string, SourceRow>,
): void {
  const seen = new Set<string>();
  const paths = new Set<string>();
  for (const step of manifest.steps) {
    const row = source.get(step.sourceStepId);
    const path = JSON.stringify([step.rootKey, ...step.path]);
    if (row?.key !== step.sourceKey || seen.has(row.id) || paths.has(path))
      throw new ConflictError('Recurrence binding changed');
    seen.add(row.id);
    paths.add(path);
  }
  if (seen.size !== source.size) throw new ConflictError('Recurrence binding changed');
}
function assertRoots(
  manifest: BlueprintInvocationManifest,
  source: ReadonlyMap<string, SourceRow>,
): void {
  for (const root of manifest.roots) {
    const row = source.get(root.sourceStepId);
    const step = manifest.steps.find((value) => value.sourceStepId === root.sourceStepId);
    if (
      row?.kind !== root.kind ||
      row.key !== root.sourceKey ||
      step?.path.length !== 0 ||
      step.rootKey !== root.key
    )
      throw new ConflictError('Recurrence binding changed');
  }
}
function assertOverrides(
  overrides: readonly BlueprintInvocationOverride[],
  source: ReadonlyMap<string, SourceRow>,
): void {
  const presetIds = new Set<string>();
  for (const preset of overrides) {
    if (source.get(preset.sourceStepId)?.kind !== preset.kind || presetIds.has(preset.sourceStepId))
      throw new ConflictError('Recurrence binding changed');
    presetIds.add(preset.sourceStepId);
  }
  if (presetIds.size !== source.size) throw new ConflictError('Recurrence binding changed');
}
/** Validate the private manifest against its original immutable source revision before granting authority. */
export async function assertRetainedSource(
  tx: TemplateTransaction,
  organizationId: string,
  manifest: BlueprintInvocationManifest,
  overrides: readonly BlueprintInvocationOverride[],
): Promise<ReadonlyMap<string, 'task' | 'project' | 'milestone'>> {
  const rows = await tx
    .select({ id: processStep.id, key: processStep.key, kind: processStep.kind })
    .from(processStep)
    .where(
      and(
        eq(processStep.organizationId, organizationId),
        eq(processStep.revisionId, manifest.legacyProcessRevisionId),
      ),
    );
  const source = new Map(rows.map((row) => [row.id, row]));
  assertSteps(manifest, source);
  assertRoots(manifest, source);
  assertOverrides(overrides, source);
  return new Map(rows.map((row) => [row.id, row.kind]));
}
