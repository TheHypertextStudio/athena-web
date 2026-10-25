/** Conversion receipts use the existing atomic Undo engine with current private human authority. */
import type { changeSet } from '@docket/db';
import { TemplateTargetType } from '@docket/work/template-contract';
import type { Tx, UndoAccessCheck } from '../../mcp/change-set';
import type { StoredEntry } from '../../mcp/change-set-companions';
import { NotFoundError, ConflictError } from '../../error';
import { templateCopyUndoContext } from '../template-gallery/undo-context';
import { requireTemplateAuthor } from '../templates/authorization';
import { requireWorkAccess } from '../work-template-selection';

type Receipt = Pick<typeof changeSet.$inferSelect, 'origin' | 'actorId' | 'templateReviewActorId'>;
/** Existing protected companions and explicit conversion receipts reverse as a single transaction. */
export function requiresAtomicWorkUndo(
  origin: Receipt['origin'],
  entries: readonly StoredEntry[],
): boolean {
  return (
    origin.tool === 'label_template_conversion' ||
    entries.some((entry) =>
      [
        'native_schedule_date_ownership',
        'retained_date_ownership',
        'program_default_schedule',
      ].includes(entry.entityKind),
    )
  );
}
function checkedConversionEntries(entries: readonly StoredEntry[]) {
  const work = entries.flatMap((entry) => {
    const kind = TemplateTargetType.safeParse(entry.entityKind);
    return kind.success ? [{ ...entry, kind: kind.data }] : [];
  });
  if (!work.length || work.length > 100 || entries.length !== work.length * 2)
    throw new ConflictError('Conversion can no longer be undone.');
  for (const entry of work) {
    if (
      entry.op !== 'update' ||
      !entries.some(
        (label) =>
          label.entityKind === `${entry.kind}_labels` &&
          label.entityId === entry.entityId &&
          label.op === 'update',
      )
    )
      throw new ConflictError('Conversion can no longer be undone.');
  }
  return work;
}
/** Receipt attribution never identifies the caller; ordinary unrelated receipt behavior stays unchanged. */
export async function requireLabelConversionUndo(
  tx: Tx,
  orgId: string,
  receipt: Receipt,
  entries: readonly StoredEntry[],
  guard?: UndoAccessCheck,
): Promise<void> {
  if (receipt.origin.tool !== 'label_template_conversion') return;
  const caller = guard?.templateCopyCaller;
  if (caller?.orgId !== orgId) throw new NotFoundError();
  const { actor } = await templateCopyUndoContext(tx, caller);
  if (actor.actorId !== receipt.actorId || receipt.templateReviewActorId !== actor.actorId)
    throw new NotFoundError();
  await requireTemplateAuthor({ orgId, actorId: actor.actorId }, tx);
  for (const entry of checkedConversionEntries(entries))
    await requireWorkAccess(tx, actor, entry.kind, entry.entityId);
}
