import { describe, expect, it } from 'vitest';

import {
  DOCKET_PRO_MONTHLY_LOOKUP_KEY,
  DOCKET_STRIPE_WEBHOOK_EVENTS,
  reconcileDocketStripe,
  type StripeProvisioningClient,
  type StripeProvisioningState,
} from '../../src/provision';

function emptyState(livemode = false): StripeProvisioningState {
  return { livemode, products: [], prices: [], portalConfigurations: [], webhookEndpoints: [] };
}

function fakeClient(initial: StripeProvisioningState): {
  readonly client: StripeProvisioningClient;
  readonly state: StripeProvisioningState;
  readonly calls: string[];
} {
  const state: StripeProvisioningState = structuredClone(initial);
  const calls: string[] = [];
  let sequence = 1;
  const client: StripeProvisioningClient = {
    readState: async () => structuredClone(state),
    createProduct: async (input) => {
      calls.push('createProduct');
      const value = { id: `prod_${sequence++}`, livemode: state.livemode, ...input };
      state.products.push(value);
      return value;
    },
    updateProduct: async (id, input) => {
      calls.push('updateProduct');
      const current = state.products.find((value) => value.id === id)!;
      Object.assign(current, input);
      return structuredClone(current);
    },
    createPrice: async (input) => {
      calls.push('createPrice');
      const value = { id: `price_${sequence++}`, livemode: state.livemode, active: true, ...input };
      state.prices.push(value);
      return value;
    },
    updatePrice: async (id, input) => {
      calls.push('updatePrice');
      const current = state.prices.find((value) => value.id === id)!;
      Object.assign(current, input);
      return structuredClone(current);
    },
    createPortalConfiguration: async (input) => {
      calls.push('createPortalConfiguration');
      const value = { id: `bpc_${sequence++}`, livemode: state.livemode, active: true, ...input };
      state.portalConfigurations.push(value);
      return value;
    },
    updatePortalConfiguration: async (id, input) => {
      calls.push('updatePortalConfiguration');
      const current = state.portalConfigurations.find((value) => value.id === id)!;
      Object.assign(current, input);
      return structuredClone(current);
    },
    createWebhookEndpoint: async (input) => {
      calls.push('createWebhookEndpoint');
      const value = {
        id: `we_${sequence++}`,
        livemode: state.livemode,
        status: 'enabled' as const,
        secret: `whsec_${sequence}`,
        ...input,
      };
      state.webhookEndpoints.push(value);
      return value;
    },
    updateWebhookEndpoint: async (id, input) => {
      calls.push(`updateWebhookEndpoint:${id}`);
      const current = state.webhookEndpoints.find((value) => value.id === id)!;
      Object.assign(current, input);
      return structuredClone(current);
    },
  };
  return { client, state, calls };
}

const input = {
  mode: 'test' as const,
  apiOrigin: 'https://api.docket.test',
  webOrigin: 'https://docket.test',
};

describe('reconcileDocketStripe', () => {
  it('creates the Docket Pro product, monthly price, portal, and real API webhook', async () => {
    const fake = fakeClient(emptyState());
    const result = await reconcileDocketStripe(fake.client, input);

    expect(result.values).toEqual({
      BILLING_ENABLED: 'true',
      DOCKET_PRICE_LOOKUP_DOCKET_PRO: DOCKET_PRO_MONTHLY_LOOKUP_KEY,
      STRIPE_BILLING_PORTAL_CONFIG_ID: 'bpc_3',
      STRIPE_PRICE_DOCKET_PRO: 'price_2',
      STRIPE_WEBHOOK_SECRET: 'whsec_5',
    });
    expect(fake.state.products[0]).toMatchObject({ name: 'Docket Pro', active: true });
    expect(fake.state.prices[0]).toMatchObject({
      currency: 'usd',
      unitAmount: 800,
      interval: 'month',
      lookupKey: DOCKET_PRO_MONTHLY_LOOKUP_KEY,
    });
    expect(fake.state.webhookEndpoints[0]).toMatchObject({
      url: 'https://api.docket.test/internal/billing/webhook',
      enabledEvents: [...DOCKET_STRIPE_WEBHOOK_EVENTS],
    });
  });

  it('uses the Stripe CLI signing secret without registering a localhost webhook', async () => {
    const fake = fakeClient(emptyState());
    const result = await reconcileDocketStripe(fake.client, {
      mode: 'test',
      apiOrigin: 'http://api.docket.localhost:4100',
      webOrigin: 'http://docket.localhost:4200',
      webhookTransport: 'stripe-cli',
      existingWebhookSecret: 'whsec_cli',
    });

    expect(result.values.STRIPE_WEBHOOK_SECRET).toBe('whsec_cli');
    expect(fake.state.webhookEndpoints).toEqual([]);
    expect(fake.calls).not.toContain('createWebhookEndpoint');
    expect(result.actions).toContain('configured Stripe CLI webhook forwarding');
  });

  it('rejects Stripe CLI forwarding in live mode before reading or mutating Stripe', async () => {
    const fake = fakeClient(emptyState(true));

    await expect(
      reconcileDocketStripe(fake.client, {
        mode: 'live',
        apiOrigin: 'https://docket-api.hypertext.studio',
        webOrigin: 'https://docket.hypertext.studio',
        webhookTransport: 'stripe-cli',
        existingWebhookSecret: 'whsec_cli',
      }),
    ).rejects.toThrow('Stripe CLI webhook forwarding is sandbox-only');
    expect(fake.calls).toEqual([]);
  });

  it('is idempotent when the managed resources already match', async () => {
    const fake = fakeClient(emptyState());
    const first = await reconcileDocketStripe(fake.client, input);
    fake.calls.length = 0;

    const second = await reconcileDocketStripe(fake.client, {
      ...input,
      existingWebhookSecret: first.values.STRIPE_WEBHOOK_SECRET,
    });

    expect(second.values).toEqual(first.values);
    expect(fake.calls).toEqual([
      'updateProduct',
      'updatePrice',
      'updatePortalConfiguration',
      'updateWebhookEndpoint:we_4',
    ]);
    expect(fake.state.products).toHaveLength(1);
    expect(fake.state.prices).toHaveLength(1);
    expect(fake.state.portalConfigurations).toHaveLength(1);
    expect(fake.state.webhookEndpoints).toHaveLength(1);
  });

  it('replaces an immutable price that has the lookup key but the wrong amount', async () => {
    const fake = fakeClient(emptyState());
    await reconcileDocketStripe(fake.client, input);
    Object.assign(fake.state.prices[0]!, { unitAmount: 900 });
    fake.calls.length = 0;

    const result = await reconcileDocketStripe(fake.client, {
      ...input,
      existingWebhookSecret: 'whsec_existing',
    });

    expect(fake.state.prices).toHaveLength(2);
    expect(fake.state.prices[0]?.active).toBe(false);
    expect(fake.state.prices[1]).toMatchObject({ unitAmount: 800, active: true });
    expect(result.values.STRIPE_PRICE_DOCKET_PRO).toBe(fake.state.prices[1]?.id);
  });

  it('rotates a managed webhook when its one-time signing secret is unavailable', async () => {
    const fake = fakeClient(emptyState());
    await reconcileDocketStripe(fake.client, input);
    fake.calls.length = 0;

    const result = await reconcileDocketStripe(fake.client, input);

    expect(fake.state.webhookEndpoints).toHaveLength(2);
    expect(fake.state.webhookEndpoints[0]?.status).toBe('disabled');
    expect(fake.state.webhookEndpoints[1]?.status).toBe('enabled');
    expect(result.values.STRIPE_WEBHOOK_SECRET).toMatch(/^whsec_/);
  });

  it('refuses to mutate an account in the wrong Stripe mode', async () => {
    const fake = fakeClient(emptyState(true));
    await expect(reconcileDocketStripe(fake.client, input)).rejects.toThrow(
      'test provisioning received live-mode Stripe state',
    );
    expect(fake.calls).toEqual([]);
  });
});
