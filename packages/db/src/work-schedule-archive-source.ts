import type {
  BlueprintInvocationManifest,
  BlueprintInvocationOverride,
} from './blueprint-invocation';
import { serializeScheduleArchive } from './work-schedule-archive';

/** An unproved original source must remain retained; it is never a transient storage failure. */
export class ScheduleSourceProofError extends Error {
  override readonly name = 'ScheduleSourceProofError';
}

/** Frozen source projection used only by the schedule archival checkpoint. */
export interface ScheduleArchiveSource {
  readonly source: Record<string, unknown>;
  readonly header: Record<string, unknown>;
  readonly revisionAudit: Record<string, unknown>;
  readonly manifest: BlueprintInvocationManifest;
  readonly overrides: readonly BlueprintInvocationOverride[];
  readonly fingerprint: string;
  readonly originalFingerprint: string;
  readonly originalStepOrders: readonly ScheduleOriginalStepOrder[];
}
/** Original source identity joined to both its frozen projection and immutable publication JSON. */
export interface ScheduleOriginalStepOrder {
  readonly sourceStepId: string;
  readonly blueprintStepId: string | null;
  readonly sourceVersionId: string | null;
  readonly key: string | null;
  readonly kind: string | null;
  readonly sort: number | null;
  readonly stepSort: number | null;
  readonly definitionSort: number | null;
}
function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new ScheduleSourceProofError('Schedule source is incomplete.');
  return value as Record<string, unknown>[];
}
function verifyFields(row: ScheduleArchiveSource): void {
  for (const kind of ['tasks', 'projects', 'milestones']) {
    for (const spec of records(row.source[kind])) {
      const saved = row.overrides.find((entry) => entry.sourceStepId === spec['step_id']);
      if (
        !saved ||
        Object.entries(spec).some(
          ([key, value]) =>
            serializeScheduleArchive(saved.fields[key]) !== serializeScheduleArchive(value),
        )
      )
        throw new ScheduleSourceProofError(
          'Schedule source fields differ from original invocation.',
        );
    }
  }
}
function verifyStep(row: ScheduleArchiveSource, step: Record<string, unknown>): void {
  const saved = row.overrides.find((entry) => entry.sourceStepId === step['id']);
  if (
    !saved ||
    saved.kind !== step['kind'] ||
    saved.timing.kind !== step['timing_kind'] ||
    saved.timing.offsetDays !== step['offset_days'] ||
    saved.timing.afterStepId !== step['after_step_id']
  )
    throw new ScheduleSourceProofError('Schedule source timing differs from original invocation.');
  const labels = [...records(row.source['taskLabels']), ...records(row.source['projectLabels'])];
  const actual = labels
    .filter((label) => (label['task_step_id'] ?? label['project_step_id']) === step['id'])
    .map((label) => label['label_id'])
    .sort();
  const original = saved.fields['labelIds'];
  const sorted = Array.isArray(original) ? [...(original as readonly string[])].sort() : [];
  if (serializeScheduleArchive(actual) !== serializeScheduleArchive(sorted))
    throw new ScheduleSourceProofError('Schedule source labels differ from original invocation.');
}
function verifyProjectedOrder(
  row: ScheduleArchiveSource,
  step: Record<string, unknown>,
  original: BlueprintInvocationManifest['steps'][number],
): boolean {
  if (!original.blueprintStepId && !original.sourceVersionId) return false;
  const matches = row.originalStepOrders.filter((entry) => entry.sourceStepId === step['id']);
  const proof = matches[0];
  if (!proof || matches.length !== 1)
    throw new ScheduleSourceProofError(
      'Schedule original ordering evidence is incomplete or inconsistent.',
    );
  if (
    proof.blueprintStepId !== original.blueprintStepId ||
    proof.sourceVersionId !== original.sourceVersionId ||
    proof.key !== original.path.at(-1) ||
    proof.kind !== step['kind'] ||
    !consistentProjectedOrder(proof)
  )
    throw new ScheduleSourceProofError(
      'Schedule original ordering evidence is incomplete or inconsistent.',
    );
  if (proof.sort !== step['sort'])
    throw new ScheduleSourceProofError(
      'Schedule source ordering differs from its original publication.',
    );
  return true;
}
function consistentProjectedOrder(proof: ScheduleOriginalStepOrder): boolean {
  return (
    typeof proof.sort === 'number' &&
    Number.isInteger(proof.sort) &&
    proof.sort >= 0 &&
    proof.sort === proof.stepSort &&
    proof.sort === proof.definitionSort
  );
}
function verifyOrdering(
  row: ScheduleArchiveSource,
  steps: readonly Record<string, unknown>[],
): void {
  if (!/^[a-f0-9]{32}$/.test(row.fingerprint) || !/^[a-f0-9]{32}$/.test(row.originalFingerprint))
    throw new ScheduleSourceProofError(
      'Schedule original ordering evidence is incomplete or inconsistent.',
    );
  let unprojected = steps.length === 0 || row.manifest.kind === 'pending_draft';
  for (const step of steps) {
    if (!Number.isInteger(step['sort']) || Number(step['sort']) < 0)
      throw new ScheduleSourceProofError('Schedule source ordering is invalid.');
    const original = row.manifest.steps.find((entry) => entry.sourceStepId === step['id']);
    if (!original)
      throw new ScheduleSourceProofError(
        'Schedule original ordering evidence is incomplete or inconsistent.',
      );
    if (!verifyProjectedOrder(row, step, original)) unprojected = true;
  }
  // Frozen0154 never projected root/pending sort. Its original whole-source MD5 is the only
  // retained proof for those values; invocation array position was JSON-text order, not sort.
  if (unprojected && row.fingerprint !== row.originalFingerprint)
    throw new ScheduleSourceProofError(
      'Schedule original source ordering cannot be proved; retain legacy source.',
    );
}
/** Verify original graph/order facts; changed headers cannot substitute for missing original root proof. */
export function verifyOriginalScheduleSource(row: ScheduleArchiveSource): void {
  const steps = records(row.source['steps']);
  if (
    steps.length !== row.manifest.steps.length ||
    steps.some((step) => !row.manifest.steps.some((entry) => entry.sourceStepId === step['id']))
  )
    throw new ScheduleSourceProofError(
      'Schedule source graph differs from its original invocation.',
    );
  for (const step of steps) {
    const original = row.manifest.steps.find((entry) => entry.sourceStepId === step['id']);
    if (original?.sourceKey !== step['key'])
      throw new ScheduleSourceProofError('Schedule source keys differ from original invocation.');
  }
  verifyFields(row);
  for (const step of steps) verifyStep(row, step);
  verifyOrdering(row, steps);
  const edges = records(row.source['dependencies']).map((edge) => ({
    blockerStepId: edge['blocking_step_id'],
    blockedStepId: edge['blocked_step_id'],
  }));
  if (
    serializeScheduleArchive(
      edges.sort((a, b) => serializeScheduleArchive(a).localeCompare(serializeScheduleArchive(b))),
    ) !==
    serializeScheduleArchive(
      [...row.manifest.dependencies].sort((a, b) =>
        serializeScheduleArchive(a).localeCompare(serializeScheduleArchive(b)),
      ),
    )
  )
    throw new ScheduleSourceProofError(
      'Schedule source dependencies differ from original invocation.',
    );
}
