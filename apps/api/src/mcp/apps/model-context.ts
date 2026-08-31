/**
 * `@docket/api` — durable `ui/update-model-context` storage for rendered MCP app cards.
 *
 * @remarks
 * The MCP Apps extension lets a rendered view hand the host context "to be included in the
 * model's context for future turns", with each update overwriting the last. Docket stores the
 * latest update on the activity row the card lives on (`body.action.result.modelContext`) and
 * folds every not-yet-delivered update into the NEXT user turn, enveloped as third-party text —
 * a widget speaks about the conversation, never with the principal's authority.
 */
import { sessionActivity } from '@docket/db';
import { and, eq } from 'drizzle-orm';

import type { DbHandle } from '../../agent/transcript';

/** One undelivered widget context update, ready for the provenance envelope. */
export interface PendingWidgetModelContext {
  /** The combined text + structured content the widget posted. */
  readonly text: string;
  /** Human-readable identity of the widget, for the envelope's attribution. */
  readonly origin: string;
}

/**
 * Collect the session's undelivered widget model-context updates and mark them delivered.
 *
 * @remarks
 * Called inside the same transaction that appends the user's turn, so a crash cannot deliver a
 * context twice or lose one: the delivered flag and the transcript turn land atomically. An
 * update posted after this read simply rides the following turn — the extension's "future
 * turns" promise, not a same-turn one.
 *
 * @param handle - The transaction the reply write runs in.
 * @param sessionId - The session whose cards may have posted context.
 * @returns each pending update with its attribution, oldest first.
 */
export async function takePendingWidgetModelContexts(
  handle: DbHandle,
  sessionId: string,
): Promise<PendingWidgetModelContext[]> {
  const rows = await handle
    .select()
    .from(sessionActivity)
    .where(and(eq(sessionActivity.sessionId, sessionId), eq(sessionActivity.type, 'action')))
    .orderBy(sessionActivity.id);
  const pending: PendingWidgetModelContext[] = [];
  for (const row of rows) {
    const action = row.body.action;
    const result = action?.result;
    const context = result?.modelContext;
    if (!action || !result || !context || result.modelContextDelivered === true) continue;
    const presentation = result.presentation;
    const origin = presentation
      ? `${presentation.serverName} app (${presentation.tool})`
      : 'a connected app';
    const parts = [context.text];
    if (context.structuredContent) parts.push(JSON.stringify(context.structuredContent));
    pending.push({ text: parts.filter((part) => part.length > 0).join('\n'), origin });
    await handle
      .update(sessionActivity)
      .set({
        body: {
          ...row.body,
          action: { ...action, result: { ...result, modelContextDelivered: true } },
        },
      })
      .where(eq(sessionActivity.id, row.id));
  }
  return pending;
}
