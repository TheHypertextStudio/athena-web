import { ResolvedVersionAtPath } from '@docket/work/work-template-blueprint';
import {
  blueprintInvocation,
  processInstance,
  processInstanceMilestone,
  processInstanceProject,
  processInstanceTask,
  processOccurrence,
  processRevision,
  recurrenceSeries,
  recurrenceSeriesRevision,
  template,
  workTypeVersion,
  type BlueprintInvocationManifest,
  type BlueprintInvocationOverride,
  type BlueprintOccurrenceRoot,
} from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { canActor, satisfies, type Capability } from '@docket/authz';
import { z } from 'zod';
import { CapabilityError, ConflictError, NotFoundError } from '../../error';
import { assertSharedWorkWritable } from '../../product-capability';
import type { TemplateTransaction } from '../templates/persistence';
import { authorizeRetainedRecurrence, loadCreationActor } from './context';
import type { OrdinaryWorkCommand } from './types';
import { assertRetainedSource } from './retained-source';

/** Opaque occurrence capability, registered only after checking its persisted same-transaction binding. */
export interface RetainedOccurrenceAuthority {
  readonly kind: 'retained-occurrence';
  readonly proof: object;
}
/** Exact original root selection within one checked private occurrence, never a public archive flag. */
export interface RetainedRootBinding {
  readonly authority: RetainedOccurrenceAuthority;
  readonly rootKey: string;
}
/** One original immutable source step's existing physical work identity. */
export interface RetainedOccurrenceWork {
  readonly sourceStepId: string;
  readonly sourceKey: string;
  readonly rootKey: string;
  readonly path: readonly string[];
  readonly kind: 'project' | 'milestone' | 'task';
  readonly id: string;
}
/** Validated persisted occurrence and its original authoring authority and restricted preset. */
export interface AuthorizedRetainedOccurrence {
  readonly authority: RetainedOccurrenceAuthority;
  readonly caller: OrdinaryWorkCommand['caller'];
  readonly organizationId: string;
  readonly seriesId: string;
  readonly seriesRevisionId: string;
  readonly occurrenceId: string;
  readonly instanceId: string;
  readonly processRevisionId: string;
  readonly invocationId: string;
  readonly runDate: string;
  readonly scheduleTimezone: string | null;
  readonly appliedAt: Date | null;
  readonly manifest: BlueprintInvocationManifest & { readonly kind: 'published' };
  readonly overrides: readonly BlueprintInvocationOverride[];
  readonly mappedWork: ReadonlyMap<string, RetainedOccurrenceWork>;
  readonly rootRefs: readonly BlueprintOccurrenceRoot[];
}
/** Persisted identities supplied by the existing locked occurrence materializer. */
export interface RetainedOccurrenceRequest {
  readonly organizationId: string;
  readonly seriesId: string;
  readonly seriesRevisionId: string;
  readonly occurrenceId: string;
  readonly instanceId: string;
  readonly actorId?: string | undefined;
}
const authorities = new WeakMap<
  object,
  { tx: TemplateTransaction; facts: AuthorizedRetainedOccurrence }
>();
const rootSchema = z.strictObject({
  sourceStepId: z.string(),
  sourceKey: z.string(),
  key: z.string(),
  kind: z.enum(['project', 'task']),
  workTypeId: z.string().nullable(),
  workTypeVersionId: z.string().nullable(),
});
const manifestSchema = z.strictObject({
  kind: z.enum(['published', 'pending_draft']),
  legacyProcessRevisionId: z.string(),
  roots: z.array(rootSchema).max(500),
  steps: z
    .array(
      z.strictObject({
        sourceStepId: z.string(),
        sourceKey: z.string(),
        rootKey: z.string(),
        path: z.array(z.string()),
        blueprintStepId: z.string().nullable(),
        sourceVersionId: z.string().nullable(),
      }),
    )
    .max(500),
  dependencies: z
    .array(z.strictObject({ blockerStepId: z.string(), blockedStepId: z.string() }))
    .max(2000),
});

/**
 * Authorize an immutable published occurrence selection without materializing or changing work.
 * @throws For missing/mismatched/private bindings, unpublished drafts, or inactive actual authority.
 */
export async function authorizeRetainedOccurrence(
  tx: TemplateTransaction,
  request: RetainedOccurrenceRequest,
): Promise<AuthorizedRetainedOccurrence> {
  const bound = await persistedBinding(tx, request);
  const caller = await occurrenceCaller(tx, request, bound.createdBy);
  if (!bound.invocationId) throw new ConflictError('Publish the process before running it.');
  const [stored] = await tx
    .select()
    .from(blueprintInvocation)
    .where(
      and(
        eq(blueprintInvocation.id, bound.invocationId),
        eq(blueprintInvocation.organizationId, request.organizationId),
      ),
    )
    .limit(1);
  if (!stored) throw new NotFoundError('Recurrence binding not found');
  const manifest = manifestSchema.parse(stored.manifest);
  if (manifest.kind !== 'published' || !manifest.roots.length)
    throw new ConflictError('Publish the process before running it.');
  if (manifest.legacyProcessRevisionId !== bound.processRevisionId)
    throw new ConflictError('Recurrence binding changed');
  await assertRootSelections(tx, request.organizationId, manifest, bound);
  const kinds = await assertRetainedSource(tx, request.organizationId, manifest, stored.overrides);
  const mappedWork = await loadMappedWork(tx, request, manifest, kinds);
  const rootRefs = retainedRootRefs(manifest, mappedWork, bound.rootRefs);
  const authority: RetainedOccurrenceAuthority = Object.freeze({
    kind: 'retained-occurrence',
    proof: {},
  });
  const facts: AuthorizedRetainedOccurrence = Object.freeze({
    ...request,
    authority,
    caller,
    processRevisionId: bound.processRevisionId,
    invocationId: stored.id,
    runDate: bound.scheduledFor,
    scheduleTimezone: bound.scheduleTimezone,
    appliedAt: bound.appliedAt,
    manifest: { ...manifest, kind: 'published' as const },
    overrides: stored.overrides,
    mappedWork,
    rootRefs,
  });
  authorities.set(authority.proof, { tx, facts });
  return facts;
}
/** Read only an exact registered token belonging to this transaction; clones and reused tokens refuse. */
export function requireRetainedOccurrenceAuthority(
  tx: TemplateTransaction,
  authority: RetainedOccurrenceAuthority,
): AuthorizedRetainedOccurrence {
  const checked = authorities.get(authority.proof);
  if (checked?.tx !== tx || checked.facts.authority !== authority) throw new CapabilityError();
  return checked.facts;
}
/** Check the initiating caller and exact original root/version before enabling retained creation semantics. */
export function retainedRootBinding(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
):
  | {
      readonly occurrence: AuthorizedRetainedOccurrence;
      readonly root: BlueprintInvocationManifest['roots'][number];
      readonly runDate: string;
      readonly overrides: readonly BlueprintInvocationOverride[];
      readonly authority: RetainedOccurrenceAuthority;
    }
  | undefined {
  const binding = command.invocation.retainedBinding;
  if (!binding) return undefined;
  const occurrence = requireRetainedOccurrenceAuthority(tx, binding.authority);
  const root = occurrence.manifest.roots.find((value) => value.key === binding.rootKey);
  if (
    !root ||
    occurrence.organizationId !== command.caller.orgId ||
    occurrence.caller.actorId !== command.caller.actorId ||
    root.kind !== command.kind ||
    root.workTypeId !== command.body.workTypeId ||
    root.workTypeVersionId !== command.body.workTypeVersionId
  )
    throw new CapabilityError();
  return {
    occurrence,
    root,
    runDate: occurrence.runDate,
    overrides: occurrence.overrides,
    authority: occurrence.authority,
  };
}
async function persistedBinding(tx: TemplateTransaction, request: RetainedOccurrenceRequest) {
  const [row] = await tx
    .select({
      createdBy: recurrenceSeries.createdBy,
      invocationId: recurrenceSeriesRevision.blueprintInvocationId,
      workTypeId: recurrenceSeriesRevision.workTypeId,
      workTypeVersionId: recurrenceSeriesRevision.workTypeVersionId,
      processRevisionId: recurrenceSeriesRevision.processRevisionId,
      scheduledFor: processOccurrence.scheduledFor,
      scheduleTimezone: recurrenceSeriesRevision.timezone,
      appliedAt: processOccurrence.blueprintAppliedAt,
      occurrenceInvocation: processOccurrence.blueprintInvocationId,
      rootRefs: processOccurrence.blueprintRootRefs,
    })
    .from(recurrenceSeries)
    .innerJoin(
      recurrenceSeriesRevision,
      and(
        eq(recurrenceSeriesRevision.seriesId, recurrenceSeries.id),
        eq(recurrenceSeriesRevision.organizationId, request.organizationId),
      ),
    )
    .innerJoin(
      processOccurrence,
      and(
        eq(processOccurrence.seriesId, recurrenceSeries.id),
        eq(processOccurrence.seriesRevisionId, recurrenceSeriesRevision.id),
        eq(processOccurrence.organizationId, request.organizationId),
      ),
    )
    .innerJoin(
      processInstance,
      and(
        eq(processInstance.occurrenceId, processOccurrence.id),
        eq(processInstance.revisionId, recurrenceSeriesRevision.processRevisionId),
        eq(processInstance.definitionId, recurrenceSeries.definitionId),
        eq(processInstance.organizationId, request.organizationId),
      ),
    )
    .innerJoin(
      processRevision,
      and(
        eq(processRevision.id, recurrenceSeriesRevision.processRevisionId),
        eq(processRevision.organizationId, request.organizationId),
      ),
    )
    .where(
      and(
        eq(recurrenceSeries.organizationId, request.organizationId),
        eq(recurrenceSeries.id, request.seriesId),
        eq(recurrenceSeriesRevision.id, request.seriesRevisionId),
        eq(processOccurrence.id, request.occurrenceId),
        eq(processInstance.id, request.instanceId),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Recurrence binding not found');
  if (row.occurrenceInvocation && row.occurrenceInvocation !== row.invocationId)
    throw new ConflictError('Recurrence binding changed');
  return row;
}
async function occurrenceCaller(
  tx: TemplateTransaction,
  request: RetainedOccurrenceRequest,
  createdBy: string | null,
): Promise<OrdinaryWorkCommand['caller']> {
  const id = request.actorId ?? createdBy;
  if (id === null)
    return authorizeRetainedRecurrence(tx, request.organizationId, {
      seriesId: request.seriesId,
      revisionId: request.seriesRevisionId,
    });
  const caller = await loadCreationActor(tx, request.organizationId, id);
  if (
    !caller.capabilities.some((capability) => satisfies(capability as Capability, 'contribute'))
  ) {
    const access = await canActor(
      id,
      'contribute',
      { kind: 'organization', orgId: request.organizationId, id: request.organizationId },
      tx,
    );
    if (!access.allow) throw new CapabilityError();
  }
  await assertSharedWorkWritable(request.organizationId, caller.isPersonal, tx);
  return caller;
}
async function assertRootSelections(
  tx: TemplateTransaction,
  orgId: string,
  manifest: BlueprintInvocationManifest,
  bound: { workTypeId: string | null; workTypeVersionId: string | null },
): Promise<void> {
  const keys = new Set<string>();
  for (const root of manifest.roots) {
    if (!root.workTypeId || !root.workTypeVersionId || keys.has(root.key))
      throw new ConflictError('Recurrence binding changed');
    keys.add(root.key);
    const [version] = await tx
      .select({ id: workTypeVersion.id, kind: template.targetType, scope: template.scope })
      .from(workTypeVersion)
      .innerJoin(
        template,
        and(eq(template.id, workTypeVersion.workTypeId), eq(template.organizationId, orgId)),
      )
      .where(
        and(
          eq(workTypeVersion.id, root.workTypeVersionId),
          eq(workTypeVersion.workTypeId, root.workTypeId),
          eq(workTypeVersion.organizationId, orgId),
        ),
      )
      .limit(1);
    if (version?.kind !== root.kind || version.scope !== 'organization')
      throw new ConflictError('Recurrence binding changed');
  }
  assertSingularSelection(manifest, bound);
}
function assertSingularSelection(
  manifest: BlueprintInvocationManifest,
  bound: { workTypeId: string | null; workTypeVersionId: string | null },
): void {
  const singular = manifest.roots.length === 1 ? manifest.roots[0] : undefined;
  if (
    bound.workTypeId &&
    (singular?.workTypeId !== bound.workTypeId ||
      singular.workTypeVersionId !== bound.workTypeVersionId)
  )
    throw new ConflictError('Recurrence binding changed');
}
async function loadMappedWork(
  tx: TemplateTransaction,
  request: RetainedOccurrenceRequest,
  manifest: BlueprintInvocationManifest,
  kinds: ReadonlyMap<string, 'task' | 'project' | 'milestone'>,
): Promise<ReadonlyMap<string, RetainedOccurrenceWork>> {
  const condition = and(
    eq(processInstanceTask.instanceId, request.instanceId),
    eq(processInstanceTask.organizationId, request.organizationId),
  );
  const [tasks, projects, milestones] = await Promise.all([
    tx
      .select({ sourceStepId: processInstanceTask.stepId, id: processInstanceTask.taskId })
      .from(processInstanceTask)
      .where(condition),
    tx
      .select({ sourceStepId: processInstanceProject.stepId, id: processInstanceProject.projectId })
      .from(processInstanceProject)
      .where(
        and(
          eq(processInstanceProject.instanceId, request.instanceId),
          eq(processInstanceProject.organizationId, request.organizationId),
        ),
      ),
    tx
      .select({
        sourceStepId: processInstanceMilestone.stepId,
        id: processInstanceMilestone.milestoneId,
      })
      .from(processInstanceMilestone)
      .where(
        and(
          eq(processInstanceMilestone.instanceId, request.instanceId),
          eq(processInstanceMilestone.organizationId, request.organizationId),
        ),
      ),
  ]);
  const result = new Map<string, RetainedOccurrenceWork>();
  const rows = [
    ...tasks.map((row) => ({ ...row, kind: 'task' as const })),
    ...projects.map((row) => ({ ...row, kind: 'project' as const })),
    ...milestones.map((row) => ({ ...row, kind: 'milestone' as const })),
  ];
  for (const row of rows) {
    const source = manifest.steps.find((step) => step.sourceStepId === row.sourceStepId);
    if (!source || result.has(row.sourceStepId) || kinds.get(row.sourceStepId) !== row.kind)
      throw new ConflictError('Retained work mapping changed');
    result.set(row.sourceStepId, { ...source, ...row });
  }
  return result;
}
function retainedRootRefs(
  manifest: BlueprintInvocationManifest,
  mapped: ReadonlyMap<string, RetainedOccurrenceWork>,
  stored: readonly BlueprintOccurrenceRoot[] | null,
): readonly BlueprintOccurrenceRoot[] {
  const roots = manifest.roots.flatMap((root) => {
    const row = mapped.get(root.sourceStepId);
    return row ? [{ key: root.sourceKey, kind: root.kind, id: row.id }] : [];
  });
  for (const ref of stored ?? [])
    if (!roots.some((root) => root.id === ref.id && root.key === ref.key && root.kind === ref.kind))
      throw new ConflictError('Retained root mapping changed');
  const accepted = roots.map((root) => {
    const ref = stored?.find(
      (value) => value.key === root.key && value.id === root.id && value.kind === root.kind,
    );
    return { ...root, ...acceptedRootResolution(manifest, ref) };
  });
  if (accepted.reduce((count, root) => count + (root.resolvedManifest?.length ?? 0), 0) > 500)
    throw new ConflictError('Retained accepted closure exceeds its bound');
  if (accepted.reduce((count, root) => count + (root.selectedWork?.length ?? 0), 0) > 500)
    throw new ConflictError('Retained selected work exceeds its bound');
  return accepted;
}
function acceptedRootResolution(
  manifest: BlueprintInvocationManifest,
  ref: BlueprintOccurrenceRoot | undefined,
): Pick<BlueprintOccurrenceRoot, 'resolvedManifest' | 'selectedWork'> {
  if (!ref?.resolvedManifest) return {};
  const parsed = z.array(ResolvedVersionAtPath).min(1).max(500).safeParse(ref.resolvedManifest);
  if (!parsed.success) throw new ConflictError('Retained accepted closure is invalid');
  const selected = manifest.roots.find((root) => root.sourceKey === ref.key);
  const root = parsed.data.find((entry) => entry.path.length === 0);
  if (
    !selected ||
    root?.workTypeId !== selected.workTypeId ||
    root.versionId !== selected.workTypeVersionId ||
    new Set(parsed.data.map((entry) => JSON.stringify(entry.path))).size !== parsed.data.length
  )
    throw new ConflictError('Retained accepted closure differs from its original selection');
  return { resolvedManifest: parsed.data, ...acceptedRootWork(ref) };
}

function acceptedRootWork(
  ref: BlueprintOccurrenceRoot,
): Pick<BlueprintOccurrenceRoot, 'selectedWork'> {
  const rows = z
    .array(
      z.strictObject({
        path: z.array(z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)).max(499),
        kind: z.enum(['program', 'project', 'task', 'milestone']),
        id: z.string().min(1),
      }),
    )
    .min(1)
    .max(500)
    .optional()
    .safeParse(ref.selectedWork);
  if (!rows.success) throw new ConflictError('Retained selected work is invalid');
  if (
    rows.data &&
    (!rows.data.some(
      (row) => row.path.length === 0 && row.kind === ref.kind && row.id === ref.id,
    ) ||
      new Set(rows.data.map((row) => JSON.stringify(row.path))).size !== rows.data.length ||
      new Set(rows.data.map((row) => `${row.kind}:${row.id}`)).size !== rows.data.length)
  )
    throw new ConflictError('Retained selected work differs from its original root');
  return rows.data ? { selectedWork: rows.data } : {};
}
