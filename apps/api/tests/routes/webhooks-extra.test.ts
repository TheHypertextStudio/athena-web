import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BillingEvent, BillingGateway } from '@docket/billing';

import { getDb, seedBaseOrg } from './harness.test';
import * as container from '../../src/container';
import type webhooksRouter from '../../src/routes/webhooks';

import type * as DbModule from '@docket/db';

let webhooks!: typeof webhooksRouter;
let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  webhooks = (await import('../../src/routes/webhooks')).default;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const J = { 'content-type': 'application/json' };

describe('webhooks asBillingEvent defensive parse (mock gateway / local-test path)', () => {
  it('400s a non-object body (null / array / primitive)', async () => {
    const nullBody = await webhooks.request('/webhook', {
      method: 'POST',
      headers: J,
      body: JSON.stringify(null),
    });
    expect(nullBody.status).toBe(400);
    const arr = await webhooks.request('/webhook', {
      method: 'POST',
      headers: J,
      body: JSON.stringify([1, 2]),
    });
    expect(arr.status).toBe(400);
  });

  it('400s an object missing referenceId/createdAt even with id+type', async () => {
    const res = await webhooks.request('/webhook', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ id: 'e1', type: 'subscription.updated' }),
    });
    expect(res.status).toBe(400);
  });

  it('400s a body that is not valid JSON (parse catch → null)', async () => {
    const res = await webhooks.request('/webhook', {
      method: 'POST',
      headers: J,
      body: 'not json{',
    });
    expect(res.status).toBe(400);
  });
});

/**
 * A fake real-gateway whose `verifyWebhook` checks the raw body against a fixed secret —
 * standing in for `RealStripeGateway` so the route's verification branch is exercised
 * without a live Stripe signature/Web-Crypto.
 */
function fakeVerifyingGateway(
  verify: (rawBody: string, signature: string) => BillingEvent | null,
): BillingGateway & {
  verifyWebhook(rawBody: string | Buffer, signature: string): Promise<BillingEvent | null>;
} {
  return {
    createCheckoutSession: vi.fn(),
    getSubscription: vi.fn(),
    cancelSubscription: vi.fn(),
    createBillingPortalSession: vi.fn(),
    verifyWebhook: (rawBody: string | Buffer, signature: string) =>
      Promise.resolve(
        verify(typeof rawBody === 'string' ? rawBody : rawBody.toString(), signature),
      ),
  };
}

/** Spy `getContainer` so `.billing` is the supplied verifying gateway. */
function useGateway(gateway: BillingGateway): void {
  const original = container.getContainer();
  vi.spyOn(container, 'getContainer').mockReturnValue({ ...original, billing: gateway });
}

describe('webhooks signature verification (real Stripe gateway path)', () => {
  it('rejects a forged/tampered body whose signature does not verify (400)', async () => {
    // The real adapter throws on a bad signature; the route must convert that to a 400
    // and NEVER fold the forged event into the lifecycle.
    useGateway(
      fakeVerifyingGateway(() => {
        throw new Error('RealStripeGateway: webhook signature verification failed.');
      }),
    );
    const res = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { ...J, 'stripe-signature': 't=1,v1=forged' },
      body: JSON.stringify({
        id: 'evt_forged',
        type: 'subscription.canceled',
        referenceId: 'org_victim',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'webhook signature verification failed',
    });
  });

  it('rejects a request with no stripe-signature header (400)', async () => {
    const verify = vi.fn(() => null);
    useGateway(fakeVerifyingGateway(verify));
    const res = await webhooks.request('/webhook', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ id: 'evt', type: 'subscription.canceled' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'missing stripe-signature header',
    });
    // The verifier must never be consulted when the signature header is absent.
    expect(verify).not.toHaveBeenCalled();
  });

  it('acknowledges a verified-but-unmodeled event with no effect', async () => {
    useGateway(fakeVerifyingGateway(() => null));
    const res = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { ...J, 'stripe-signature': 't=1,v1=ok' },
      body: 'raw stripe payload bytes',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, effect: null });
  });

  it('folds a verified event into the org lifecycle (raw body is passed through, not re-parsed)', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const rawPayload = 'opaque-stripe-bytes-{not-the-normalized-event}';
    const normalized: BillingEvent = {
      id: 'evt_real',
      type: 'subscription.canceled',
      referenceId: orgId,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    // The verifier asserts it received the EXACT raw bytes (HMAC requires this), then
    // returns the normalized event the route should fold in.
    useGateway(
      fakeVerifyingGateway((rawBody) => {
        expect(rawBody).toBe(rawPayload);
        return normalized;
      }),
    );
    const res = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { ...J, 'stripe-signature': 't=1,v1=ok' },
      body: rawPayload,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, effect: 'export_window' });
    // The terminal event moved the org into the 14-day export window.
    const [org] = await db
      .select({ lifecycleState: schema.organization.lifecycleState })
      .from(schema.organization)
      .where(eq(schema.organization.id, orgId));
    expect(org?.lifecycleState).toBe('export_window');
  });
});
