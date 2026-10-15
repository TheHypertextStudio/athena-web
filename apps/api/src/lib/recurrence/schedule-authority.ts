import { processOccurrence, recurrenceSeries, recurrenceSeriesRevision } from '@docket/db';
import { AcceptedScheduleClaim, type AcceptedScheduleRoot } from '@docket/work/work-schedule-claim';
import { WorkScheduleRevisionFallback } from '@docket/work/work-schedule-fallback';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { CapabilityError, ConflictError, NotFoundError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import type { OrdinaryWorkCommand, WorkCreationBatchCommand } from '../work-creation/types';
import { authorizeRetainedRecurrence, loadCreationActor } from '../work-creation/context';
import { requireWorkAccess } from '../work-template-selection';
import {
  compileScheduleCommand,
  parseScheduleDocument,
  scheduleDocumentRoots,
  scheduleDraftFingerprint,
  type ScheduleDocument,
} from './schedule-compiler';
import { requireScheduleAccess } from './schedule-access';
import { blueprintFingerprint } from '../work-template-blueprints/fingerprint';
import type { PlannedWorkTree } from '@docket/work/blueprints';

/** Opaque transaction-registered native root capability; JSON cannot reproduce its authority. */
export interface ScheduleRootBinding {
  readonly proof: object;
}
interface BoundRoot {
  readonly tx: TemplateTransaction;
  readonly organizationId: string;
  readonly actorId: string | null;
  readonly root: AcceptedScheduleRoot;
  readonly signature: string;
}
function bindingSignature(command: OrdinaryWorkCommand): string {
  const body = Object.fromEntries(
    Object.entries(command.body).filter(
      ([key]) => !['startDate', 'dueDate', 'targetDate'].includes(key),
    ),
  );
  return blueprintFingerprint({
    body,
    draft: command.invocation.scheduleContext?.draft,
    runDate: command.invocation.scheduleContext?.runDate,
    optionalChoices: command.blueprint?.optionalChoices ?? [],
  });
}
function assertExecutable(
  row: {
    readonly series: typeof recurrenceSeries.$inferSelect;
    readonly occurrence: typeof processOccurrence.$inferSelect;
  },
  attempt: number,
): void {
  if (
    row.series.status !== 'active' ||
    row.series.archivedAt ||
    row.occurrence.attempt !== attempt ||
    row.occurrence.blueprintAppliedAt ||
    ['canceled', 'skipped', 'completed'].includes(row.occurrence.status)
  )
    throw new ConflictError('The schedule attempt is no longer executable.');
}
const bindings = new WeakMap<ScheduleRootBinding, BoundRoot>();
function bindCommand(
  tx: TemplateTransaction,
  command: WorkCreationBatchCommand,
  roots: readonly AcceptedScheduleRoot[],
): WorkCreationBatchCommand {
  return {
    ...command,
    roots: command.roots.map((entry) => {
      const root = roots.find((value) => value.key === entry.key);
      if (!root) throw new CapabilityError();
      const binding = Object.freeze({ proof: {} });
      bindings.set(binding, {
        tx,
        organizationId: entry.command.caller.orgId,
        actorId: entry.command.caller.actorId,
        root,
        signature: bindingSignature(entry.command),
      });
      return {
        ...entry,
        command: {
          ...entry.command,
          invocation: { ...entry.command.invocation, scheduleBinding: binding },
        },
      };
    }),
  };
}
/** Require the exact live transaction, caller and accepted immutable publication selection. */
export function requireScheduleRootBinding(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
): AcceptedScheduleRoot | undefined {
  const binding = command.invocation.scheduleBinding;
  if (!binding) return undefined;
  const checked = bindings.get(binding);
  if (
    checked?.tx !== tx ||
    checked.organizationId !== command.caller.orgId ||
    checked.actorId !== command.caller.actorId ||
    checked.root.kind !== command.kind ||
    checked.root.workTypeId !== command.body.workTypeId ||
    checked.root.versionId !== command.body.workTypeVersionId ||
    checked.signature !== bindingSignature(command)
  )
    throw new CapabilityError();
  return checked.root;
}
/** Refuse changed selected work or publications after registering an exact persisted root capability. */
export function assertSchedulePlanBinding(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  tree: PlannedWorkTree,
): void {
  const root = requireScheduleRootBinding(tx, command);
  if (!root) return;
  const sorted = <T extends { readonly path: readonly string[] }>(entries: readonly T[]) =>
    [...entries].sort((a, b) => JSON.stringify(a.path).localeCompare(JSON.stringify(b.path)));
  const paths = tree.nodes.map((node) => ({ path: node.path, kind: node.kind }));
  if (
    blueprintFingerprint(sorted(paths)) !== blueprintFingerprint(sorted(root.selectedPaths)) ||
    blueprintFingerprint(sorted(tree.manifest)) !==
      blueprintFingerprint(sorted(root.resolvedManifest))
  )
    throw new CapabilityError();
}
/** Checked command identity for a persisted occurrence's current reserved attempt. */
export interface ScheduleAttemptIdentity {
  readonly organizationId: string;
  readonly occurrenceId: string;
  readonly attempt: number;
}
async function loadScheduleAttempt(tx: TemplateTransaction, identity: ScheduleAttemptIdentity) {
  const where = and(
    eq(processOccurrence.id, identity.occurrenceId),
    eq(processOccurrence.organizationId, identity.organizationId),
  );
  const [snapshot] = await tx.select().from(processOccurrence).where(where).limit(1);
  if (snapshot?.runKind !== 'scheduled' || !snapshot.seriesId || !snapshot.seriesRevisionId)
    throw new NotFoundError('Schedule run not found');
  // Every native path takes the same series → revision → occurrence locks.
  const [series] = await tx
    .select()
    .from(recurrenceSeries)
    .where(
      and(
        eq(recurrenceSeries.id, snapshot.seriesId),
        eq(recurrenceSeries.organizationId, identity.organizationId),
      ),
    )
    .for('update')
    .limit(1);
  const [revision] = await tx
    .select()
    .from(recurrenceSeriesRevision)
    .where(
      and(
        eq(recurrenceSeriesRevision.id, snapshot.seriesRevisionId),
        eq(recurrenceSeriesRevision.seriesId, snapshot.seriesId),
        eq(recurrenceSeriesRevision.organizationId, identity.organizationId),
      ),
    )
    .for('update')
    .limit(1);
  const [occurrence] = await tx
    .select()
    .from(processOccurrence)
    .where(where)
    .for('update')
    .limit(1);
  if (
    !series ||
    !revision ||
    occurrence?.runKind !== 'scheduled' ||
    occurrence.seriesId !== series.id ||
    occurrence.seriesRevisionId !== revision.id
  )
    throw new NotFoundError('Schedule run not found');
  return { series, revision, occurrence };
}
/** Load only persisted scheduled authority and reconstruct an exact private command on this transaction. */
export async function authorizeScheduleExecution(
  tx: TemplateTransaction,
  identity: ScheduleAttemptIdentity,
): Promise<WorkCreationBatchCommand> {
  const row = await loadScheduleAttempt(tx, identity);
  assertExecutable(row, identity.attempt);
  const document = parseScheduleDocument(row.revision.scheduleDraft);
  const claim = AcceptedScheduleClaim.parse(row.occurrence.acceptedClaim);
  if (
    claim.seriesRevisionId !== row.revision.id ||
    claim.sourceInvocationId !== row.revision.blueprintInvocationId ||
    claim.draftFingerprint !== scheduleDraftFingerprint(document)
  )
    throw new CapabilityError();
  const caller = row.series.createdBy
    ? await loadCreationActor(tx, identity.organizationId, row.series.createdBy)
    : await authorizeRetainedRecurrence(tx, identity.organizationId, {
        seriesId: row.series.id,
        revisionId: row.revision.id,
      });
  if (row.series.ownerProgramId && !('kind' in caller))
    await requireWorkAccess(tx, caller, 'program', row.series.ownerProgramId);
  // Compile with a real persisted owner. Nullable attribution retains the established registered authority.
  const command = compileScheduleCommand({
    caller,
    seriesId: row.series.id,
    ownerProgramId: row.series.ownerProgramId,
    document,
    runDate: row.occurrence.scheduledFor,
    acceptedRoots: claim.roots,
  });
  return bindCommand(tx, command, claim.roots);
}

/** Resolve archive continuity only from the newest accepted full same-revision closure or persisted fallback. */
export async function authorizeScheduleContinuity(
  tx: TemplateTransaction,
  input: {
    readonly organizationId: string;
    readonly seriesRevisionId: string;
    readonly runDate: string;
  },
): Promise<WorkCreationBatchCommand> {
  const [row] = await tx
    .select({ series: recurrenceSeries, revision: recurrenceSeriesRevision })
    .from(recurrenceSeriesRevision)
    .innerJoin(
      recurrenceSeries,
      and(
        eq(recurrenceSeries.id, recurrenceSeriesRevision.seriesId),
        eq(recurrenceSeries.organizationId, input.organizationId),
      ),
    )
    .where(
      and(
        eq(recurrenceSeriesRevision.id, input.seriesRevisionId),
        eq(recurrenceSeriesRevision.organizationId, input.organizationId),
      ),
    )
    .for('update')
    .limit(1);
  if (row?.series.status !== 'active' || row.series.archivedAt)
    throw new NotFoundError('Schedule not found');
  const document = parseScheduleDocument(row.revision.scheduleDraft);
  const roots = await readContinuityRoots(tx, row.revision);
  const caller = row.series.createdBy
    ? await loadCreationActor(tx, input.organizationId, row.series.createdBy)
    : await authorizeRetainedRecurrence(tx, input.organizationId, {
        seriesId: row.series.id,
        revisionId: row.revision.id,
      });
  if (row.series.ownerProgramId && !('kind' in caller))
    await requireWorkAccess(tx, caller, 'program', row.series.ownerProgramId);
  return bindCommand(
    tx,
    compileScheduleCommand({
      caller,
      seriesId: row.series.id,
      ownerProgramId: row.series.ownerProgramId,
      runDate: input.runDate,
      document,
      acceptedRoots: roots,
    }),
    roots,
  );
}
async function readContinuityRoots(
  tx: TemplateTransaction,
  revision: typeof recurrenceSeriesRevision.$inferSelect,
): Promise<AcceptedScheduleRoot[]> {
  const document = parseScheduleDocument(revision.scheduleDraft);
  const [latest] = await tx
    .select({ claim: processOccurrence.acceptedClaim })
    .from(processOccurrence)
    .where(
      and(
        eq(processOccurrence.organizationId, revision.organizationId),
        eq(processOccurrence.runKind, 'scheduled'),
        eq(processOccurrence.seriesRevisionId, revision.id),
        isNotNull(processOccurrence.acceptedClaim),
      ),
    )
    .orderBy(desc(processOccurrence.acceptanceOrdinal))
    .limit(1);
  const retained = latest
    ? AcceptedScheduleClaim.parse(latest.claim)
    : WorkScheduleRevisionFallback.parse(revision.authoringFallback);
  if (
    retained.seriesRevisionId !== revision.id ||
    retained.sourceInvocationId !== revision.blueprintInvocationId ||
    retained.draftFingerprint !== scheduleDraftFingerprint(document)
  )
    throw new CapabilityError();
  return retained.roots;
}

function unchangedArchivedSelection(before: ScheduleDocument, after: ScheduleDocument): void {
  const prior = scheduleDocumentRoots(before);
  const next = scheduleDocumentRoots(after);
  if (prior.length !== next.length)
    throw new ConflictError('Choose live templates when changing the schedule structure.');
  for (const selected of next) {
    const original = prior.find((root) => root.key === selected.key);
    if (
      !original ||
      JSON.stringify(original.draft.template) !== JSON.stringify(selected.draft.template) ||
      JSON.stringify(original.draft.optionalChoices) !==
        JSON.stringify(selected.draft.optionalChoices)
    )
      throw new ConflictError('Choose live templates when changing the schedule selection.');
  }
}
/** Continue an existing private revision edit through its persisted exact archived closure, never client data. */
export async function authorizeScheduleRevisionContinuity(
  tx: TemplateTransaction,
  input: {
    readonly organizationId: string;
    readonly actorId: string;
    readonly seriesId: string;
    readonly expectedRevisionId: string;
    readonly document: ScheduleDocument;
    readonly runDate: string;
  },
): Promise<WorkCreationBatchCommand> {
  const { series } = await requireScheduleAccess(tx, input, 'manage');
  const [revision] = await tx
    .select()
    .from(recurrenceSeriesRevision)
    .where(
      and(
        eq(recurrenceSeriesRevision.id, input.expectedRevisionId),
        eq(recurrenceSeriesRevision.seriesId, series.id),
        eq(recurrenceSeriesRevision.organizationId, input.organizationId),
      ),
    )
    .for('update')
    .limit(1);
  if (!revision) throw new NotFoundError('Schedule revision not found');
  const document = parseScheduleDocument(input.document);
  unchangedArchivedSelection(parseScheduleDocument(revision.scheduleDraft), document);
  const roots = await readContinuityRoots(tx, revision);
  const caller = await loadCreationActor(tx, input.organizationId, input.actorId);
  return bindCommand(
    tx,
    compileScheduleCommand({
      caller,
      seriesId: series.id,
      ownerProgramId: series.ownerProgramId,
      document,
      runDate: input.runDate,
      acceptedRoots: roots,
    }),
    roots,
  );
}
