import { existsSync, readFileSync } from 'node:fs';
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

  it('passes the Better Auth billing canary allowlist into the API revision', () => {
    expect(workflow).toContain('BILLING_CANARY_EMAILS: "${{ vars.BILLING_CANARY_EMAILS }}"');
  });
});

describe('production billing audit policy', () => {
  const auditWorkflowPath = resolve(
    WORKSPACE_ROOT,
    '.github/workflows/billing-production-audit.yml',
  );
  const auditWorkflow = existsSync(auditWorkflowPath)
    ? readFileSync(auditWorkflowPath, 'utf8')
    : '';

  it('uses production Workload Identity instead of a personal Google login', () => {
    expect(auditWorkflow).toContain('workflow_dispatch:');
    expect(auditWorkflow).toContain("cron: '17 * * * *'");
    expect(auditWorkflow).toContain('id-token: write');
    expect(auditWorkflow).toContain('google-github-actions/auth@v3');
    expect(auditWorkflow).toContain('workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}');
    expect(auditWorkflow).toContain('service_account: ${{ vars.GCP_SERVICE_ACCOUNT }}');
  });

  it('keeps the production audit read-only and Checkout disabled', () => {
    expect(auditWorkflow).toMatch(/BILLING_ENABLED:\s+['"]?false['"]?/);
    expect(auditWorkflow).toContain('pnpm exec tsx scripts/billing-launch-audit.ts');
    expect(auditWorkflow).not.toMatch(/gcloud\s+run\s+(deploy|services\s+update)/);
    expect(auditWorkflow).not.toMatch(/gcloud\s+secrets\s+versions\s+add/);
  });

  it('publishes sanitized audit and failed-action diagnostics with bounded retention', () => {
    expect(auditWorkflow).toContain('billing-production-audit');
    expect(auditWorkflow).toContain('billing-provider-errors.json');
    expect(auditWorkflow).toContain('billing-runtime-rollout.json');
    expect(auditWorkflow).toContain('mismatches: $mismatches');
    expect(auditWorkflow).toContain('test "$(jq length <<<"$mismatches_json")" = "0"');
    expect(auditWorkflow).toContain('retention-days: 7');
    expect(auditWorkflow).toContain('if-no-files-found: error');
  });

  it('proves the deployed kill switch, reconciliation mode, and scheduler without printing secrets', () => {
    expect(auditWorkflow).toContain('gcloud run services describe docket-api');
    expect(auditWorkflow).toContain('gcloud scheduler jobs describe docket-billing-reconciliation');
    expect(auditWorkflow).toContain(
      'EXPECTED_RECONCILIATION_MODE: ${{ vars.BILLING_RECONCILIATION_MODE }}',
    );
    expect(auditWorkflow).toContain('test "$deployed_checkout" = "false"');
    expect(auditWorkflow).toContain('test "$deployed_mode" = "$EXPECTED_RECONCILIATION_MODE"');
    expect(auditWorkflow).toContain('test "$scheduler_state" = "ENABLED"');
    expect(auditWorkflow).toContain(
      'test "$scheduler_uri" = "$service_url/internal/cron/billing-reconciliation"',
    );
    expect(auditWorkflow).not.toContain(
      'test "$scheduler_uri" = "$API_URL/internal/cron/billing-reconciliation"',
    );
    expect(auditWorkflow).not.toContain('spec.template.spec.containers[0].env.valueFrom');
  });
});
