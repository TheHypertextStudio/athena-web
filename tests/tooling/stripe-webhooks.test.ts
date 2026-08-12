import { describe, expect, it } from 'vitest';

import {
  redactStripeCliOutput,
  stripeListenerArgs,
  stripeWebhookForwardUrl,
} from '../../scripts/stripe-webhooks';

describe('Stripe sandbox webhook listener', () => {
  it('forwards only Docket billing events to the local API handler', () => {
    expect(stripeWebhookForwardUrl('http://api.docket.localhost:4100/')).toBe(
      'http://api.docket.localhost:4100/internal/billing/webhook',
    );
    expect(stripeListenerArgs('http://api.docket.localhost:4100')).toEqual([
      'listen',
      '--events',
      'checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,customer.subscription.trial_will_end,invoice.payment_failed',
      '--forward-to',
      'http://api.docket.localhost:4100/internal/billing/webhook',
    ]);
  });

  it('refuses to forward the sandbox listener to a production host', () => {
    expect(() => stripeWebhookForwardUrl('https://docket-api.hypertext.studio')).toThrow(
      'sandbox-only',
    );
  });

  it('never prints the webhook signing secret from the Stripe CLI ready banner', () => {
    expect(redactStripeCliOutput('Ready! signing secret is whsec_testsecret (^C to quit)')).toBe(
      'Ready! signing secret is [webhook signing secret redacted] (^C to quit)',
    );
  });
});
