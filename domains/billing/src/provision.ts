/**
 * Idempotent Stripe desired-state provisioning for Docket Pro.
 *
 * @remarks
 * The standard integration bootstrap calls this module in test mode first and live mode second.
 * Product, price, customer portal, and webhook resources are reconciled from one declaration.
 */
import Stripe from 'stripe';

import { STRIPE_API_VERSION } from './adapters/stripe';

/** Stable product key used by Docket and Stripe metadata. */
export const DOCKET_PRO_PRODUCT_KEY = 'docket_pro';

/** Stable Stripe lookup key resolved by checkout at runtime. */
export const DOCKET_PRO_MONTHLY_LOOKUP_KEY = 'docket_pro_monthly';

/** Events consumed by Docket's normalized billing webhook handler. */
export const DOCKET_STRIPE_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'invoice.payment_failed',
] as const;

const MANAGED_BY_KEY = 'docket_managed_by';
const MANAGED_BY_VALUE = 'bootstrap';
const RESOURCE_KEY = 'docket_resource';

/** Stripe operating mode selected by the setup environment. */
export type StripeMode = 'test' | 'live';

/** Metadata shape used by the narrow provisioning port. */
export type StripeProvisioningMetadata = Readonly<Record<string, string>>;

/** Desired product fields owned by bootstrap. */
export interface StripeProductInput {
  readonly name: string;
  readonly description: string;
  readonly active: boolean;
  readonly metadata: StripeProvisioningMetadata;
}

/** Product fields used to identify and reconcile an existing object. */
export interface StripeProductState extends StripeProductInput {
  readonly id: string;
  readonly livemode: boolean;
}

/** Desired recurring price fields owned by bootstrap. */
export interface StripePriceInput {
  readonly productId: string;
  readonly currency: string;
  readonly unitAmount: number;
  readonly interval: 'month';
  readonly lookupKey: string;
  readonly nickname: string;
  readonly metadata: StripeProvisioningMetadata;
  readonly transferLookupKey?: boolean;
}

/** Price fields used to identify and reconcile an existing object. */
export interface StripePriceState extends Omit<StripePriceInput, 'interval'> {
  readonly id: string;
  readonly livemode: boolean;
  readonly interval: string;
  active: boolean;
}

/** Mutable price fields supported after creation. */
export interface StripePriceUpdate {
  readonly active?: boolean;
  readonly nickname?: string;
  readonly metadata?: StripeProvisioningMetadata;
}

/** Desired customer-portal behavior. */
export interface StripePortalConfigurationInput {
  readonly name: string;
  readonly defaultReturnUrl: string;
  readonly privacyPolicyUrl: string;
  readonly termsOfServiceUrl: string;
  readonly metadata: StripeProvisioningMetadata;
}

/** Portal fields used to identify and reconcile an existing object. */
export interface StripePortalConfigurationState extends StripePortalConfigurationInput {
  readonly id: string;
  readonly livemode: boolean;
  readonly active: boolean;
}

/** Desired billing-webhook behavior. */
export interface StripeWebhookInput {
  readonly url: string;
  readonly description: string;
  readonly enabledEvents: readonly string[];
  readonly metadata: StripeProvisioningMetadata;
}

/** Webhook fields used to identify and reconcile an existing object. */
export interface StripeWebhookState extends StripeWebhookInput {
  readonly id: string;
  readonly livemode: boolean;
  readonly status: 'enabled' | 'disabled';
  readonly secret?: string;
}

/** Mutable webhook fields supported after creation. */
export interface StripeWebhookUpdate extends StripeWebhookInput {
  readonly status?: 'enabled' | 'disabled';
}

/** Complete Stripe state needed by the reconciler. */
export interface StripeProvisioningState {
  readonly livemode: boolean;
  readonly products: StripeProductState[];
  readonly prices: StripePriceState[];
  readonly portalConfigurations: StripePortalConfigurationState[];
  readonly webhookEndpoints: StripeWebhookState[];
}

/** Narrow Stripe provisioning port used by the pure reconciler. */
export interface StripeProvisioningClient {
  readState(): Promise<StripeProvisioningState>;
  createProduct(input: StripeProductInput): Promise<StripeProductState>;
  updateProduct(id: string, input: StripeProductInput): Promise<StripeProductState>;
  createPrice(input: StripePriceInput): Promise<StripePriceState>;
  updatePrice(id: string, input: StripePriceUpdate): Promise<StripePriceState>;
  createPortalConfiguration(
    input: StripePortalConfigurationInput,
  ): Promise<StripePortalConfigurationState>;
  updatePortalConfiguration(
    id: string,
    input: StripePortalConfigurationInput,
  ): Promise<StripePortalConfigurationState>;
  createWebhookEndpoint(input: StripeWebhookInput): Promise<StripeWebhookState>;
  updateWebhookEndpoint(id: string, input: StripeWebhookUpdate): Promise<StripeWebhookState>;
}

/** Inputs shared by test- and live-mode reconciliation. */
export interface ReconcileDocketStripeInput {
  readonly mode: StripeMode;
  readonly apiOrigin: string;
  readonly webOrigin: string;
  readonly webhookTransport?: 'endpoint' | 'stripe-cli';
  readonly existingWebhookSecret?: string;
}

/** Runtime variables emitted by successful provisioning. */
export interface DocketStripeRuntimeValues {
  readonly BILLING_ENABLED: 'true';
  readonly DOCKET_PRICE_LOOKUP_DOCKET_PRO: typeof DOCKET_PRO_MONTHLY_LOOKUP_KEY;
  readonly STRIPE_PRICE_DOCKET_PRO: string;
  readonly STRIPE_BILLING_PORTAL_CONFIG_ID: string;
  readonly STRIPE_WEBHOOK_SECRET: string;
}

/** Successful provisioning result. */
export interface DocketStripeProvisioningResult {
  readonly values: DocketStripeRuntimeValues;
  readonly actions: readonly string[];
}

function managedMetadata(resource: string): StripeProvisioningMetadata {
  return { [MANAGED_BY_KEY]: MANAGED_BY_VALUE, [RESOURCE_KEY]: resource };
}

function isManaged(metadata: StripeProvisioningMetadata, resource: string): boolean {
  return metadata[MANAGED_BY_KEY] === MANAGED_BY_VALUE && metadata[RESOURCE_KEY] === resource;
}

function only<T>(values: readonly T[], label: string): T | undefined {
  if (values.length > 1) throw new Error(`Stripe has multiple bootstrap-managed ${label} objects.`);
  return values[0];
}

function normalizedOrigin(raw: string, field: string): string {
  const url = new URL(raw);
  const local =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname.endsWith('.localhost');
  if (url.protocol !== 'https:' && !local)
    throw new Error(`${field} must use HTTPS outside localhost.`);
  return url.origin;
}

function stripeCliSigningSecret(input: ReconcileDocketStripeInput): string | undefined {
  if (input.webhookTransport !== 'stripe-cli') return undefined;
  if (input.mode !== 'test') throw new Error('Stripe CLI webhook forwarding is sandbox-only.');
  if (!input.existingWebhookSecret?.startsWith('whsec_')) {
    throw new Error('Stripe CLI webhook forwarding requires its whsec_ signing secret.');
  }
  return input.existingWebhookSecret;
}

function matchingPrice(price: StripePriceState, productId: string): boolean {
  return (
    price.productId === productId &&
    price.currency === 'usd' &&
    price.unitAmount === 800 &&
    price.interval === 'month'
  );
}

/** Reconcile one Stripe account to Docket Pro's declared billing state. */
export async function reconcileDocketStripe(
  client: StripeProvisioningClient,
  input: ReconcileDocketStripeInput,
): Promise<DocketStripeProvisioningResult> {
  const cliSigningSecret = stripeCliSigningSecret(input);
  const state = await client.readState();
  const expectedLive = input.mode === 'live';
  if (state.livemode !== expectedLive) {
    throw new Error(
      `${input.mode} provisioning received ${state.livemode ? 'live' : 'test'}-mode Stripe state.`,
    );
  }

  const apiOrigin = normalizedOrigin(input.apiOrigin, 'Stripe API origin');
  const webOrigin = normalizedOrigin(input.webOrigin, 'Stripe web origin');
  const actions: string[] = [];
  const productInput: StripeProductInput = {
    name: 'Docket Pro',
    description: 'Shared work, integrations, MCP, Athena, and voice for one Docket organization.',
    active: true,
    metadata: { ...managedMetadata('product'), docket_product_key: DOCKET_PRO_PRODUCT_KEY },
  };
  const managedProducts = state.products.filter(
    (value) =>
      isManaged(value.metadata, 'product') ||
      value.metadata['docket_product_key'] === DOCKET_PRO_PRODUCT_KEY,
  );
  const namedProducts = state.products.filter(
    (value) => value.name === 'Docket Pro' || value.name === 'Docket Team',
  );
  const existingProduct = only(
    managedProducts.length > 0 ? managedProducts : namedProducts,
    'Docket Pro product',
  );
  const product = existingProduct
    ? await client.updateProduct(existingProduct.id, productInput)
    : await client.createProduct(productInput);
  actions.push(existingProduct ? 'updated Docket Pro product' : 'created Docket Pro product');

  const priceInput: StripePriceInput = {
    productId: product.id,
    currency: 'usd',
    unitAmount: 800,
    interval: 'month',
    lookupKey: DOCKET_PRO_MONTHLY_LOOKUP_KEY,
    nickname: 'Docket Pro — monthly',
    metadata: managedMetadata('monthly_price'),
  };
  const existingPrice = only(
    state.prices.filter(
      (value) => value.lookupKey === DOCKET_PRO_MONTHLY_LOOKUP_KEY && value.active,
    ),
    'Docket Pro monthly price',
  );
  let price: StripePriceState;
  if (!existingPrice) {
    price = await client.createPrice(priceInput);
    actions.push('created Docket Pro monthly price');
  } else if (!matchingPrice(existingPrice, product.id)) {
    price = await client.createPrice({ ...priceInput, transferLookupKey: true });
    await client.updatePrice(existingPrice.id, { active: false });
    actions.push('replaced drifted Docket Pro monthly price');
  } else {
    price = await client.updatePrice(existingPrice.id, {
      active: true,
      nickname: priceInput.nickname,
      metadata: priceInput.metadata,
    });
  }

  const portalInput: StripePortalConfigurationInput = {
    name: 'Docket Pro billing',
    defaultReturnUrl: `${webOrigin}/billing/return`,
    privacyPolicyUrl: `${webOrigin}/privacy`,
    termsOfServiceUrl: `${webOrigin}/terms`,
    metadata: managedMetadata('billing_portal'),
  };
  const existingPortal = only(
    state.portalConfigurations.filter((value) => isManaged(value.metadata, 'billing_portal')),
    'Docket Pro billing portal',
  );
  const portal = existingPortal
    ? await client.updatePortalConfiguration(existingPortal.id, portalInput)
    : await client.createPortalConfiguration(portalInput);
  actions.push(existingPortal ? 'updated billing portal' : 'created billing portal');

  if (cliSigningSecret) {
    actions.push('configured Stripe CLI webhook forwarding');
    return {
      values: {
        BILLING_ENABLED: 'true',
        DOCKET_PRICE_LOOKUP_DOCKET_PRO: DOCKET_PRO_MONTHLY_LOOKUP_KEY,
        STRIPE_PRICE_DOCKET_PRO: price.id,
        STRIPE_BILLING_PORTAL_CONFIG_ID: portal.id,
        STRIPE_WEBHOOK_SECRET: cliSigningSecret,
      },
      actions,
    };
  }

  const webhookInput: StripeWebhookInput = {
    url: `${apiOrigin}/internal/billing/webhook`,
    description: 'Docket billing (managed by pnpm integrations)',
    enabledEvents: DOCKET_STRIPE_WEBHOOK_EVENTS,
    metadata: managedMetadata('billing_webhook'),
  };
  const unmanagedAtUrl = state.webhookEndpoints.filter(
    (value) => value.url === webhookInput.url && !isManaged(value.metadata, 'billing_webhook'),
  );
  if (unmanagedAtUrl.length > 0) {
    throw new Error(
      `Stripe already has an unmanaged webhook at ${webhookInput.url}; remove or adopt it before provisioning.`,
    );
  }
  const existingWebhook = only(
    state.webhookEndpoints.filter(
      (value) => value.status === 'enabled' && isManaged(value.metadata, 'billing_webhook'),
    ),
    'Docket billing webhook',
  );
  let webhookSecret = input.existingWebhookSecret;
  if (!existingWebhook) {
    const created = await client.createWebhookEndpoint(webhookInput);
    webhookSecret = created.secret;
    actions.push('created billing webhook');
  } else if (webhookSecret) {
    await client.updateWebhookEndpoint(existingWebhook.id, { ...webhookInput, status: 'enabled' });
    actions.push('updated billing webhook');
  } else {
    const replacement = await client.createWebhookEndpoint(webhookInput);
    webhookSecret = replacement.secret;
    await client.updateWebhookEndpoint(existingWebhook.id, { ...webhookInput, status: 'disabled' });
    actions.push('rotated billing webhook signing secret');
  }
  if (!webhookSecret) {
    throw new Error('Stripe did not return the billing webhook signing secret at creation.');
  }
  return {
    values: {
      BILLING_ENABLED: 'true',
      DOCKET_PRICE_LOOKUP_DOCKET_PRO: DOCKET_PRO_MONTHLY_LOOKUP_KEY,
      STRIPE_PRICE_DOCKET_PRO: price.id,
      STRIPE_BILLING_PORTAL_CONFIG_ID: portal.id,
      STRIPE_WEBHOOK_SECRET: webhookSecret,
    },
    actions,
  };
}

function metadata(value: Stripe.Metadata | null): Record<string, string> {
  return value ? { ...value } : {};
}

/** Official Stripe SDK adapter for the narrow provisioning port. */
export class StripeSdkProvisioningClient implements StripeProvisioningClient {
  constructor(
    private readonly stripe: Stripe,
    private readonly livemode: boolean,
  ) {}

  async readState(): Promise<StripeProvisioningState> {
    const [products, prices, portalConfigurations, webhookEndpoints] = await Promise.all([
      this.stripe.products.list({ limit: 100 }).autoPagingToArray({ limit: 1000 }),
      this.stripe.prices.list({ limit: 100 }).autoPagingToArray({ limit: 1000 }),
      this.stripe.billingPortal.configurations
        .list({ active: true, limit: 100 })
        .autoPagingToArray({ limit: 1000 }),
      this.stripe.webhookEndpoints.list({ limit: 100 }).autoPagingToArray({ limit: 1000 }),
    ]);
    return {
      livemode: this.livemode,
      products: products.map((value) => ({
        id: value.id,
        livemode: value.livemode,
        name: value.name,
        description: value.description ?? '',
        active: value.active,
        metadata: metadata(value.metadata),
      })),
      prices: prices.map((value) => ({
        id: value.id,
        livemode: value.livemode,
        productId: typeof value.product === 'string' ? value.product : value.product.id,
        currency: value.currency,
        unitAmount: value.unit_amount ?? 0,
        interval: value.recurring?.interval ?? '',
        lookupKey: value.lookup_key ?? '',
        nickname: value.nickname ?? '',
        metadata: metadata(value.metadata),
        active: value.active,
      })),
      portalConfigurations: portalConfigurations.map((value) => ({
        id: value.id,
        livemode: value.livemode,
        active: value.active,
        name: value.name ?? '',
        defaultReturnUrl: value.default_return_url ?? '',
        privacyPolicyUrl: value.business_profile.privacy_policy_url ?? '',
        termsOfServiceUrl: value.business_profile.terms_of_service_url ?? '',
        metadata: metadata(value.metadata),
      })),
      webhookEndpoints: webhookEndpoints.map((value) => ({
        id: value.id,
        livemode: value.livemode,
        status: value.status === 'disabled' ? 'disabled' : 'enabled',
        url: value.url,
        description: value.description ?? '',
        enabledEvents: value.enabled_events,
        metadata: metadata(value.metadata),
        ...(value.secret ? { secret: value.secret } : {}),
      })),
    };
  }

  async createProduct(input: StripeProductInput): Promise<StripeProductState> {
    const value = await this.stripe.products.create({ ...input });
    return { id: value.id, livemode: value.livemode, ...input };
  }

  async updateProduct(id: string, input: StripeProductInput): Promise<StripeProductState> {
    const value = await this.stripe.products.update(id, { ...input });
    return { id: value.id, livemode: value.livemode, ...input };
  }

  async createPrice(input: StripePriceInput): Promise<StripePriceState> {
    const value = await this.stripe.prices.create({
      product: input.productId,
      currency: input.currency,
      unit_amount: input.unitAmount,
      recurring: { interval: input.interval },
      lookup_key: input.lookupKey,
      nickname: input.nickname,
      metadata: { ...input.metadata },
      ...(input.transferLookupKey ? { transfer_lookup_key: true } : {}),
    });
    return { id: value.id, livemode: value.livemode, active: value.active, ...input };
  }

  async updatePrice(id: string, input: StripePriceUpdate): Promise<StripePriceState> {
    const value = await this.stripe.prices.update(id, {
      ...(input.active === undefined ? {} : { active: input.active }),
      ...(input.nickname === undefined ? {} : { nickname: input.nickname }),
      ...(input.metadata === undefined ? {} : { metadata: { ...input.metadata } }),
    });
    return {
      id: value.id,
      livemode: value.livemode,
      active: value.active,
      productId: typeof value.product === 'string' ? value.product : value.product.id,
      currency: value.currency,
      unitAmount: value.unit_amount ?? 0,
      interval: value.recurring?.interval ?? '',
      lookupKey: value.lookup_key ?? '',
      nickname: value.nickname ?? '',
      metadata: metadata(value.metadata),
    };
  }

  private portalParams(
    input: StripePortalConfigurationInput,
  ): Stripe.BillingPortal.ConfigurationCreateParams {
    return {
      name: input.name,
      default_return_url: input.defaultReturnUrl,
      business_profile: {
        headline: 'Manage Docket Pro.',
        privacy_policy_url: input.privacyPolicyUrl,
        terms_of_service_url: input.termsOfServiceUrl,
      },
      features: {
        customer_update: { enabled: true, allowed_updates: ['email', 'address', 'tax_id'] },
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: {
          enabled: true,
          mode: 'at_period_end',
          cancellation_reason: {
            enabled: true,
            options: ['too_expensive', 'missing_features', 'unused', 'other'],
          },
        },
        subscription_update: { enabled: false },
      },
      login_page: { enabled: false },
      metadata: { ...input.metadata },
    };
  }

  async createPortalConfiguration(
    input: StripePortalConfigurationInput,
  ): Promise<StripePortalConfigurationState> {
    const value = await this.stripe.billingPortal.configurations.create(this.portalParams(input));
    return { id: value.id, livemode: value.livemode, active: value.active, ...input };
  }

  async updatePortalConfiguration(
    id: string,
    input: StripePortalConfigurationInput,
  ): Promise<StripePortalConfigurationState> {
    const value = await this.stripe.billingPortal.configurations.update(
      id,
      this.portalParams(input),
    );
    return { id: value.id, livemode: value.livemode, active: value.active, ...input };
  }

  async createWebhookEndpoint(input: StripeWebhookInput): Promise<StripeWebhookState> {
    const value = await this.stripe.webhookEndpoints.create({
      url: input.url,
      description: input.description,
      enabled_events: [...input.enabledEvents] as Stripe.WebhookEndpointCreateParams.EnabledEvent[],
      metadata: { ...input.metadata },
    });
    return {
      id: value.id,
      livemode: value.livemode,
      status: 'enabled',
      ...input,
      ...(value.secret ? { secret: value.secret } : {}),
    };
  }

  async updateWebhookEndpoint(id: string, input: StripeWebhookUpdate): Promise<StripeWebhookState> {
    const value = await this.stripe.webhookEndpoints.update(id, {
      url: input.url,
      description: input.description,
      enabled_events: [...input.enabledEvents] as Stripe.WebhookEndpointUpdateParams.EnabledEvent[],
      metadata: { ...input.metadata },
      ...(input.status ? { disabled: input.status === 'disabled' } : {}),
    });
    return {
      id: value.id,
      livemode: value.livemode,
      status: value.status === 'disabled' ? 'disabled' : 'enabled',
      ...input,
    };
  }
}

/** Inputs for the official-SDK provisioning entrypoint used by bootstrap. */
export interface ProvisionDocketStripeInput extends ReconcileDocketStripeInput {
  readonly secretKey: string;
}

/** Provision Docket Pro with the official Stripe SDK. */
export async function provisionDocketStripe(
  input: ProvisionDocketStripeInput,
): Promise<DocketStripeProvisioningResult> {
  const expectedPrefixes =
    input.mode === 'live'
      ? (['sk_live_', 'rk_live_'] as const)
      : (['sk_test_', 'rk_test_'] as const);
  if (!expectedPrefixes.some((prefix) => input.secretKey.startsWith(prefix))) {
    throw new Error(
      `${input.mode} Stripe provisioning requires a mode-matched secret or restricted key.`,
    );
  }
  type StripeOptions = NonNullable<ConstructorParameters<typeof Stripe>[1]>;
  const apiVersion = STRIPE_API_VERSION as NonNullable<StripeOptions['apiVersion']>;
  const stripe = new Stripe(input.secretKey, { apiVersion });
  return reconcileDocketStripe(
    new StripeSdkProvisioningClient(stripe, input.mode === 'live'),
    input,
  );
}
