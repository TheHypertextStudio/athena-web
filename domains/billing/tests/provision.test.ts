import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';

import {
  DOCKET_PRO_MONTHLY_LOOKUP_KEY,
  DOCKET_STRIPE_WEBHOOK_EVENTS,
  provisionDocketStripe,
  reconcileDocketStripe,
  StripeSdkProvisioningClient,
  type StripePortalConfigurationInput,
  type StripePriceInput,
  type StripeProductInput,
  type StripeProvisioningClient,
  type StripeProvisioningState,
  type StripeWebhookInput,
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

  it('rejects unsafe origins, invalid Stripe CLI forwarding, and unmanaged webhooks', async () => {
    await expect(
      reconcileDocketStripe(fakeClient(emptyState()).client, {
        ...input,
        apiOrigin: 'http://api.docket.test',
      }),
    ).rejects.toThrow('Stripe API origin must use HTTPS outside localhost');
    await expect(
      reconcileDocketStripe(fakeClient(emptyState(true)).client, {
        ...input,
        mode: 'live',
        webhookTransport: 'stripe-cli',
        existingWebhookSecret: 'whsec_local',
      }),
    ).rejects.toThrow('Stripe CLI webhook forwarding is sandbox-only');
    await expect(
      reconcileDocketStripe(fakeClient(emptyState()).client, {
        ...input,
        webhookTransport: 'stripe-cli',
        existingWebhookSecret: 'not-a-signing-secret',
      }),
    ).rejects.toThrow('requires its whsec_ signing secret');

    const unmanaged = emptyState();
    unmanaged.webhookEndpoints.push({
      id: 'we_unmanaged',
      livemode: false,
      status: 'enabled',
      url: 'https://api.docket.test/internal/billing/webhook',
      description: 'Created elsewhere',
      enabledEvents: [],
      metadata: {},
    });
    await expect(reconcileDocketStripe(fakeClient(unmanaged).client, input)).rejects.toThrow(
      'Stripe already has an unmanaged webhook',
    );
  });

  it('rotates a managed webhook when its signing secret is unavailable', async () => {
    const fake = fakeClient(emptyState());
    await reconcileDocketStripe(fake.client, input);
    fake.calls.length = 0;

    const result = await reconcileDocketStripe(fake.client, input);

    expect(result.actions).toContain('rotated billing webhook signing secret');
    expect(fake.state.webhookEndpoints).toHaveLength(2);
    expect(fake.state.webhookEndpoints[0]?.status).toBe('disabled');
    expect(result.values.STRIPE_WEBHOOK_SECRET).toBe(fake.state.webhookEndpoints[1]?.secret);
  });

  it('requires Stripe to return a signing secret for a newly created webhook', async () => {
    const fake = fakeClient(emptyState());
    fake.client.createWebhookEndpoint = async (webhookInput) => ({
      id: 'we_without_secret',
      livemode: false,
      status: 'enabled',
      ...webhookInput,
    });

    await expect(reconcileDocketStripe(fake.client, input)).rejects.toThrow(
      'Stripe did not return the billing webhook signing secret at creation',
    );
  });

  it('rejects mode-mismatched SDK credentials before contacting Stripe', async () => {
    await expect(
      provisionDocketStripe({ ...input, secretKey: 'sk_live_wrong_mode' }),
    ).rejects.toThrow('test Stripe provisioning requires a mode-matched secret or restricted key');
    await expect(
      provisionDocketStripe({ ...input, mode: 'live', secretKey: 'rk_test_wrong_mode' }),
    ).rejects.toThrow('live Stripe provisioning requires a mode-matched secret or restricted key');
  });
});

describe('StripeSdkProvisioningClient', () => {
  const productInput: StripeProductInput = {
    name: 'Docket Pro',
    description: 'Docket Pro description',
    active: true,
    metadata: { docket_resource: 'product' },
  };
  const priceInput: StripePriceInput = {
    productId: 'prod_1',
    currency: 'usd',
    unitAmount: 800,
    interval: 'month',
    lookupKey: DOCKET_PRO_MONTHLY_LOOKUP_KEY,
    nickname: 'Docket Pro — monthly',
    metadata: { docket_resource: 'monthly_price' },
    transferLookupKey: true,
  };
  const portalInput: StripePortalConfigurationInput = {
    name: 'Docket Pro billing',
    defaultReturnUrl: 'https://docket.test/billing/return',
    privacyPolicyUrl: 'https://docket.test/privacy',
    termsOfServiceUrl: 'https://docket.test/terms',
    metadata: { docket_resource: 'billing_portal' },
  };
  const webhookInput: StripeWebhookInput = {
    url: 'https://api.docket.test/internal/billing/webhook',
    description: 'Docket billing',
    enabledEvents: [...DOCKET_STRIPE_WEBHOOK_EVENTS],
    metadata: { docket_resource: 'billing_webhook' },
  };

  it('maps Stripe resources through the provisioning port', async () => {
    const productCreate = vi.fn(async () => ({ id: 'prod_created', livemode: false }));
    const productUpdate = vi.fn(async () => ({ id: 'prod_updated', livemode: false }));
    const priceCreate = vi.fn(async () => ({ id: 'price_created', livemode: false, active: true }));
    const priceUpdate = vi.fn(async () => ({
      id: 'price_updated',
      livemode: false,
      active: false,
      product: { id: 'prod_object' },
      currency: 'usd',
      unit_amount: null,
      recurring: null,
      lookup_key: null,
      nickname: null,
      metadata: null,
    }));
    const portalCreate = vi.fn(async () => ({ id: 'bpc_created', livemode: false, active: true }));
    const portalUpdate = vi.fn(async () => ({ id: 'bpc_updated', livemode: false, active: true }));
    const webhookCreate = vi.fn(async () => ({
      id: 'we_created',
      livemode: false,
      secret: 'whsec_created',
    }));
    const webhookUpdate = vi.fn(async () => ({
      id: 'we_updated',
      livemode: false,
      status: 'disabled',
    }));
    const stripe = {
      products: {
        list: vi.fn(() => ({
          autoPagingToArray: vi.fn(async () => [
            {
              id: 'prod_1',
              livemode: false,
              name: 'Docket Pro',
              description: null,
              active: true,
              metadata: null,
            },
          ]),
        })),
        create: productCreate,
        update: productUpdate,
      },
      prices: {
        list: vi.fn(() => ({
          autoPagingToArray: vi.fn(async () => [
            {
              id: 'price_1',
              livemode: false,
              product: 'prod_1',
              currency: 'usd',
              unit_amount: null,
              recurring: null,
              lookup_key: null,
              nickname: null,
              metadata: null,
              active: true,
            },
          ]),
        })),
        create: priceCreate,
        update: priceUpdate,
      },
      billingPortal: {
        configurations: {
          list: vi.fn(() => ({
            autoPagingToArray: vi.fn(async () => [
              {
                id: 'bpc_1',
                livemode: false,
                active: true,
                name: null,
                default_return_url: null,
                business_profile: { privacy_policy_url: null, terms_of_service_url: null },
                metadata: null,
              },
            ]),
          })),
          create: portalCreate,
          update: portalUpdate,
        },
      },
      webhookEndpoints: {
        list: vi.fn(() => ({
          autoPagingToArray: vi.fn(async () => [
            {
              id: 'we_1',
              livemode: false,
              status: 'disabled',
              url: webhookInput.url,
              description: null,
              enabled_events: [],
              metadata: null,
            },
          ]),
        })),
        create: webhookCreate,
        update: webhookUpdate,
      },
    } as unknown as Stripe;
    const client = new StripeSdkProvisioningClient(stripe, false);

    await expect(client.readState()).resolves.toMatchObject({
      livemode: false,
      products: [{ description: '', metadata: {} }],
      prices: [
        {
          productId: 'prod_1',
          unitAmount: 0,
          interval: '',
          lookupKey: '',
          nickname: '',
          metadata: {},
        },
      ],
      portalConfigurations: [
        {
          name: '',
          defaultReturnUrl: '',
          privacyPolicyUrl: '',
          termsOfServiceUrl: '',
          metadata: {},
        },
      ],
      webhookEndpoints: [{ status: 'disabled', description: '', metadata: {} }],
    });
    await expect(client.createProduct(productInput)).resolves.toMatchObject({ id: 'prod_created' });
    await expect(client.updateProduct('prod_1', productInput)).resolves.toMatchObject({
      id: 'prod_updated',
    });
    await expect(client.createPrice(priceInput)).resolves.toMatchObject({ id: 'price_created' });
    await expect(
      client.createPrice({
        productId: priceInput.productId,
        currency: priceInput.currency,
        unitAmount: priceInput.unitAmount,
        interval: priceInput.interval,
        lookupKey: priceInput.lookupKey,
        nickname: priceInput.nickname,
        metadata: priceInput.metadata,
      }),
    ).resolves.toMatchObject({ id: 'price_created' });
    await expect(
      client.updatePrice('price_1', { active: false, nickname: 'Replacement', metadata: {} }),
    ).resolves.toMatchObject({
      id: 'price_updated',
      productId: 'prod_object',
      unitAmount: 0,
      interval: '',
    });
    await expect(client.updatePrice('price_1', {})).resolves.toMatchObject({ id: 'price_updated' });
    await expect(client.createPortalConfiguration(portalInput)).resolves.toMatchObject({
      id: 'bpc_created',
    });
    await expect(client.updatePortalConfiguration('bpc_1', portalInput)).resolves.toMatchObject({
      id: 'bpc_updated',
    });
    await expect(client.createWebhookEndpoint(webhookInput)).resolves.toMatchObject({
      id: 'we_created',
      secret: 'whsec_created',
    });
    await expect(
      client.updateWebhookEndpoint('we_1', { ...webhookInput, status: 'disabled' }),
    ).resolves.toMatchObject({ id: 'we_updated', status: 'disabled' });

    expect(priceCreate).toHaveBeenCalledWith(
      expect.objectContaining({ transfer_lookup_key: true }),
    );
    expect(portalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        default_return_url: portalInput.defaultReturnUrl,
        features: expect.objectContaining({
          subscription_cancel: expect.objectContaining({ mode: 'at_period_end' }),
        }),
      }),
    );
    expect(webhookUpdate).toHaveBeenCalledWith('we_1', expect.objectContaining({ disabled: true }));
  });
});
