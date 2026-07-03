/**
 * `@docket/api` — the shared suggestion-accept mutation (suggestion → task + attachment).
 *
 * @remarks
 * One implementation of "materialize a suggestion into a task" shared by the HTTP accept
 * route and the `suggestion.autoAccept` automation action, so the landing logic, the email
 * attachment, and the emitted event can never diverge. Landing reuses the quick-capture
 * resolver (oldest active team, first workflow state, current cycle, actor as assignee).
 * Outcomes are data (a discriminated union), not HTTP errors — the route maps them to
 * status codes; the automation handler maps non-accepted outcomes to logged no-ops.
 */
import { attachment, db, emailSuggestion, task } from '@docket/db';
import { EmailSuggestionMeta, type SuggestionAcceptBody } from '@docket/types';

import { and, eq } from 'drizzle-orm';

import { resolveLandingTarget } from '../task-landing';
import { emitEvent } from '../../routes/event-emit';

/** The selected `email_suggestion` row shape. */
export type SuggestionRow = typeof emailSuggestion.$inferSelect;
/** The selected `task` row shape. */
type TaskRow = typeof task.$inferSelect;

/** Input to {@link acceptSuggestion}. */
export interface AcceptSuggestionInput {
  readonly organizationId: string;
  readonly suggestionId: string;
  /** The accepting actor: task creator, event actor, and landing assignee. */
  readonly actorId: string;
  /** Accept-time field overrides (title/description/priority/dueDate). */
  readonly overrides: SuggestionAcceptBody;
}

/** The outcome of one accept attempt — data, mapped to HTTP/no-op by each caller. */
export type AcceptSuggestionResult =
  | { readonly kind: 'accepted'; readonly taskRow: TaskRow; readonly suggestionRow: SuggestionRow }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'already_resolved' }
  | { readonly kind: 'no_team' };

/**
 * The suggestion's provider-captured thread URL, from its ingest-time meta snapshot.
 *
 * @remarks
 * Ingest always stamps `externalUrl` (and migration 0016 backfilled legacy rows), so an
 * absent URL is a data-integrity bug — loud, never papered over with a fabricated provider
 * URL (the app layer doesn't know provider URL shapes; see `mail-providers.md` §3).
 */
export function sourceUrlOf(suggestion: SuggestionRow): string {
  const meta = EmailSuggestionMeta.safeParse(suggestion.emailMeta);
  const url = meta.success ? meta.data.externalUrl : undefined;
  if (url === undefined) {
    throw new Error(
      `email_suggestion ${suggestion.id} has no emailMeta.externalUrl (expected from ingest/backfill)`,
    );
  }
  return url;
}

/**
 * Materialize a pending suggestion into a native task with its source email attached.
 *
 * @param input - The org-scoped suggestion, the accepting actor, and field overrides.
 * @returns the outcome; on `accepted`, the created task row and the updated suggestion row.
 */
export async function acceptSuggestion(
  input: AcceptSuggestionInput,
): Promise<AcceptSuggestionResult> {
  const rows = await db
    .select()
    .from(emailSuggestion)
    .where(
      and(
        eq(emailSuggestion.id, input.suggestionId),
        eq(emailSuggestion.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  const suggestion = rows[0];
  if (!suggestion) return { kind: 'not_found' };
  if (suggestion.status !== 'pending') return { kind: 'already_resolved' };

  // Land the materialized task exactly like quick-capture (shared resolver): oldest active
  // team, its first workflow state, caller as assignee, current cycle when one covers today.
  const landing = await resolveLandingTarget(input.organizationId, input.actorId);
  if (!landing) return { kind: 'no_team' };

  const overrides = input.overrides;
  const dueDate = overrides.dueDate
    ? new Date(overrides.dueDate)
    : (suggestion.dueDate ?? undefined);

  const created = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(task)
      .values({
        organizationId: input.organizationId,
        title: overrides.title ?? suggestion.title,
        description: overrides.description ?? suggestion.description,
        teamId: landing.teamId,
        state: landing.state,
        priority: overrides.priority ?? suggestion.priority,
        assigneeId: landing.assigneeId,
        cycleId: landing.cycleId,
        dueDate,
        source: 'native',
        createdBy: input.actorId,
      })
      .returning();
    const taskRow = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
    if (!taskRow) throw new Error('accept task insert returned no row');

    // Attach the source email back to the new task (the email rides along as context).
    const meta = suggestion.emailMeta as { subject?: string } | null;
    await tx.insert(attachment).values({
      organizationId: input.organizationId,
      createdBy: input.actorId,
      subjectType: 'task',
      subjectId: taskRow.id,
      kind: 'email',
      title: meta?.subject ?? suggestion.title,
      url: sourceUrlOf(suggestion),
      sourceIntegrationId: suggestion.integrationId,
      externalId: suggestion.externalThreadId,
      metadata: suggestion.emailMeta,
    });

    const updated = await tx
      .update(emailSuggestion)
      .set({ status: 'accepted', createdTaskId: taskRow.id })
      .where(
        and(
          eq(emailSuggestion.id, input.suggestionId),
          eq(emailSuggestion.organizationId, input.organizationId),
        ),
      )
      .returning();
    const suggestionRow = updated[0];
    /* v8 ignore next -- @preserve defensive: the select above proved the row exists */
    if (!suggestionRow) throw new Error('accept suggestion update returned no row');
    return { taskRow, suggestionRow };
  });

  // Emit a creation event so automation rules can react to the accept.
  await emitEvent({
    organizationId: input.organizationId,
    kind: 'created',
    actorId: input.actorId,
    title: created.taskRow.title,
    subject: { type: 'task', id: created.taskRow.id, title: created.taskRow.title },
  });

  return { kind: 'accepted', ...created };
}
