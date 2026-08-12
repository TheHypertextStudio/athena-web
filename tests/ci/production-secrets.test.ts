import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  validateProductionSecretBindings,
  type SecretBinding,
} from '../../scripts/production-secrets';

const BASE_BINDINGS: readonly SecretBinding[] = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'CRON_SECRET',
  'RESEND_API_KEY',
  'MAIL_FROM',
  'DATABASE_URL_UNPOOLED',
  'LINEAR_CLIENT_ID',
  'LINEAR_CLIENT_SECRET',
  'LINEAR_WEBHOOK_SECRET',
].map((envName) => ({ envName, secretName: envName.toLowerCase(), version: 'latest' }));

const BILLING_BINDINGS: readonly SecretBinding[] = [
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'DOCKET_PRICE_LOOKUP_DOCKET_PRO',
].map((envName) => ({ envName, secretName: envName.toLowerCase(), version: 'latest' }));

describe('production Stripe secret policy', () => {
  it('lets the production environment enable billing without a code change', () => {
    const workflow = readFileSync(resolve('.github/workflows/deploy.yml'), 'utf8');

    expect(workflow).not.toContain('BILLING_ENABLED: "false"');
    expect(workflow.match(/vars\.BILLING_ENABLED \|\| 'false'/g)).toHaveLength(2);
  });

  it('keeps Stripe optional while production billing is disabled', () => {
    expect(
      validateProductionSecretBindings(BASE_BINDINGS, () => 'configured', {
        billingEnabled: false,
      }),
    ).toEqual([]);
  });

  it('requires Stripe credentials, webhook verification, and a Docket Pro price when enabled', () => {
    const issues = validateProductionSecretBindings(BASE_BINDINGS, () => 'configured', {
      billingEnabled: true,
    });

    expect(issues.map((issue) => issue.envName)).toEqual([
      'STRIPE_SECRET_KEY',
      'STRIPE_PUBLISHABLE_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'DOCKET_PRICE_LOOKUP_DOCKET_PRO',
    ]);
  });

  it('passes with the complete Docket Pro production binding set', () => {
    expect(
      validateProductionSecretBindings(
        [...BASE_BINDINGS, ...BILLING_BINDINGS],
        () => 'configured',
        { billingEnabled: true },
      ),
    ).toEqual([]);
  });

  it('accepts the legacy Docket Team price binding for the compatibility release', () => {
    const legacyPrice: SecretBinding = {
      envName: 'STRIPE_PRICE_TEAM',
      secretName: 'stripe-price-team',
      version: 'latest',
    };

    expect(
      validateProductionSecretBindings(
        [...BASE_BINDINGS, ...BILLING_BINDINGS.slice(0, 3), legacyPrice],
        () => 'configured',
        { billingEnabled: true },
      ),
    ).toEqual([]);
  });
});
