/**
 * `@docket/api` — email-suggestions router (mounted at `/v1/orgs/:orgId/email-suggestions`).
 *
 * @remarks
 * Athena-synthesized task proposals drawn from email threads. A suggestion is NOT a task: it
 * sits in a triage lane until the user **accepts** (→ materializes a native task and attaches
 * the source email back to it) or **dismisses** it. Accept reuses the quick-capture landing
 * logic (default team, first workflow state, current cycle, caller as assignee) and emits a
 * `created` observation so the automation engine can react (e.g. archive the thread on accept).
 * See `docs/engineering/specs/email-to-task.md` §6.
 */
import { actor, attachment, db, emailSuggestion, task, team } from '@docket/db';
import {
  EmailSuggestionOut,
  SuggestionAcceptBody,
  SuggestionDismissed,
  pageOf,
} from '@docket/types';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError } from '../error';
import { resolveCurrentCycleId } from '../lib/current-cycle';
import { ok } from '../lib/ok';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { emitObservation } from './observation-emit';

type SuggestionRow = typeof emailSuggestion.$inferSelect;

const idParam = z.object({ id: z.string() });

/** The Gmail thread URL for a thread id. */
function threadUrl(threadId: string): string {
  return `https://mail.google.com/mail/#all/${threadId}`;
}

/** Project a suggestion row into its wire {@link EmailSuggestionOut} shape. */
function toOut(s: SuggestionRow): z.input<typeof EmailSuggestionOut> {
  return {
    id: s.id,
    organizationId: s.organizationId,
    integrationId: s.integrationId,
    externalThreadId: s.externalThreadId,
    title: s.title,
    description: s.description,
    dueDate: s.dueDate?.toISOString() ?? null,
    priority: s.priority,
    suggestedProjectId: s.suggestedProjectId,
    suggestedProgramId: s.suggestedProgramId,
    confidence: s.confidence,
    status: s.status,
    emailMeta: (s.emailMeta as z.input<typeof EmailSuggestionOut>['emailMeta']) ?? null,
    createdTaskId: s.createdTaskId,
    createdAt: s.createdAt.toISOString(),
  };
}

/** Load a pending, org-scoped suggestion or throw. */
async function loadPending(orgId: string, id: string): Promise<SuggestionRow> {
  const rows = await db
    .select()
    .from(emailSuggestion)
    .where(and(eq(emailSuggestion.id, id), eq(emailSuggestion.organizationId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Suggestion not found');
  if (row.status !== 'pending') throw new ConflictError('Suggestion already resolved');
  return row;
}

/** Email-suggestions router: list pending + accept (materialize task) + dismiss. */
const emailSuggestions = new Hono<AppEnv>()
  .get('/', async (c) => {
    const { orgId } = c.get('actorCtx');
    const rows = await db
      .select()
      .from(emailSuggestion)
      .where(and(eq(emailSuggestion.organizationId, orgId), eq(emailSuggestion.status, 'pending')))
      .orderBy(asc(emailSuggestion.createdAt));
    return ok(c, pageOf(EmailSuggestionOut), { items: rows.map(toOut) });
  })
  .post(
    '/:id/accept',
    capabilityGuard('contribute'),
    zParam(idParam),
    zJson(SuggestionAcceptBody),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const overrides = c.req.valid('json');
      const suggestion = await loadPending(orgId, id);

      // Land the materialized task exactly like quick-capture: oldest active team, its first
      // workflow state, caller as assignee, current cycle when the team has a live window.
      const teamRows = await db
        .select({ id: team.id, workflowStates: team.workflowStates })
        .from(team)
        .where(eq(team.organizationId, orgId))
        .orderBy(asc(team.createdAt))
        .limit(1);
      const teamRow = teamRows[0];
      if (!teamRow) throw new NotFoundError('No team to accept into');

      const assigneeRows = await db
        .select({ id: actor.id })
        .from(actor)
        .where(and(eq(actor.id, actorId), eq(actor.organizationId, orgId)))
        .limit(1);
      const assigneeId = assigneeRows[0]?.id ?? null;
      const cycleId = await resolveCurrentCycleId(orgId, teamRow.id);
      const state = teamRow.workflowStates[0]?.key ?? 'backlog';

      const dueDate = overrides.dueDate ?? suggestion.dueDate?.toISOString();

      const created = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(task)
          .values({
            organizationId: orgId,
            title: overrides.title ?? suggestion.title,
            description: overrides.description ?? suggestion.description,
            teamId: teamRow.id,
            state,
            priority: overrides.priority ?? suggestion.priority,
            assigneeId,
            cycleId,
            dueDate: dueDate ? new Date(dueDate) : undefined,
            source: 'native',
            createdBy: actorId,
          })
          .returning();
        const taskRow = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert always returns a row */
        if (!taskRow) throw new Error('accept task insert returned no row');

        // Attach the source email back to the new task (the email rides along as context).
        const meta = suggestion.emailMeta as { subject?: string } | null;
        await tx.insert(attachment).values({
          organizationId: orgId,
          createdBy: actorId,
          subjectType: 'task',
          subjectId: taskRow.id,
          kind: 'email',
          title: meta?.subject ?? suggestion.title,
          url: threadUrl(suggestion.externalThreadId),
          sourceIntegrationId: suggestion.integrationId,
          externalId: suggestion.externalThreadId,
          metadata: suggestion.emailMeta,
        });

        const updated = await tx
          .update(emailSuggestion)
          .set({ status: 'accepted', createdTaskId: taskRow.id })
          .where(and(eq(emailSuggestion.id, id), eq(emailSuggestion.organizationId, orgId)))
          .returning();
        const suggestionRow = updated[0];
        /* v8 ignore next -- @preserve defensive: loadPending proved the row exists */
        if (!suggestionRow) throw new NotFoundError('Suggestion not found');
        return { taskRow, suggestionRow };
      });

      // Emit a creation observation so automation rules can react to the accept.
      await emitObservation({
        organizationId: orgId,
        kind: 'created',
        actorId,
        title: created.taskRow.title,
        subject: { type: 'task', id: created.taskRow.id, title: created.taskRow.title },
        payload: { source: 'email_suggestion', threadId: suggestion.externalThreadId },
      });

      return ok(c, EmailSuggestionOut, toOut(created.suggestionRow));
    },
  )
  .post('/:id/dismiss', capabilityGuard('contribute'), zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    await loadPending(orgId, id);
    const updated = await db
      .update(emailSuggestion)
      .set({ status: 'dismissed' })
      .where(and(eq(emailSuggestion.id, id), eq(emailSuggestion.organizationId, orgId)))
      .returning();
    const row = updated[0];
    /* v8 ignore next -- @preserve defensive: loadPending proved the row exists */
    if (!row) throw new NotFoundError('Suggestion not found');
    return ok(c, SuggestionDismissed, { id: row.id, status: 'dismissed' });
  });

export default emailSuggestions;
