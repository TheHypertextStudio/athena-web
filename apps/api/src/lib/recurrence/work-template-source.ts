import { createHash } from 'node:crypto';
import {
  processStep,
  processProjectSpec,
  processMilestoneSpec,
  processTaskSpec,
  processTaskLabelSpec,
  processProjectLabelSpec,
  type BlueprintInvocationOverride,
} from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';
import { ConflictError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
/** One original source step with reusable structure and private current-compatible starting values. */
export interface RecurrenceBlueprintSource {
  readonly id: string;
  readonly key: string;
  readonly sourceKey: string;
  readonly kind: 'project' | 'milestone' | 'task';
  readonly sort: number;
  readonly parentId: string | null;
  readonly rootId: string;
  readonly preset: BlueprintInvocationOverride;
}
function canonicalKey(key: string): string {
  return /^[a-z][a-z0-9_-]{0,63}$/.test(key)
    ? key
    : `legacy_${createHash('sha256').update(key).digest('hex').slice(0, 48)}`;
}
function privateFields(
  spec: Readonly<Record<string, unknown>>,
  labelIds: readonly string[],
): BlueprintInvocationOverride['fields'] {
  const fields: Record<string, string | number | null | readonly string[]> = {};
  for (const [key, value] of Object.entries(spec))
    if (typeof value === 'string' || typeof value === 'number' || value === null)
      fields[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] = value;
  if (labelIds.length) fields['labelIds'] = labelIds;
  return fields;
}
function parentId(
  kind: RecurrenceBlueprintSource['kind'],
  spec: Readonly<Record<string, unknown>>,
): string | null {
  const value =
    kind === 'milestone'
      ? spec['projectStepId']
      : (spec['parentTaskStepId'] ?? spec['milestoneStepId'] ?? spec['projectStepId']);
  return typeof value === 'string' ? value : null;
}
function selected(source: Omit<RecurrenceBlueprintSource, 'rootId'>): boolean {
  return (
    source.kind === 'task' &&
    typeof source.preset.fields['work_type_id'] === 'string' &&
    typeof source.preset.fields['work_type_version_id'] === 'string'
  );
}
function rootFor(
  id: string,
  sources: ReadonlyMap<string, Omit<RecurrenceBlueprintSource, 'rootId'>>,
  visiting: Set<string>,
): string {
  const source = sources.get(id);
  if (!source || visiting.has(id)) throw new ConflictError('Process hierarchy changed');
  if (!source.parentId || selected(source)) return id;
  visiting.add(id);
  const parentRoot = rootFor(source.parentId, sources, visiting);
  visiting.delete(id);
  const root = sources.get(parentRoot);
  if (!root) throw new ConflictError('Process hierarchy changed');
  return selected(root) ? id : parentRoot;
}
async function loadSpecifications(tx: TemplateTransaction, organizationId: string, ids: string[]) {
  return Promise.all([
    tx
      .select()
      .from(processProjectSpec)
      .where(
        and(
          eq(processProjectSpec.organizationId, organizationId),
          inArray(processProjectSpec.stepId, ids),
        ),
      ),
    tx
      .select()
      .from(processMilestoneSpec)
      .where(
        and(
          eq(processMilestoneSpec.organizationId, organizationId),
          inArray(processMilestoneSpec.stepId, ids),
        ),
      ),
    tx
      .select()
      .from(processTaskSpec)
      .where(
        and(
          eq(processTaskSpec.organizationId, organizationId),
          inArray(processTaskSpec.stepId, ids),
        ),
      ),
    tx
      .select()
      .from(processTaskLabelSpec)
      .where(
        and(
          eq(processTaskLabelSpec.organizationId, organizationId),
          inArray(processTaskLabelSpec.taskStepId, ids),
        ),
      ),
    tx
      .select()
      .from(processProjectLabelSpec)
      .where(
        and(
          eq(processProjectLabelSpec.organizationId, organizationId),
          inArray(processProjectLabelSpec.projectStepId, ids),
        ),
      ),
  ]);
}
/** Read the immutable typed legacy specifications; their literals stay in private invocation data. */
export async function loadRecurrenceBlueprintSources(
  tx: TemplateTransaction,
  organizationId: string,
  revisionId: string,
): Promise<readonly RecurrenceBlueprintSource[]> {
  const steps = await tx
    .select()
    .from(processStep)
    .where(
      and(eq(processStep.organizationId, organizationId), eq(processStep.revisionId, revisionId)),
    )
    .orderBy(processStep.sort);
  if (!steps.length || steps.length > 500)
    throw new ConflictError('Process has an invalid work graph');
  const ids = steps.map((step) => step.id);
  const [projects, milestones, tasks, taskLabels, projectLabels] = await loadSpecifications(
    tx,
    organizationId,
    ids,
  );
  const specs = new Map([...projects, ...milestones, ...tasks].map((spec) => [spec.stepId, spec]));
  const sources = steps.map((step) => {
    const spec = specs.get(step.id);
    if (!spec) throw new ConflictError('Process specification is missing');
    const labels =
      step.kind === 'project'
        ? projectLabels.filter((label) => label.projectStepId === step.id)
        : taskLabels.filter((label) => label.taskStepId === step.id);
    return {
      id: step.id,
      key: canonicalKey(step.key),
      sourceKey: step.key,
      kind: step.kind,
      sort: step.sort,
      parentId: parentId(step.kind, spec),
      preset: {
        sourceStepId: step.id,
        kind: step.kind,
        fields: privateFields(
          spec,
          labels.map((label) => label.labelId),
        ),
        timing: {
          kind: step.timingKind,
          offsetDays: step.offsetDays,
          afterStepId: step.afterStepId,
        },
      },
    };
  });
  const map = new Map(sources.map((source) => [source.id, source]));
  return sources.map((source) => ({ ...source, rootId: rootFor(source.id, map, new Set()) }));
}
