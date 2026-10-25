/** Trusted automated template Undo uses the same live execution checks as draft authoring. */
import { changeSet, changeSetEntry, db } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { CapabilityError } from '../error';
import type { McpActor, McpContext } from '../mcp/auth';
import { undoChangeSetAtomically, type UndoAccessCheck, type UndoOutcome } from '../mcp/change-set';
import { UndoInput } from '../mcp/undo-tools-contract';
import { isAutomatedTemplateContext, requireAutomatedTemplateAuthor } from './template-authority';

/**
 * Reverse automated template receipts atomically with current policy and exact human approval.
 * Ordinary work receipts and manual human MCP retain their existing Undo behavior.
 * @returns The checked template reversal, or null when the ordinary Undo path should handle it.
 */
export async function tryAutomatedTemplateUndo(
  ctx: McpContext,
  caller: McpActor,
  receiptId: string,
  input: unknown,
  guard: UndoAccessCheck,
): Promise<{ summary: string; outcomes: UndoOutcome[] } | null> {
  if (!isAutomatedTemplateContext(ctx)) return null;
  const [entry] = await db
    .select({ id: changeSetEntry.entityId })
    .from(changeSetEntry)
    .innerJoin(changeSet, eq(changeSet.id, changeSetEntry.changeSetId))
    .where(
      and(
        eq(changeSet.organizationId, caller.orgId),
        eq(changeSet.id, receiptId),
        eq(changeSetEntry.entityKind, 'template'),
      ),
    )
    .limit(1);
  if (!entry) return null;
  const reviewed = UndoInput.safeParse(input);
  if (!reviewed.success || reviewed.data.changeSetId !== receiptId) throw new CapabilityError();
  await requireAutomatedTemplateAuthor(ctx, caller, reviewed.data, db, 'undo');
  const checked: UndoAccessCheck = async (tx, entries) => {
    await requireAutomatedTemplateAuthor(ctx, caller, reviewed.data, tx, 'undo');
    await guard(tx, entries);
  };
  if (guard.templateCopyCaller)
    Object.assign(checked, { templateCopyCaller: guard.templateCopyCaller });
  return undoChangeSetAtomically(caller.orgId, receiptId, undefined, checked);
}
