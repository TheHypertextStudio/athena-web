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
import { db, emailSuggestion, integration } from '@docket/db';
import { EmailSuggestionOut, EmailThreadOut, SuggestionDisposition, pageOf } from '@docket/types';
import type { MailThread } from '@docket/integrations';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError } from '../error';
import { acceptSuggestion } from '../lib/email-to-task/accept';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { asConnectorProvider, connectorFor, resolveConnectorToken } from './integration-provider';

type SuggestionRow = typeof emailSuggestion.$inferSelect;

const idParam = z.object({ id: z.string() });

/** Project a fetched {@link MailThread} into its wire {@link EmailThreadOut} shape. */
function toThreadOut(thread: MailThread): z.input<typeof EmailThreadOut> {
  return {
    threadId: thread.threadId,
    subject: thread.subject,
    externalUrl: thread.externalUrl,
    messages: thread.messages.map((m) => ({
      id: m.id,
      from: m.from,
      to: [...m.to],
      subject: m.subject,
      snippet: m.snippet,
      sentAt: m.sentAt,
      rfc822MessageId: m.rfc822MessageId ?? null,
      bodyHtml: m.bodyHtml ?? null,
    })),
  };
}

/** Load an org-scoped suggestion in any status, or throw. */
async function loadAny(orgId: string, id: string): Promise<SuggestionRow> {
  const rows = await db
    .select()
    .from(emailSuggestion)
    .where(and(eq(emailSuggestion.id, id), eq(emailSuggestion.organizationId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Suggestion not found');
  return row;
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

/** Email-suggestions router: list pending + thread preview + the accept/dismiss decision. */
const emailSuggestions = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Suggestions',
      summary: 'List pending email suggestions',
      response: pageOf(EmailSuggestionOut),
      description: `List the org's **pending** email suggestions, oldest-first, as a page of {@link EmailSuggestionOut}. Resolved ones — accepted, dismissed, expired — are deliberately absent: this is a queue to work through, not a history, and a decided suggestion has nothing left to decide.

Each item carries the synthesized draft (title, description, priority, due date, suggested project/program), a \`confidence\` score, and an \`emailMeta\` snapshot of the source message captured at ingest so a client can render the row without a provider round-trip. Fetch \`GET /{id}/thread\` only when a reviewer opens one. Org membership suffices to read.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const rows = await db
        .select()
        .from(emailSuggestion)
        .where(
          and(eq(emailSuggestion.organizationId, orgId), eq(emailSuggestion.status, 'pending')),
        )
        .orderBy(asc(emailSuggestion.createdAt));
      return ok(c, pageOf(EmailSuggestionOut), { items: rows.map(toOut) });
    },
  )
  .get(
    '/:id/thread',
    apiDoc({
      tag: 'Suggestions',
      summary: 'Read a suggestion’s source email thread',
      response: EmailThreadOut,
      description: `Fetch the source email thread behind a suggestion, live from the mail provider, as {@link EmailThreadOut} — the triage preview a reviewer reads before deciding.

Message **bodies are never persisted**. Only the \`emailMeta\` snapshot is stored, and the full thread is fetched on demand and held nowhere, so a workspace's mail does not accumulate inside Docket. That is why this is a separate request rather than a field on the list rows.

Works for a suggestion in any status, so an accepted task can still be traced back to the conversation that produced it. If the connector's grant has expired the response is 409 with a reconnect message rather than a hard failure — the suggestion is fine, the credential is not. A connector with no mail capability, or one that has gone missing, is 409/404 respectively. Org membership suffices.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const suggestion = await loadAny(orgId, id);

      const integrations = await db
        .select()
        .from(integration)
        .where(
          and(eq(integration.id, suggestion.integrationId), eq(integration.organizationId, orgId)),
        )
        .limit(1);
      const integ = integrations[0];
      if (!integ) throw new NotFoundError('Source integration not found');
      const provider = asConnectorProvider(integ.provider);
      if (!provider || !integ.createdBy) throw new NotFoundError('Source integration not usable');

      const token = await resolveConnectorToken(integ.createdBy, provider, integ.externalAccountId);
      // 409: the grant expired — the client surfaces a reconnect prompt, not a hard failure.
      if (!token.ok) throw new ConflictError(token.message);
      const mail = connectorFor(provider, token.token).asMailActor?.();
      if (!mail) throw new ConflictError(`${provider} has no mail capability`);

      const thread = await mail.fetchThread({
        connectionId: integ.id,
        threadId: suggestion.externalThreadId,
      });
      return ok(c, EmailThreadOut, toThreadOut(thread));
    },
  )
  .put(
    '/:id/disposition',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Suggestions',
      summary: 'Decide a pending email suggestion',
      capability: 'contribute',
      response: EmailSuggestionOut,
      description: `Record the reviewer's decision on a pending suggestion and return the resolved {@link EmailSuggestionOut}, whose \`status\` is now \`accepted\` or \`dismissed\` and whose \`createdTaskId\` names the task when one was made.

\`decision: "accepted"\` materializes the suggestion into a real task through the same path the \`suggestion.autoAccept\` automation action uses, so a rule and a person produce identical results. Send \`overrides\` to correct the synthesized draft first — title, description, priority, due date — and omitted fields keep what Athena proposed. \`decision: "dismissed"\` closes the suggestion and writes nothing to the workspace.

A suggestion carries exactly one disposition, which is why this is a \`PUT\` to the decision rather than a \`POST\` to a verb: the decision is a value the resource holds, and re-sending the same one names the same end state. Deciding a suggestion that is no longer pending is 409 (\`Suggestion already resolved\`), and accepting with no team to accept into is 404.

Requires \`contribute\`. A suggestion is a proposal until a person acting under their own capability turns it into work. Related: \`GET /{id}/thread\` to read the source email before deciding.`,
    }),
    zParam(idParam),
    zJson(SuggestionDisposition),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { decision, overrides } = c.req.valid('json');

      if (decision === 'dismissed') {
        await loadPending(orgId, id);
        const updated = await db
          .update(emailSuggestion)
          .set({ status: 'dismissed' })
          .where(and(eq(emailSuggestion.id, id), eq(emailSuggestion.organizationId, orgId)))
          .returning();
        const row = updated[0];
        /* v8 ignore next -- @preserve defensive: loadPending proved the row exists */
        if (!row) throw new NotFoundError('Suggestion not found');
        return ok(c, EmailSuggestionOut, toOut(row));
      }

      // Shared with the suggestion.autoAccept automation action — one materialization path.
      const result = await acceptSuggestion({
        organizationId: orgId,
        suggestionId: id,
        actorId,
        overrides: overrides ?? {},
      });
      if (result.kind === 'not_found') throw new NotFoundError('Suggestion not found');
      if (result.kind === 'already_resolved')
        throw new ConflictError('Suggestion already resolved');
      if (result.kind === 'no_team') throw new NotFoundError('No team to accept into');

      return ok(c, EmailSuggestionOut, toOut(result.suggestionRow));
    },
  );

export default emailSuggestions;
