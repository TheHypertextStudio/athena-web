import type { McpActor } from './auth';
import { isOwnTemplateCopyChangeSet } from '../lib/template-gallery/undo';
import { requireTemplateUndoAuthor } from '../lib/templates/service';
import { authorize } from './result';

/**
 * Preserve ordinary MCP Undo gates while letting a terminal copy replay under current View rights.
 * Installed copies independently require live authoring inside the specialized atomic reversal.
 */
export async function requireUndoReceiptAccess(caller: McpActor, receiptId: string): Promise<void> {
  const copied = await isOwnTemplateCopyChangeSet(caller, receiptId);
  await authorize(caller, copied ? 'view' : 'contribute', {
    kind: 'organization',
    id: caller.orgId,
    orgId: caller.orgId,
  });
  await requireTemplateUndoAuthor(caller, receiptId);
}
