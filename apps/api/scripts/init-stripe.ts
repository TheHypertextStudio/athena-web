#!/usr/bin/env tsx
/**
 * Interactive CLI to initialize Stripe products and prices for Athena.
 *
 * Usage: pnpm stripe:init
 *
 * This script:
 * 1. Takes API key from env or prompts for it
 * 2. Creates Pro & Team products with metadata
 * 3. Creates monthly/yearly prices for each
 * 4. Configures billing portal
 * 5. Outputs env vars to copy
 *
 * Safe to run multiple times (idempotent).
 */

import 'dotenv/config';
import Stripe from 'stripe';
import * as p from '@clack/prompts';

// Product configuration matching DEFAULT_PLANS in service.ts
const PRODUCTS_CONFIG = {
  pro: {
    name: 'Athena Pro',
    description: 'For power users - unlimited tasks, projects, integrations, and priority support',
    metadata: { athena_plan_id: 'pro' },
    prices: {
      monthly: { amount: 1200, interval: 'month' as const }, // $12/month
      yearly: { amount: 9600, interval: 'year' as const }, // $96/year
    },
  },
  team: {
    name: 'Athena Team',
    description: 'For teams and organizations - collaboration, SSO, and admin controls',
    metadata: { athena_plan_id: 'team' },
    prices: {
      monthly: { amount: 2400, interval: 'month' as const }, // $24/month
      yearly: { amount: 19200, interval: 'year' as const }, // $192/year
    },
  },
} as const;

type PlanId = keyof typeof PRODUCTS_CONFIG;
type Interval = 'month' | 'year';

interface ProductResult {
  id: string;
  status: 'created' | 'existing' | 'updated';
}

interface PriceResult {
  id: string;
  status: 'created' | 'existing' | 'skipped';
  amount: number;
}

interface PortalResult {
  id: string;
  status: 'created' | 'existing' | 'updated';
}

interface InitResult {
  products: Partial<Record<PlanId, ProductResult>>;
  prices: Partial<Record<string, PriceResult>>;
  portal?: PortalResult;
  errors: string[];
}

function maskApiKey(key: string): string {
  if (key.length < 20) return '***';
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}

function isLiveMode(apiKey: string): boolean {
  return apiKey.startsWith('sk_live_');
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function getApiKey(): Promise<string | symbol> {
  const envKey = process.env.STRIPE_SECRET_KEY;

  if (envKey) {
    const useEnv = await p.confirm({
      message: `Use STRIPE_SECRET_KEY from environment? (${maskApiKey(envKey)})`,
      initialValue: true,
    });

    if (p.isCancel(useEnv)) return useEnv;
    if (useEnv) return envKey;
  }

  const key = await p.text({
    message: 'Enter your Stripe Secret Key:',
    placeholder: 'sk_test_...',
    validate: (value) => {
      if (!value) return 'API key is required';
      if (!value.startsWith('sk_test_') && !value.startsWith('sk_live_')) {
        return 'Invalid format. Must start with sk_test_ or sk_live_';
      }
      return undefined;
    },
  });

  return key;
}

async function findExistingProducts(stripe: Stripe): Promise<Map<string, Stripe.Product>> {
  const products = await stripe.products.list({ limit: 100, active: true });
  const map = new Map<string, Stripe.Product>();

  for (const product of products.data) {
    const planId = product.metadata.athena_plan_id;
    if (planId) {
      map.set(planId, product);
    }
  }

  return map;
}

async function ensureProduct(
  stripe: Stripe,
  planId: PlanId,
  config: (typeof PRODUCTS_CONFIG)[PlanId],
  existing: Map<string, Stripe.Product>,
): Promise<ProductResult> {
  const existingProduct = existing.get(planId);

  if (existingProduct) {
    // Check if update needed
    const needsUpdate =
      existingProduct.name !== config.name || existingProduct.description !== config.description;

    if (!needsUpdate) {
      return { id: existingProduct.id, status: 'existing' };
    }

    const action = await p.select({
      message: `Product "${config.name}" exists but has different settings. What to do?`,
      options: [
        { value: 'update', label: 'Update product (recommended)' },
        { value: 'skip', label: 'Skip (keep existing)' },
      ],
    });

    if (p.isCancel(action)) {
      throw new Error('Operation cancelled');
    }

    if (action === 'update') {
      await stripe.products.update(existingProduct.id, {
        name: config.name,
        description: config.description,
      });
      return { id: existingProduct.id, status: 'updated' };
    }

    return { id: existingProduct.id, status: 'existing' };
  }

  // Create new product
  const product = await stripe.products.create({
    name: config.name,
    description: config.description,
    metadata: config.metadata,
  });

  return { id: product.id, status: 'created' };
}

async function findExistingPrices(
  stripe: Stripe,
  productId: string,
): Promise<Map<Interval, Stripe.Price>> {
  const prices = await stripe.prices.list({
    product: productId,
    active: true,
    limit: 10,
  });

  const map = new Map<Interval, Stripe.Price>();

  for (const price of prices.data) {
    const interval = price.recurring?.interval;
    if (interval === 'month' || interval === 'year') {
      map.set(interval, price);
    }
  }

  return map;
}

async function ensurePrice(
  stripe: Stripe,
  productId: string,
  expectedAmount: number,
  interval: Interval,
): Promise<PriceResult> {
  const existingPrices = await findExistingPrices(stripe, productId);
  const existingPrice = existingPrices.get(interval);

  if (existingPrice) {
    // Check if amount matches
    if (existingPrice.unit_amount === expectedAmount) {
      return {
        id: existingPrice.id,
        status: 'existing',
        amount: expectedAmount,
      };
    }

    // Price exists with different amount
    const action = await p.select({
      message: `${interval}ly price exists at ${formatCurrency(existingPrice.unit_amount ?? 0)} (expected ${formatCurrency(expectedAmount)}). What to do?`,
      options: [
        {
          value: 'create',
          label: `Create new price at ${formatCurrency(expectedAmount)} and archive old`,
        },
        {
          value: 'keep',
          label: `Keep existing price at ${formatCurrency(existingPrice.unit_amount ?? 0)}`,
        },
      ],
    });

    if (p.isCancel(action)) {
      throw new Error('Operation cancelled');
    }

    if (action === 'keep') {
      return {
        id: existingPrice.id,
        status: 'skipped',
        amount: existingPrice.unit_amount ?? 0,
      };
    }

    // Archive old price
    await stripe.prices.update(existingPrice.id, { active: false });
  }

  // Create new price
  const price = await stripe.prices.create({
    product: productId,
    unit_amount: expectedAmount,
    currency: 'usd',
    recurring: { interval },
    metadata: { athena_interval: interval },
  });

  return { id: price.id, status: 'created', amount: expectedAmount };
}

async function ensureBillingPortal(stripe: Stripe, result: InitResult): Promise<PortalResult> {
  const configs = await stripe.billingPortal.configurations.list({ limit: 1 });

  // Build product configuration for portal
  const portalProducts: Stripe.BillingPortal.ConfigurationCreateParams.Features.SubscriptionUpdate.Product[] =
    [];

  for (const planId of ['pro', 'team'] as const) {
    const product = result.products[planId];
    const monthlyPrice = result.prices[`${planId}Monthly`];
    const yearlyPrice = result.prices[`${planId}Yearly`];

    if (product && monthlyPrice && yearlyPrice) {
      portalProducts.push({
        product: product.id,
        prices: [monthlyPrice.id, yearlyPrice.id],
      });
    }
  }

  const portalParams: Stripe.BillingPortal.ConfigurationUpdateParams = {
    business_profile: {
      headline: 'Manage your Athena subscription',
    },
    features: {
      customer_update: {
        enabled: true,
        allowed_updates: ['email', 'name', 'address'],
      },
      invoice_history: {
        enabled: true,
      },
      payment_method_update: {
        enabled: true,
      },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end',
      },
      subscription_update: {
        enabled: portalProducts.length > 0,
        default_allowed_updates: ['price'],
        products: portalProducts.length > 0 ? portalProducts : undefined,
      },
    },
  };

  if (configs.data.length > 0) {
    const existing = configs.data[0];
    if (existing) {
      await stripe.billingPortal.configurations.update(existing.id, portalParams);
      return { id: existing.id, status: 'updated' };
    }
  }

  const config = await stripe.billingPortal.configurations.create({
    ...portalParams,
    default_return_url: 'http://localhost:3000/settings/billing',
  } as Stripe.BillingPortal.ConfigurationCreateParams);

  return { id: config.id, status: 'created' };
}

function displayResults(result: InitResult): void {
  const productLines = Object.entries(result.products).map(([plan, r]) => {
    const productResult = r as ProductResult | undefined;
    return `  ${plan}: ${productResult?.id ?? 'N/A'} (${productResult?.status ?? 'unknown'})`;
  });

  const priceLines = Object.entries(result.prices).map(([key, r]) => {
    const priceResult = r;
    return `  ${key}: ${priceResult?.id ?? 'N/A'} (${priceResult?.status ?? 'unknown'}, ${formatCurrency(priceResult?.amount ?? 0)})`;
  });

  const portalId = result.portal?.id ?? 'N/A';
  const portalStatus = result.portal?.status ?? 'unknown';

  p.note(
    [
      'Products:',
      ...productLines,
      '',
      'Prices:',
      ...priceLines,
      '',
      'Billing Portal:',
      `  ${portalId} (${portalStatus})`,
    ].join('\n'),
    'Summary',
  );
}

function outputEnvVariables(result: InitResult): void {
  const envVars = [
    '# Stripe Billing - Copy to .env',
    'STRIPE_SECRET_KEY=<your-key-here>',
    'STRIPE_WEBHOOK_SECRET=<run: stripe listen --forward-to localhost:4000/api/billing/webhook>',
    `STRIPE_PRICE_ID_PRO_MONTHLY=${result.prices.proMonthly?.id ?? ''}`,
    `STRIPE_PRICE_ID_PRO_YEARLY=${result.prices.proYearly?.id ?? ''}`,
    `STRIPE_PRICE_ID_TEAM_MONTHLY=${result.prices.teamMonthly?.id ?? ''}`,
    `STRIPE_PRICE_ID_TEAM_YEARLY=${result.prices.teamYearly?.id ?? ''}`,
  ];

  p.note(envVars.join('\n'), 'Environment Variables');

  p.log.info('Next steps:');
  p.log.step('1. Copy the environment variables above to your .env file');
  p.log.step('2. Run: stripe listen --forward-to localhost:4000/api/billing/webhook');
  p.log.step('3. Copy the webhook signing secret (whsec_...) to .env');
  p.log.step('4. Test with: npx tsx scripts/test-stripe-integration.ts');
}

async function main(): Promise<void> {
  p.intro('Athena Stripe Initialization');

  // Step 1: Get API key
  const apiKey = await getApiKey();
  if (p.isCancel(apiKey)) {
    p.cancel('Operation cancelled');
    process.exit(0);
  }

  // Step 2: Safety check for live mode
  if (isLiveMode(apiKey)) {
    const proceed = await p.confirm({
      message: 'WARNING: You are using a LIVE Stripe key. Real charges may occur. Continue?',
      initialValue: false,
    });

    if (p.isCancel(proceed) || !proceed) {
      p.cancel('Operation cancelled');
      process.exit(0);
    }
  }

  const stripe = new Stripe(apiKey, {
    apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion,
  });

  const result: InitResult = {
    products: {},
    prices: {},
    errors: [],
  };

  // Step 3: Products
  const productSpinner = p.spinner();
  productSpinner.start('Checking existing products...');

  let existingProducts: Map<string, Stripe.Product>;
  try {
    existingProducts = await findExistingProducts(stripe);
    productSpinner.stop(`Found ${String(existingProducts.size)} existing Athena products`);
  } catch (err: unknown) {
    productSpinner.stop('Failed to fetch products');
    p.log.error(err instanceof Error ? err.message : 'Unknown error');
    process.exit(1);
  }

  for (const planId of ['pro', 'team'] as const) {
    try {
      const productResult = await ensureProduct(
        stripe,
        planId,
        PRODUCTS_CONFIG[planId],
        existingProducts,
      );
      result.products[planId] = productResult;
      p.log.success(
        `${PRODUCTS_CONFIG[planId].name}: ${productResult.id} (${productResult.status})`,
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'Operation cancelled') {
        p.cancel('Operation cancelled');
        process.exit(0);
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Product ${planId}: ${errMsg}`);
      p.log.error(`Failed to create ${planId} product: ${errMsg}`);
    }
  }

  // Step 4: Prices
  const priceSpinner = p.spinner();
  priceSpinner.start('Configuring prices...');
  priceSpinner.stop('Configuring prices');

  for (const planId of ['pro', 'team'] as const) {
    const product = result.products[planId];
    if (!product) continue;

    const config = PRODUCTS_CONFIG[planId];

    for (const [intervalKey, priceConfig] of Object.entries(config.prices) as [
      string,
      { amount: number; interval: Interval },
    ][]) {
      const priceKey = `${planId}${intervalKey.charAt(0).toUpperCase() + intervalKey.slice(1)}`;

      try {
        const priceResult = await ensurePrice(
          stripe,
          product.id,
          priceConfig.amount,
          priceConfig.interval,
        );
        result.prices[priceKey] = priceResult;
        p.log.success(
          `${priceKey}: ${priceResult.id} (${priceResult.status}, ${formatCurrency(priceResult.amount)})`,
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.message === 'Operation cancelled') {
          p.cancel('Operation cancelled');
          process.exit(0);
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Price ${priceKey}: ${errMsg}`);
        p.log.error(`Failed to create ${priceKey} price: ${errMsg}`);
      }
    }
  }

  // Step 5: Billing Portal
  const portalSpinner = p.spinner();
  portalSpinner.start('Configuring billing portal...');

  try {
    result.portal = await ensureBillingPortal(stripe, result);
    portalSpinner.stop(`Billing portal: ${result.portal.id} (${result.portal.status})`);
  } catch (err: unknown) {
    portalSpinner.stop('Failed to configure billing portal');
    const errMsg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Billing portal: ${errMsg}`);
    p.log.error(`Failed to configure billing portal: ${errMsg}`);
  }

  // Step 6: Output
  displayResults(result);
  outputEnvVariables(result);

  if (result.errors.length > 0) {
    p.outro(`Completed with ${String(result.errors.length)} error(s)`);
    process.exit(1);
  } else {
    p.outro('Stripe initialization complete!');
  }
}

main().catch((err: unknown) => {
  p.log.error(err instanceof Error ? err.message : 'Unknown error');
  process.exit(1);
});
