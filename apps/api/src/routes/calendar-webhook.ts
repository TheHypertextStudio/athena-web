/**
 * `@docket/api` — inbound calendar push-notification webhook (mounted OUTSIDE the RPC `AppType`).
 *
 * @remarks
 * `POST /webhooks/calendar/:provider` is a machine edge like `/internal/cron`: Docket
 * registers this URL directly with the provider when it creates a push-notification watch
 * ({@link registerOrRenewWatches}), so no client negotiates a version against it — it is
 * never part of the typed RPC contract and never appears in the OpenAPI spec. Only
 * `'google'` is registered today; any other `:provider` 404s.
 *
 * Google's push notifications are treated as a HINT, not a data source: the request body
 * carries no event data (only the `X-Goog-*` headers matter), so it is never read here.
 * The channel/resource/token headers are validated against the `calendar_layer` row the
 * `X-Goog-Channel-Id` header resolves to ({@link validateGoogleWebhookHeaders}); a mismatch
 * or an unknown channel id 404s without revealing which check failed. The initial
 * `X-Goog-Resource-State: sync` confirmation ping is acknowledged as a no-op. Any other
 * notification triggers a bounded, single-layer sync ({@link syncSingleLayer}) and returns
 * 200 once that completes — layer syncs are small, so blocking briefly on it is fine for v1
 * (see the task brief; a fire-and-forget version is a future optimization if webhook
 * timeouts ever become a problem).
 */
import { calendarLayer, db } from '@docket/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { validateGoogleWebhookHeaders } from './calendar-google-adapter';
import { syncSingleLayer } from './calendar-sync-engine';
import { createDefaultCalendarSyncModules } from './calendar-sync-modules';

/** Look up the `calendar_layer` row a Google push channel id was registered against. */
async function findLayerByGoogleChannelId(channelId: string): Promise<{
  id: string;
  userId: string;
  watchToken: string | null;
  watchResourceId: string | null;
} | null> {
  const rows = await db
    .select({
      id: calendarLayer.id,
      userId: calendarLayer.userId,
      watchToken: calendarLayer.watchToken,
      watchResourceId: calendarLayer.watchResourceId,
    })
    .from(calendarLayer)
    .where(eq(calendarLayer.watchChannelId, channelId))
    .limit(1);
  return rows[0] ?? null;
}

/** The calendar-webhook app: provider push-notification pings, validated and turned into syncs. */
const calendarWebhook = new Hono().post('/:provider', async (c) => {
  const provider = c.req.param('provider');
  if (provider !== 'google') return c.json({ error: 'not found' }, 404);

  const channelId = c.req.header('x-goog-channel-id');
  const layer = channelId ? await findLayerByGoogleChannelId(channelId) : null;
  if (!layer) return c.json({ error: 'not found' }, 404);

  const outcome = validateGoogleWebhookHeaders(
    {
      channelToken: c.req.header('x-goog-channel-token'),
      resourceId: c.req.header('x-goog-resource-id'),
      resourceState: c.req.header('x-goog-resource-state'),
    },
    layer,
  );
  if (outcome === 'invalid') return c.json({ error: 'not found' }, 404);
  if (outcome === 'sync') return c.json({ received: true });

  await syncSingleLayer(db, {
    userId: layer.userId,
    layerId: layer.id,
    adapters: createDefaultCalendarSyncModules(),
    now: new Date(),
  });
  return c.json({ received: true });
});

export default calendarWebhook;
