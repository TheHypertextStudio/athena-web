/**
 * `@docket/api` — the Linear **Agent** platform webhook receiver (mounted OUTSIDE the RPC
 * `AppType`, alongside `ingest.ts`).
 *
 * @remarks
 * `POST /internal/ingest/linear-agent` receives Linear's `AgentSessionEvent` deliveries
 * (`created` when a human `@mentions`/delegates work to Athena; `prompted` on a follow-up
 * message on an already-open session). Structurally this mirrors `ingest.ts` — raw-body-first,
 * verify-before-parse, route by workspace id, non-RPC mount, always ACK 200 short of a signature
 * failure — but it is deliberately its OWN handler rather than a third case bolted onto
 * `ingest.ts`'s `Observer`/`inbound_event` pipeline: that pipeline is async and cron-drained,
 * the wrong latency profile for what Linear's Agent platform requires (see below), and an agent
 * session is a categorically different kind of event (an inbound *delegation* to act on, not an
 * activity-feed item to mirror).
 *
 * **The load-bearing constraint this whole file is designed around**: `apps/api` deploys to
 * Cloud Run with `--min-instances=0` and no `--no-cpu-throttling`, so CPU is throttled to
 * near-zero the instant this handler's HTTP response is sent. A "fire-and-forget" background
 * task started here would not reliably run. This handler therefore does its work SYNCHRONOUSLY
 * and never calls `driveSession` (the actual LLM turn) — it does the minimum durable bookkeeping
 * a later, separate cron-driven slice needs to pick the work up: creating/finding the session,
 * calling `agentSessionUpdate` (Linear requires an external URL attached within 10 seconds of
 * session creation — this is the one synchronous outbound call this handler makes), and queuing
 * an `agent_session_run` row with `status: 'queued'`.
 *
 * **Design decision — where a `prompted` reply's text is recorded**: `postReplyAndResume`
 * (`agent-session-runner.ts`) is the codebase's existing "human replied, keep the turn going"
 * sequence, but it ends by calling `driveSession` synchronously, which this handler cannot do.
 * Rather than leave the raw reply text sitting unattached on the `agent_session_run` row (which
 * has no free-form payload column, and would need one), this handler calls the new
 * `recordInboundReply` — the exact same "insert the `response` activity + append the transcript
 * turn + reopen the session" write `postReplyAndResume` performs, extracted so it can be called
 * without also invoking `driveSession`. The reply is therefore FULLY APPLIED to the session by
 * the time this handler ACKs; the future cron sweep's job for a `prompted` delivery is just to
 * call `driveSession(orgId, sessionId)` on the session this handler already primed — it must NOT
 * call `postReplyAndResume` (or otherwise re-insert the reply), which would double it.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import { agentSession, agentSessionRun, db, genId, integration, task } from '@docket/db';
import { parseLinearAgentWebhook, verifyLinearAgentWebhookSignature } from '@docket/integrations';
import type {
  LinearAgentPort,
  LinearAgentSessionCreated,
  LinearAgentSessionPrompted,
} from '@docket/integrations';

import { webAppOrigin } from '../lib/github-app';
import { resolveExternalActor } from '../lib/identity/resolve-external-actor';
import { buildLinearAgentPortForIntegration } from '../lib/linear-agent-credential';
import { linearAgentConfigFromEnv } from '../lib/linear-agent-connect';

import { createLinearAgentSession, recordInboundReply } from './agent-session-runner';

/**
 * The fallback brief seeded on a `created` session when no mirrored task resolves.
 *
 * @remarks
 * `deriveBrief` (the loop's first-turn brief resolver, `agent/loop.ts`) prefers `task.title`
 * when `taskId` resolves; this is the degraded-but-honest fallback for when it doesn't (the
 * issue isn't mirrored into Docket, or the webhook didn't expose an issue id). It deliberately
 * does not reach into the `.loose()`-typed `agentSession.issue`/`.comment` fields for a richer
 * brief — those shapes are unverified against a live delivery (see `linear-agent.ts`'s module
 * remarks) — so this stays a stable string rather than something that could start throwing once
 * a real Agent app registration reveals a different shape.
 */
const LINEAR_AGENT_MENTION_PROMPT =
  'Athena was mentioned or delegated work in a Linear agent session. Review the linked issue/comment in Linear and help.';

/** Best-effort, loosely-typed extraction of the mentioned issue's Linear id, when exposed. */
const linearAgentIssueRefSchema = z
  .object({
    agentSession: z.object({ issue: z.object({ id: z.string() }).loose().optional() }).loose(),
  })
  .loose();

/**
 * Extract `agentSession.issue.id` from the raw webhook body, when the payload happens to expose
 * it — see {@link linearAgentIssueRefSchema}'s remarks on why this reads the raw payload rather
 * than the boundary adapter's own typed (and deliberately narrower) parse result.
 */
function extractMentionedIssueId(payload: unknown): string | null {
  const parsed = linearAgentIssueRefSchema.safeParse(payload);
  return parsed.success ? (parsed.data.agentSession.issue?.id ?? null) : null;
}

/**
 * Build the "Open in Docket" deep link Linear displays on the session
 * (`agentSessionUpdate`'s required external URL). Points at the web app's existing session
 * detail route (`apps/web/src/app/(app)/orgs/[orgId]/sessions/[sessionId]/page.tsx`).
 */
function sessionDeepLink(orgId: string, sessionId: string): string {
  return `${webAppOrigin()}/orgs/${orgId}/sessions/${sessionId}`;
}

/**
 * Queue a fresh `agent_session_run` generation for the not-yet-built cron sweep to pick up.
 *
 * @remarks
 * This webhook handler is the FIRST real writer of `agent_session_run` — no Cloudflare-
 * orchestrated runner exists yet, so `workflowInstanceId` (`NOT NULL`, uniquely indexed) gets a
 * locally-generated placeholder id rather than a real workflow instance id. `generation`
 * advances past whatever generation already exists for the session (0 for a brand-new session),
 * satisfying the `agent_session_run_generation_uq` unique index. The future cron sweep is
 * expected to claim `status: 'queued'` rows (lease them, run `driveSession`/the reply-and-resume
 * contract documented on `recordInboundReply`) and to replace this placeholder workflow id with
 * a real one once that runner exists.
 */
async function queueAgentSessionRun(orgId: string, sessionId: string): Promise<void> {
  const [last] = await db
    .select({ generation: agentSessionRun.generation })
    .from(agentSessionRun)
    .where(eq(agentSessionRun.sessionId, sessionId))
    .orderBy(desc(agentSessionRun.generation))
    .limit(1);
  await db.insert(agentSessionRun).values({
    sessionId,
    organizationId: orgId,
    generation: (last?.generation ?? -1) + 1,
    // Placeholder until a real Cloudflare-orchestrated runner exists (see remarks above).
    workflowInstanceId: `placeholder:${genId()}`,
    status: 'queued',
  });
}

/** Handle a `created` `AgentSessionEvent`: create/find the session, then satisfy Linear's SLA. */
async function handleSessionCreated(
  c: Context,
  orgId: string,
  externalWorkspaceId: string,
  linearAgentIntegration: typeof integration.$inferSelect,
  port: LinearAgentPort,
  event: LinearAgentSessionCreated,
  payload: unknown,
): Promise<Response> {
  const resolved = event.actor
    ? await resolveExternalActor(orgId, {
        source: 'linear',
        externalId: event.actor.id,
        email: event.actor.email,
      })
    : { actorId: null, matchedBy: null };

  // Resolve the mentioned issue, if any, to an already-mirrored Docket task via the org's
  // REGULAR `provider: 'linear'` connector integration — a different integration row from the
  // `linear_agent` one this webhook routed through.
  const issueId = extractMentionedIssueId(payload);
  let taskId: string | null = null;
  if (issueId) {
    const [linearConnector] = await db
      .select({ id: integration.id })
      .from(integration)
      .where(and(eq(integration.organizationId, orgId), eq(integration.provider, 'linear')))
      .limit(1);
    if (linearConnector) {
      const [taskRow] = await db
        .select({ id: task.id })
        .from(task)
        .where(and(eq(task.sourceIntegrationId, linearConnector.id), eq(task.externalId, issueId)))
        .limit(1);
      taskId = taskRow?.id ?? null;
    }
  }

  const createdByActorId = resolved.actorId ?? linearAgentIntegration.createdBy;
  if (!createdByActorId) {
    // Genuinely exceptional: the installer's own actor was removed after install, AND the
    // mentioning Linear user never resolved either. There is no one left to attribute the org's
    // lazily-materialized default agent to. Surface loudly (500 → Linear retries) rather than
    // silently guessing an attribution.
    throw new Error(
      `linear-agent webhook: no actor to attribute the default agent to in org ${orgId}`,
    );
  }

  const session = await createLinearAgentSession(orgId, {
    createdByActorId,
    initiatorActorId: resolved.actorId,
    externalRunRef: `linear-agent-session:${event.agentSession.id}`,
    prompt: LINEAR_AGENT_MENTION_PROMPT,
    taskId,
    externalSessionId: event.agentSession.id,
    externalWorkspaceId,
    externalIssueId: issueId,
  });

  // Idempotent-replay-safe: `agentSessionUpdate` just replaces the session's external-url list,
  // so re-issuing it on a retried delivery is harmless — and necessary, because Linear's
  // 10-second "attach an external URL" SLA must be met even if an earlier delivery attempt
  // created the session but died before this call went out.
  await port.agentSessionUpdate({
    agentSessionId: event.agentSession.id,
    externalUrls: [{ label: 'Open in Docket', url: sessionDeepLink(orgId, session.id) }],
  });

  // Only queue a run when the session actually starts runnable. `driveSession` throws a
  // `ConflictError` on any status other than `pending`/`running` — an unresolved-identity
  // session starts `awaiting_input` on purpose (see `createLinearAgentSession`), and stays that
  // way until a later `prompted` delivery resolves the identity and reopens it (`recordInboundReply`
  // flips `awaiting_input` → `running`, and `handleSessionPrompted` queues a run at that point).
  // Queuing one here too would just hand the future cron sweep a run it can only fail on.
  if (session.isNew && session.status === 'pending') await queueAgentSessionRun(orgId, session.id);

  return c.json({ received: true, processed: true, sessionId: session.id }, 200);
}

/** Handle a `prompted` `AgentSessionEvent`: resolve identity, then queue a resume. */
async function handleSessionPrompted(
  c: Context,
  orgId: string,
  event: LinearAgentSessionPrompted,
): Promise<Response> {
  const externalRunRef = `linear-agent-session:${event.agentSession.id}`;
  const [session] = await db
    .select()
    .from(agentSession)
    .where(
      and(eq(agentSession.organizationId, orgId), eq(agentSession.externalRunRef, externalRunRef)),
    )
    .limit(1);
  // No session for this ref: a stale/out-of-order delivery (or one that arrived before the
  // `created` delivery somehow did). Nothing to resume.
  if (!session) return c.json({ received: true, processed: false }, 200);

  let initiatorActorId = session.initiatorId;
  if (!initiatorActorId && event.actor) {
    const resolved = await resolveExternalActor(orgId, {
      source: 'linear',
      externalId: event.actor.id,
      email: event.actor.email,
    });
    if (resolved.actorId) {
      await db
        .update(agentSession)
        .set({ initiatorId: resolved.actorId })
        .where(eq(agentSession.id, session.id));
      initiatorActorId = resolved.actorId;
    }
  }
  // Still unresolved: don't spend a cron-sweep turn on a session no one is attributed to. The
  // person hasn't linked their Linear identity to Docket yet — wait for a later delivery.
  if (!initiatorActorId) return c.json({ received: true, processed: false }, 200);

  await recordInboundReply(orgId, session.id, initiatorActorId, event.agentActivity.body);
  await queueAgentSessionRun(orgId, session.id);

  return c.json({ received: true, processed: true, sessionId: session.id }, 200);
}

/**
 * Handle one inbound Linear `AgentSessionEvent` webhook delivery: verify → route → build the
 * outbound port → branch on `action` → ACK.
 */
async function ingestLinearAgentWebhook(c: Context): Promise<Response> {
  // Read the RAW bytes first: the signature is an HMAC over the exact request body.
  const rawBody = await c.req.text();

  const config = linearAgentConfigFromEnv();
  if (!config) return c.json({ error: 'Linear Agent platform is not configured' }, 404);

  if (!verifyLinearAgentWebhookSignature(rawBody, c.req.header(), config.webhookSecret)) {
    return c.json({ error: 'signature verification failed' }, 400);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }

  const event = parseLinearAgentWebhook(payload);
  // An unrecognized-but-signed shape should never trigger a Linear retry storm.
  if (!event) return c.json({ received: true, processed: false }, 200);

  const externalWorkspaceId = event.organizationId;
  if (!externalWorkspaceId) return c.json({ received: true, processed: false }, 200);

  // Route to the org: the `linear_agent` integration whose stamped workspace id matches this
  // delivery. An event for a workspace nobody has this app installed for (or an install that
  // predates workspace-id stamping) is acknowledged with no processing — never a 500 that
  // triggers a third-party retry storm.
  const [linearAgentIntegration] = await db
    .select()
    .from(integration)
    .where(
      and(
        eq(integration.provider, 'linear_agent'),
        sql`${integration.connection}->>'externalWorkspaceId' = ${externalWorkspaceId}`,
      ),
    )
    .limit(1);
  if (!linearAgentIntegration) return c.json({ received: true, processed: false }, 200);
  const orgId = linearAgentIntegration.organizationId;

  // No credential (or an unparseable one) means the install never completed OAuth — degrade
  // the same as "unrouted". See `lib/linear-agent-credential.ts` for the shared unseal/parse
  // shape this and the outbound relay both read.
  const port = await buildLinearAgentPortForIntegration(linearAgentIntegration.id);
  if (!port) return c.json({ received: true, processed: false }, 200);

  if (event.action === 'created') {
    return handleSessionCreated(
      c,
      orgId,
      externalWorkspaceId,
      linearAgentIntegration,
      port,
      event,
      payload,
    );
  }
  return handleSessionPrompted(c, orgId, event);
}

/** The Linear Agent ingestion app: verify → route → act synchronously → 200. */
const ingestLinearAgent = new Hono().post('/linear-agent', ingestLinearAgentWebhook);

export default ingestLinearAgent;
