import { describe, expect, it } from 'vitest';

import {
  evaluateBillingRuntimeRollout,
  type BillingRuntimeObservation,
} from '../../scripts/billing-runtime-rollout';

function observation(
  scheduler: Partial<BillingRuntimeObservation['scheduler']> = {},
): BillingRuntimeObservation {
  const serviceUrl = 'https://docket-api.example';
  return {
    generatedAt: '2026-08-29T17:30:00.000Z',
    revision: 'docket-api-00212-zmq',
    serviceUrl,
    checkoutEnabled: false,
    reconciliationMode: 'shadow',
    expectedReconciliationMode: 'shadow',
    stripeAccountId: 'acct_hypertext',
    expectedStripeAccountId: 'acct_hypertext',
    scheduler: {
      name: 'docket-billing-reconciliation',
      schedule: '*/15 * * * *',
      state: 'ENABLED',
      uri: `${serviceUrl}/internal/cron/billing-reconciliation`,
      lastAttemptTime: '2026-08-29T17:15:00.000Z',
      statusCode: 0,
      ...scheduler,
    },
  };
}

describe('evaluateBillingRuntimeRollout', () => {
  it.each([
    ['public Checkout', { checkoutEnabled: true }, 'checkout_enabled'],
    ['the wrong reconciliation mode', { reconciliationMode: 'active' }, 'reconciliation_mode'],
    ['the wrong Stripe account', { stripeAccountId: 'acct_other' }, 'stripe_account'],
  ] as const)('rejects %s', (_name, change, problem) => {
    const report = evaluateBillingRuntimeRollout({ ...observation(), ...change });

    expect(report.passed).toBe(false);
    expect(report.mismatches).toContain(problem);
  });

  it.each([
    ['a disabled Scheduler', { state: 'PAUSED' }, 'scheduler_state'],
    ['the wrong Scheduler cadence', { schedule: '17 * * * *' }, 'scheduler_schedule'],
    ['the wrong Scheduler target', { uri: 'https://example.com/wrong' }, 'scheduler_uri'],
    ['a failed Scheduler attempt', { statusCode: 13 }, 'scheduler_status'],
  ] as const)('rejects %s', (_name, change, problem) => {
    const report = evaluateBillingRuntimeRollout(observation(change));

    expect(report.passed).toBe(false);
    expect(report.mismatches).toContain(problem);
  });

  it('rejects a Scheduler that has never attempted reconciliation', () => {
    const report = evaluateBillingRuntimeRollout(
      observation({ lastAttemptTime: null, statusCode: null }),
    );

    expect(report.passed).toBe(false);
    expect(report.mismatches).toContain('scheduler_never_run');
  });

  it('rejects a Scheduler whose latest attempt is older than two scheduled intervals', () => {
    const report = evaluateBillingRuntimeRollout(
      observation({ lastAttemptTime: '2026-08-29T16:59:59.000Z' }),
    );

    expect(report.passed).toBe(false);
    expect(report.mismatches).toContain('scheduler_stale');
  });

  it('accepts a successful reconciliation within the current observation window', () => {
    const report = evaluateBillingRuntimeRollout(observation());

    expect(report.passed).toBe(true);
    expect(report.mismatches).toEqual([]);
  });
});
