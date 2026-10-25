import { undoChangeSet } from '../../mcp/change-set';
import { workScheduleUndoAccess } from '../recurrence/work-schedule-undo-access';
import { reconcileLabelTemplateConversion } from './service';
import type { ConversionReviewer } from './review';

/** Reverse the exact private confirmed batch through the existing atomic receipt engine. */
export async function undoLabelTemplateConversion(caller: ConversionReviewer, requestId: string) {
  const original = await reconcileLabelTemplateConversion(caller, requestId);
  if (original.state === 'undone') return original;
  try {
    await undoChangeSet(
      caller.orgId,
      original.changeSetId,
      workScheduleUndoAccess({ orgId: caller.orgId, userId: caller.userId }),
    );
  } catch (failure) {
    const checked = await reconcileLabelTemplateConversion(caller, requestId);
    if (checked.state === 'undone') return checked;
    throw failure;
  }
  return reconcileLabelTemplateConversion(caller, requestId);
}
