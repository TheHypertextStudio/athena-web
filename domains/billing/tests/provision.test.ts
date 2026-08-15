import { describe, expect, it } from 'vitest';

import {
  DOCKET_PRO_MONTHLY_LOOKUP_KEY,
  DOCKET_STRIPE_WEBHOOK_EVENTS,
  reconcileDocketStripe,
  type StripeProvisioningClient,
  type StripeProvisioningState,
} from '../src/provision';

function emptyState(livemode = false): StripeProvisioningState {
  return { livemode, products: [], prices: [], portalConfigurations: [], webhookEndpoints: [] };
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

function fakeClient(initial: StripeProvisioningState): {
  readonly client: StripeProvisioningClient;
  readonly state: StripeProvisioningState;
  readonly calls: string[];
} {
  const state = structuredClone(initial);
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
      const current = required(
        state.products.find((value) => value.id === id),
        `product ${id}`,
      );
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
      const current = required(
        state.prices.find((value) => value.id === id),
        `price ${id}`,
      );
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
      const current = required(
        state.portalConfigurations.find((value) => value.id === id),
        `portal ${id}`,
      );
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
      const current = required(
        state.webhookEndpoints.find((value) => value.id === id),
        `webhook ${id}`,
      );
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
  it('creates the Docket Pro product, price, portal, and billing webhook', async () => {
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

  it('uses Stripe CLI signing for local sandbox without registering localhost', async () => {
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
  });

  it('is idempotent when managed resources already match', async () => {
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

  it('replaces an immutable price when the lookup key points to the wrong amount', async () => {
    const fake = fakeClient(emptyState());
    await reconcileDocketStripe(fake.client, input);
    Object.assign(required(fake.state.prices[0], 'created price'), { unitAmount: 900 });
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

  it('rejects a credential operating in the wrong Stripe mode', async () => {
    const fake = fakeClient(emptyState(true));
    await expect(reconcileDocketStripe(fake.client, input)).rejects.toThrow(
      'test provisioning received live-mode Stripe state',
    );
    expect(fake.calls).toEqual([]);
  });
});
