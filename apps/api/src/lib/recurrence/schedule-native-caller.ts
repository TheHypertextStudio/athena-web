import {
  milestone,
  type BlueprintOccurrenceRoot,
  type recurrenceSeries,
  type recurrenceSeriesRevision,
} from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { ActorCtx } from '../../context';
import { CapabilityError, NotFoundError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import { loadCreationActor } from '../work-creation/context';
import { assertSharedWorkWritable } from '../../product-capability';
import { requireWorkAccess } from '../work-template-selection';
import type { BlueprintWorkRef } from '../work-template-blueprints/snapshot-types';
import { requireScheduleAccess } from './schedule-access';
import { assertNativeScheduleDestinations } from './schedule-native-destinations';
import type { ScheduleDocument } from './schedule-compiler';

/** Internal initiating-work binding; a person editing work does not gain its private schedule metadata. */
export interface NativeScheduleCallerRequest {
  readonly organizationId: string;
  readonly actorId?: string | undefined;
  readonly initiatingWork?: BlueprintWorkRef;
}
/** Require a foreground initiating identity to belong to the exact accepted actual receipt. */
export function assertNativeInitiatingWork(
  roots: readonly BlueprintOccurrenceRoot[],
  reference: BlueprintWorkRef,
): void {
  if (
    !roots.some(
      (root) =>
        (root.kind === reference.kind && root.id === reference.id) ||
        root.selectedWork?.some((work) => work.kind === reference.kind && work.id === reference.id),
    )
  )
    throw new CapabilityError();
}
async function requireForegroundWork(
  tx: TemplateTransaction,
  caller: ActorCtx,
  reference: BlueprintWorkRef,
): Promise<void> {
  if (reference.kind === 'milestone') {
    const [row] = await tx
      .select({ projectId: milestone.projectId })
      .from(milestone)
      .where(
        and(
          eq(milestone.organizationId, caller.orgId),
          eq(milestone.id, reference.id),
          isNull(milestone.archivedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundError('Work not found');
    return requireWorkAccess(tx, caller, 'project', row.projectId);
  }
  return requireWorkAccess(tx, caller, reference.kind, reference.id);
}
/** Existing foreground work uses its contributor; execution without an initiating row rechecks the saved owner. */
export async function resolveNativeScheduleCaller(
  tx: TemplateTransaction,
  rows: {
    readonly series: typeof recurrenceSeries.$inferSelect;
    readonly revision: typeof recurrenceSeriesRevision.$inferSelect;
    readonly document: ScheduleDocument;
    readonly roots: readonly BlueprintOccurrenceRoot[];
  },
  input: NativeScheduleCallerRequest,
): Promise<ActorCtx | null> {
  if (input.actorId && input.initiatingWork) {
    // The enclosing native factory checked the persisted receipt. Its creator
    // cannot revoke another contributor's independent rights over existing work.
    assertNativeInitiatingWork(rows.roots, input.initiatingWork);
    const contributor = await loadCreationActor(tx, input.organizationId, input.actorId);
    await requireForegroundWork(tx, contributor, input.initiatingWork);
    await assertSharedWorkWritable(input.organizationId, contributor.isPersonal, tx);
    return contributor;
  }
  const { series } = rows;
  let owner: ActorCtx | null = null;
  if (series.createdBy) {
    await requireScheduleAccess(
      tx,
      { organizationId: input.organizationId, actorId: series.createdBy, seriesId: series.id },
      'manage',
    );
    owner = await loadCreationActor(tx, input.organizationId, series.createdBy);
  } else {
    // The factory already checked this transaction's persisted applied native
    // claim. Existing work remains writable while paused; future execution keeps
    // its independent active-series guard in schedule-runtime.
    await assertSharedWorkWritable(input.organizationId, undefined, tx);
    await assertNativeScheduleDestinations(
      tx,
      input.organizationId,
      rows.document,
      series.ownerProgramId,
    );
  }
  if (!input.actorId) {
    if (input.initiatingWork) throw new CapabilityError();
    return owner;
  }
  const caller = await loadCreationActor(tx, input.organizationId, input.actorId);
  if (input.initiatingWork) {
    assertNativeInitiatingWork(rows.roots, input.initiatingWork);
    await requireForegroundWork(tx, caller, input.initiatingWork);
  } else
    await requireScheduleAccess(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      seriesId: series.id,
    });
  return caller;
}
