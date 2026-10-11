/** Authenticated personal app/device ingress, independent of integration webhooks. */
import { Hono } from 'hono';
import { PersonalInboundBatchIn, PersonalInboundBatchOut } from '@docket/athena/inbound-contract';
import type { AppEnv } from '../context';
import { apiDoc } from '../lib/openapi-route';
import { zJson } from '../lib/validate';
import { ok } from '../lib/ok';
import { callerHub } from './work-location-route-context';
import { consumeUploadBatch } from '../services/device-notifications/upload-window';
import { ingestPersonalInbound } from '../services/inbound/ingest';

/** One versioned ingress for registered personal app/device sources. */
export const meInbound = new Hono<AppEnv>().post(
  '/',
  apiDoc({
    tag: 'Me',
    summary: 'Receive personal app/device events',
    response: PersonalInboundBatchOut,
    description:
      'Schema version 1. Up to 100 captures and 200 removals. Ordered per-event durable receipts; unsupported event types are invalid. Session-only; source ownership is checked. 404 unregistered source, 413 oversized body, 422 unsupported batch version or shape, 429 upload quota.',
  }),
  zJson(PersonalInboundBatchIn),
  async (c) => {
    const hubId = await callerHub(c);
    const now = new Date();
    await consumeUploadBatch(hubId, now);
    return ok(
      c,
      PersonalInboundBatchOut,
      await ingestPersonalInbound(hubId, c.req.valid('json'), now),
    );
  },
);
