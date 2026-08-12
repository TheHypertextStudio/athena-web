/**
 * Verify the complete Docket Pro purchase lifecycle against Stripe test mode.
 *
 * @remarks
 * Run beside the local API, web app, and `pnpm billing:webhooks`. The flow creates a disposable
 * passkey account and personal task, completes hosted Checkout with Stripe's documented test card,
 * opens the customer portal, cancels the test subscription through Stripe CLI, verifies webhook
 * fallback without data loss, and confirms a second checkout does not offer another trial.
 */
import { chromium, expect, type Frame, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

import { signUpAndOnboard } from '../helpers/app';
import { ORIGIN } from '../helpers/constants';
import { apiJson } from '../helpers/net';
import { addVirtualAuthenticator } from '../helpers/webauthn';

const API_ORIGIN = process.env['API_URL'] ?? 'https://api.docket.localhost';

interface BillingProduct {
  readonly productKey: 'docket_pro';
  readonly status: 'trialing' | 'active' | 'past_due' | 'canceled';
  readonly source: 'stripe' | 'complimentary';
}

interface BillingSummary {
  readonly products: BillingProduct[];
  readonly canManageBilling: boolean;
}

interface StripeSubscriptionSearch {
  readonly data: readonly { readonly id: string; readonly status: string }[];
}

/** Fill the first visible Stripe-hosted input matching any current Checkout selector. */
async function fillStripeField(
  page: Page,
  selectors: readonly string[],
  value: string,
): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt++) {
    for (const frame of page.frames()) {
      for (const selector of selectors) {
        const field = frame.locator(selector).first();
        if ((await field.count()) > 0 && (await field.isVisible())) {
          await field.fill(value);
          return;
        }
      }
    }
    await page.waitForTimeout(250);
  }
  const frames: readonly Frame[] = page.frames();
  await page.screenshot({ path: '/tmp/docket-stripe-checkout.png', fullPage: true });
  const inventory = await Promise.all(
    frames.map(async (frame) => ({
      frame: (() => {
        const url = new URL(frame.url());
        return `${url.origin}${url.pathname}`;
      })(),
      inputs: await frame.locator('input').evaluateAll((inputs) =>
        inputs.map((input) => ({
          name: input.getAttribute('name'),
          type: input.getAttribute('type'),
          label: input.getAttribute('aria-label'),
          placeholder: input.getAttribute('placeholder'),
        })),
      ),
    })),
  );
  throw new Error(
    `Stripe Checkout field not found: ${selectors.join(', ')}; fields=${JSON.stringify(inventory)}`,
  );
}

/** Wait for the webhook-driven organization-product record to reach one exact state. */
async function waitForProductStatus(
  page: Page,
  orgId: string,
  status: BillingProduct['status'],
): Promise<BillingSummary> {
  let summary: BillingSummary | undefined;
  await expect
    .poll(
      async () => {
        summary = await apiJson<BillingSummary>(page, `/v1/orgs/${orgId}/billing`);
        return summary.products[0]?.status;
      },
      { timeout: 30_000, intervals: [250, 500, 1_000] },
    )
    .toBe(status);
  if (!summary) throw new Error('Billing summary was not returned.');
  return summary;
}

/** Find the one test subscription carrying Docket's organization reference. */
async function findStripeSubscription(orgId: string): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const raw = execFileSync(
      'stripe',
      ['subscriptions', 'search', '--query', `metadata['referenceId']:'${orgId}'`, '--limit', '2'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const result = JSON.parse(raw) as StripeSubscriptionSearch;
    if (result.data.length === 1 && result.data[0]) return result.data[0].id;
    if (result.data.length > 1) {
      throw new Error(`Stripe returned multiple test subscriptions for ${orgId}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Stripe Search did not index the test subscription for ${orgId}.`);
}

/** Complete the current hosted Checkout page with Stripe's non-charging test card. */
async function completeCheckout(page: Page, email: string): Promise<void> {
  await expect(page).toHaveURL(/checkout\.stripe\.com/u);
  await expect(page.getByText(/14[- ]day|14 days|free trial/iu).first()).toBeVisible();
  await page.locator('input[name="email"]').fill(email);
  await page
    .locator('input[name="payment-method-accordion-item-title"]')
    .first()
    .check({ force: true });
  for (const checkbox of await page.locator('input[type="checkbox"]:visible').all()) {
    if (await checkbox.isChecked()) await checkbox.uncheck();
  }
  await fillStripeField(
    page,
    ['input[name="cardNumber"]', 'input[name="cardnumber"]'],
    '4242424242424242',
  );
  await fillStripeField(page, ['input[name="cardExpiry"]', 'input[name="exp-date"]'], '1234');
  await fillStripeField(page, ['input[name="cardCvc"]', 'input[name="cvc"]'], '123');
  await fillStripeField(
    page,
    ['input[name="billingName"]', 'input[name="name"]'],
    'Docket Sandbox Customer',
  );
  await fillStripeField(
    page,
    ['input[name="billingPostalCode"]', 'input[name="postalCode"]', 'input[placeholder="ZIP"]'],
    '89101',
  );

  await page.getByTestId('hosted-payment-submit-button').click();
  try {
    await page.waitForURL(
      new RegExp(`^${ORIGIN.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}/billing/return\\?`),
      { timeout: 45_000 },
    );
  } catch (cause) {
    await page.screenshot({ path: '/tmp/docket-stripe-submit.png', fullPage: true });
    throw new Error(`Stripe Checkout did not return from ${page.url()}.`, { cause });
  }
  await expect(page.getByRole('heading', { name: 'Checkout finished' })).toBeVisible();
}

async function main(): Promise<void> {
  if (!API_ORIGIN.includes('.localhost') && !API_ORIGIN.includes('localhost:')) {
    throw new Error('Stripe sandbox verification is local-only.');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: ORIGIN, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await addVirtualAuthenticator(page);

  try {
    const identity = {
      name: 'Docket Sandbox Customer',
      email: `docket-sandbox+${Date.now()}@example.com`,
    };
    console.log('[stripe-sandbox] creating disposable passkey account');
    const { orgId, user } = await signUpAndOnboard(page, identity);
    console.log('[stripe-sandbox] personal workspace created');
    const [teams, members] = await Promise.all([
      apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`),
      apiJson<{ items: { actorId: string }[] }>(page, `/v1/orgs/${orgId}/members`),
    ]);
    const teamId = teams.items[0]?.id;
    const assigneeId = members.items[0]?.actorId;
    if (!teamId || !assigneeId) throw new Error('Personal workspace baseline is incomplete.');

    const taskTitle = `Preserved after Docket Pro cancellation ${Date.now()}`;
    await apiJson(page, `/v1/orgs/${orgId}/tasks`, {
      method: 'POST',
      body: { title: taskTitle, state: 'todo', teamId, assigneeId, estimateMinutes: 30 },
    });

    const billingUrl = `${ORIGIN}/orgs/${orgId}/settings/billing`;
    await page.goto(billingUrl);
    await expect(page.getByRole('button', { name: 'Add Docket Pro' })).toBeVisible();
    await page.getByRole('button', { name: 'Add Docket Pro' }).click();
    console.log('[stripe-sandbox] hosted checkout opened');
    await completeCheckout(page, user.email);
    console.log('[stripe-sandbox] hosted checkout returned');

    const trial = await waitForProductStatus(page, orgId, 'trialing');
    expect(trial.products[0]).toMatchObject({ productKey: 'docket_pro', source: 'stripe' });
    await page.goto(billingUrl);
    await expect(page.getByText('Trialing', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Manage Docket Pro' }).click();
    await expect(page).toHaveURL(/billing\.stripe\.com/u);
    await expect(page.getByText(/Docket Pro/iu).first()).toBeVisible();
    await expect(page.getByText(/cancel subscription/iu).first()).toBeVisible();

    const subscriptionId = await findStripeSubscription(orgId);
    execFileSync('stripe', ['subscriptions', 'cancel', subscriptionId, '--confirm'], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    await page.goto(billingUrl);
    const canceled = await waitForProductStatus(page, orgId, 'canceled');
    expect(canceled.canManageBilling).toBe(true);

    const tasks = await apiJson<{ items: { title: string }[] }>(page, `/v1/orgs/${orgId}/tasks`);
    expect(tasks.items.some((task) => task.title === taskTitle)).toBe(true);
    await expect(page.getByText('Canceled', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Docket Pro' })).toBeVisible();

    await page.getByRole('button', { name: 'Add Docket Pro' }).click();
    await expect(page).toHaveURL(/checkout\.stripe\.com/u);
    await expect(page.getByText(/14[- ]day|14 days|free trial/iu)).toHaveCount(0);

    console.log(
      '[stripe-sandbox] checkout, webhook, portal, cancellation, fallback, and no-retrial passed',
    );
  } finally {
    await browser.close();
  }
}

await main();
