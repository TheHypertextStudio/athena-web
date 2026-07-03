/**
 * `@docket/api` — the ambient-intelligence ingestion edge (mounted OUTSIDE the RPC `AppType`).
 *
 * @remarks
 * `POST /internal/ingest/linear` and `POST /internal/ingest/github` receive provider webhooks and record
 * them in the durable write-ahead inbox ({@link inboundEvent}) — the "persist incoming data as
 * fast as possible" invariant. It is non-RPC (an untyped external edge), so it lives in
 * `server.ts` alongside `/internal/billing` and `/internal/cron`.
 *
 * Both routes share one handler: read the **raw** body (the HMAC is computed over the exact
 * bytes), verify it via the resolved {@link Observer}, parse + route it to extract the provider's
 * workspace id (Linear workspace / GitHub installation) and a per-delivery event id, map that to
 * the connected {@link integration} (and thus the org), then write one `inbound_event` row and ACK
 * 200. No normalization or task/observation writes happen here — the lease-guarded drain cron
 * ({@link sweepInboundEvents}) does that asynchronously. Dedup against webhook retries is the
 * unique `(provider, external_event_id)` index.
 */
import { db, inboundEvent, integration } from '@docket/db';
import { selectAdapter } from '@docket/boundaries';
import type { ObserverProvider } from '@docket/boundaries';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';

import { toBoundaryEnv } from '../container';

/** Narrow a routed payload to the record drizzle stores in the `payload` jsonb column. */
function asPayload(value: unknown): Record<string, unknown> {
  // `observer.route(...)` returned non-null, so the body is a JSON object.
  return value as Record<string, unknown>;
}

/**
 * Handle one inbound provider webhook: verify → route → map to integration → write-ahead → ACK.
 *
 * @remarks
 * Provider-agnostic — the bound {@link Observer} owns the signature header and payload shape; the
 * only per-provider input is which `observerProvider` to resolve and which `integration.provider`
 * rows to map the workspace/installation against.
 *
 * @param c - The Hono request context.
 * @param provider - The provider this route ingests (`linear` | `github`).
 */
async function ingestWebhook(c: Context, provider: ObserverProvider): Promise<Response> {
  // Read the RAW bytes first: the signature is an HMAC over the exact request body.
  const rawBody = await c.req.text();
  const observer = selectAdapter('observer', toBoundaryEnv(), { observerProvider: provider });

  // Authenticate before trusting any payload (the mock trusts the local path; see MockObserver).
  // Pass all headers through — the observer owns which signature header matters per provider.
  if (!observer.verifySignature({ rawBody, headers: c.req.header() })) {
    return c.json({ error: 'signature verification failed' }, 400);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }

  // Slack's one-time URL-verification handshake: echo the challenge (already signature-checked).
  if (provider === 'slack') {
    const obj = payload as Record<string, unknown> | null;
    if (obj?.['type'] === 'url_verification') {
      const challenge = obj['challenge'];
      if (typeof challenge === 'string') return c.json({ challenge });
    }
  }

  const routing = observer.route(payload);
  if (!routing) return c.json({ error: 'unrecognized payload' }, 400);

  // Map the provider workspace/installation to the connected integration(s) (→ orgs). An event
  // for a workspace Docket doesn't have connected is acknowledged (200) but recorded unrouted,
  // so a missing integration never 500s a third-party retry storm.
  //
  // Slack is per-USER connectable, so one workspace may back several integrations (one per
  // connecting user) across one or more orgs: the delivery fans out to ONE inbound row per org
  // (the drain resolves per-user relevance from all of that org's connected users), with the
  // org id suffixed onto the dedup key so retries stay per-org no-ops. Single-integration
  // providers keep the provider's own event id verbatim.
  const matches: { organizationId: string; integrationId: string; externalEventId: string }[] = [];
  if (routing.externalWorkspaceId) {
    const rows = await db
      .select({ id: integration.id, organizationId: integration.organizationId })
      .from(integration)
      .where(
        and(
          eq(integration.provider, provider),
          sql`${integration.connection}->>'externalWorkspaceId' = ${routing.externalWorkspaceId}`,
        ),
      );
    if (provider === 'slack') {
      const byOrg = new Map<string, string>();
      for (const row of rows) {
        if (!byOrg.has(row.organizationId)) byOrg.set(row.organizationId, row.id);
      }
      for (const [organizationId, integrationId] of byOrg) {
        matches.push({
          organizationId,
          integrationId,
          externalEventId: `${routing.externalEventId}:${organizationId}`,
        });
      }
    } else if (rows[0]) {
      matches.push({
        organizationId: rows[0].organizationId,
        integrationId: rows[0].id,
        externalEventId: routing.externalEventId,
      });
    }
  }

  // Write-ahead (one row per routed org; one unrouted row when no org matched), then ACK. The
  // unique (provider, external_event_id) index makes a retried delivery a no-op insert.
  const targets =
    matches.length > 0
      ? matches
      : [{ organizationId: null, integrationId: null, externalEventId: routing.externalEventId }];
  for (const target of targets) {
    await db
      .insert(inboundEvent)
      .values({
        organizationId: target.organizationId,
        integrationId: target.integrationId,
        provider,
        externalEventId: target.externalEventId,
        eventType: routing.eventType,
        payload: asPayload(payload),
        signatureVerified: true,
      })
      .onConflictDoNothing({
        target: [inboundEvent.provider, inboundEvent.externalEventId],
      });
  }

  return c.json({ received: true, routed: matches.length > 0 });
}

/** The ingestion app: verify → write-ahead → 200, one provider edge per route. */
const ingest = new Hono()
  .post('/linear', (c) => ingestWebhook(c, 'linear'))
  .post('/github', (c) => ingestWebhook(c, 'github'))
  .post('/slack', (c) => ingestWebhook(c, 'slack'));

export default ingest;
