/**
 * `@docket/api` — the ambient-intelligence ingestion edge (mounted OUTSIDE the RPC `AppType`).
 *
 * @remarks
 * `POST /internal/ingest/{linear,github}` receive provider webhooks and record
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
import type { ObserverProvider } from '@docket/integrations';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';

import { buildObserver } from '../container';
import { requestNotionMirrorSweep } from '../events/notion-mirror-dispatch';
import { wakeNotionMirror } from './notion-mirror-wake';

/** Narrow a routed payload to the record drizzle stores in the `payload` jsonb column. */
function asPayload(value: unknown): Record<string, unknown> {
  // `observer.route(...)` returned non-null, so the body is a JSON object.
  return value as Record<string, unknown>;
}

/**
 * Find integrations matching the external workspace/installation ID.
 */
async function findMatchingIntegrations(
  provider: ObserverProvider,
  externalWorkspaceId: string,
  externalEventId: string,
): Promise<{ organizationId: string; integrationId: string; externalEventId: string }[]> {
  const matches: { organizationId: string; integrationId: string; externalEventId: string }[] = [];
  const rows = await db
    .select({ id: integration.id, organizationId: integration.organizationId })
    .from(integration)
    .where(
      and(
        eq(integration.provider, provider),
        sql`${integration.connection}->>'externalWorkspaceId' = ${externalWorkspaceId}`,
      ),
    );

  if (provider === 'linear') {
    const byOrg = new Map<string, string>();
    for (const row of rows) {
      if (!byOrg.has(row.organizationId)) byOrg.set(row.organizationId, row.id);
    }
    for (const [organizationId, integrationId] of byOrg) {
      matches.push({
        organizationId,
        integrationId,
        externalEventId: `${externalEventId}:${organizationId}`,
      });
    }
  } else if (rows[0]) {
    matches.push({
      organizationId: rows[0].organizationId,
      integrationId: rows[0].id,
      externalEventId,
    });
  }

  return matches;
}

/**
 * Write inbound events to the inbox and handle Notion mirror wake notifications.
 */
async function writeInboundEvents(
  provider: ObserverProvider,
  matches: { organizationId: string; integrationId: string; externalEventId: string }[],
  externalEventId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  let notionWoke = false;
  const targets =
    matches.length > 0 ? matches : [{ organizationId: null, integrationId: null, externalEventId }];

  for (const target of targets) {
    const woke = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(inboundEvent)
        .values({
          organizationId: target.organizationId,
          integrationId: target.integrationId,
          provider,
          externalEventId: target.externalEventId,
          eventType,
          payload,
          signatureVerified: true,
        })
        .onConflictDoNothing({
          target: [inboundEvent.provider, inboundEvent.externalEventId],
        })
        .returning({ id: inboundEvent.id });

      if (provider === 'notion' && inserted.length > 0 && target.organizationId !== null) {
        await wakeNotionMirror(
          {
            integrationId: target.integrationId,
            organizationId: target.organizationId,
          },
          tx,
        );
        return true;
      }
      return false;
    });
    notionWoke ||= woke;
  }

  return notionWoke;
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
  const observer = buildObserver(provider);

  // Authenticate before trusting any payload (the mock trusts the local path; see MockObserver).
  // Pass all headers through — the observer owns which signature header matters per provider.
  if (!(await observer.verifySignature({ rawBody, headers: c.req.header() }))) {
    return c.json({ error: 'signature verification failed' }, 400);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }

  const routing = observer.route(payload);
  if (!routing) return c.json({ error: 'unrecognized payload' }, 400);

  // Map the provider workspace/installation to the connected integration(s) (→ orgs). An event
  // for a workspace Docket doesn't have connected is acknowledged (200) but recorded unrouted,
  // so a missing integration never 500s a third-party retry storm.
  const matches = routing.externalWorkspaceId
    ? await findMatchingIntegrations(provider, routing.externalWorkspaceId, routing.externalEventId)
    : [];

  const notionWoke = await writeInboundEvents(
    provider,
    matches,
    routing.externalEventId,
    routing.eventType,
    asPayload(payload),
  );

  if (notionWoke) requestNotionMirrorSweep();

  return c.json({ received: true, routed: matches.length > 0 });
}

/** The ingestion app: verify → write-ahead → 200, one provider edge per route. */
const ingest = new Hono()
  .post('/linear', (c) => ingestWebhook(c, 'linear'))
  .post('/notion', (c) => ingestWebhook(c, 'notion'))
  .post('/github', (c) => ingestWebhook(c, 'github'));

export default ingest;
