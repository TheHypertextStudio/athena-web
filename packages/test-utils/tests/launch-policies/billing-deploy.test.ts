import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WORKSPACE_ROOT } from '../workspace';

describe('billing deployment policy', () => {
  const workflow = readFileSync(resolve(WORKSPACE_ROOT, '.github/workflows/deploy.yml'), 'utf8');

  it('passes the Stripe duplicate-subscription attestation into the API revision', () => {
    expect(workflow).toContain(
      'STRIPE_SINGLE_SUBSCRIPTION_REDIRECT_VERIFIED_AT: "${{ vars.STRIPE_SINGLE_SUBSCRIPTION_REDIRECT_VERIFIED_AT }}"',
    );
  });

  it('passes the explicit scheduled reconciliation rollout mode into the API revision', () => {
    expect(workflow).toContain(
      'BILLING_RECONCILIATION_MODE: "${{ vars.BILLING_RECONCILIATION_MODE }}"',
    );
  });
});
