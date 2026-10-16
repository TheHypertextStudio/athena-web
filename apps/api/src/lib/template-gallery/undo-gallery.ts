import { workTemplateCopyBundle } from '@docket/db';
import { WorkTemplateCopyUndoResult } from '@docket/work/template-gallery-contract';
import { and, eq } from 'drizzle-orm';
import { NotFoundError } from '../../error';
import { undoChangeSet } from '../../mcp/change-set';
import { workScheduleUndoAccess } from '../recurrence/work-schedule-undo-access';
import { serializableTx } from '../serializable-tx';
import {
  loadTemplateCopyActor,
  type TemplateCopyPrincipal,
} from '../templates/copy-reservation-context';
import { reconcileTemplateGalleryCopy } from './acceptance';

/**
 * Resolve an actual acceptor-private bundle, then use the existing receipt Undo dispatcher.
 * @throws When current membership, bundle ownership or installed-copy authoring no longer permits Undo.
 */
export async function undoTemplateGalleryCopy(
  principal: TemplateCopyPrincipal,
  bundleId: string,
): Promise<WorkTemplateCopyUndoResult> {
  const bundle = await serializableTx(async (tx) => {
    const caller = await loadTemplateCopyActor(tx, principal, 'view');
    const [bound] = await tx
      .select({
        receiptId: workTemplateCopyBundle.receiptKey,
        requestId: workTemplateCopyBundle.requestId,
      })
      .from(workTemplateCopyBundle)
      .where(
        and(
          eq(workTemplateCopyBundle.organizationId, caller.orgId),
          eq(workTemplateCopyBundle.acceptingActorKey, caller.actorId),
          eq(workTemplateCopyBundle.id, bundleId),
        ),
      );
    if (!bound?.receiptId) throw new NotFoundError('Copy bundle not found');
    return { ...bound, receiptId: bound.receiptId };
  });
  const result = await undoChangeSet(
    principal.organizationId,
    bundle.receiptId,
    workScheduleUndoAccess({ orgId: principal.organizationId, userId: principal.userId }),
  );
  return WorkTemplateCopyUndoResult.parse({
    receipt: await reconcileTemplateGalleryCopy(principal, bundle.requestId),
    retained: result.outcomes
      .filter((outcome) => !outcome.reverted)
      .map((outcome) => ({
        workTypeId: outcome.id,
        reason: outcome.reason,
      })),
  });
}
