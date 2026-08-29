import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseBootstrapFlags } from '../../scripts/bootstrap';
import {
  linearOAuthAppManifestUrl,
  PROVIDER_GROUPS,
  providerVars,
} from '../../scripts/integration-providers';
import {
  buildApiSecretBindings,
  classifyCredentialValue,
  normalizeCloudSecret,
  parseIntegrationArgs,
  policyProviderVars,
  redactIntegrationError,
  requiredProviderVars,
  runtimeSecretAccessorBindingArgs,
  shouldRunProviderProvisioner,
  setupProviderVars,
  splitInstructionSteps,
  wrapLines,
} from '../../scripts/integrations-setup';
import { findVar } from '../../packages/env/src/registry';

describe('bootstrap phase flags', () => {
  it('accepts pnpm separator syntax and forces the production-only fast path', () => {
    expect(
      parseBootstrapFlags(['--', '--skip-local', '--production', '--skip-infrastructure']),
    ).toMatchObject({
      production: true,
      skipLocal: true,
      skipProduction: false,
      skipInfrastructure: true,
      skipProviders: false,
    });
  });

  it('rejects unknown, contradictory, and skip-everything combinations', () => {
    expect(() => parseBootstrapFlags(['--prodution'])).toThrow(/Unknown bootstrap flag/);
    expect(() => parseBootstrapFlags(['--production', '--skip-production'])).toThrow(
      /cannot be used together/,
    );
    expect(() => parseBootstrapFlags(['--skip-local', '--skip-production'])).toThrow(
      /skip every bootstrap phase/,
    );
    expect(() => parseBootstrapFlags(['--skip-production', '--skip-infrastructure'])).toThrow(
      /has no effect/,
    );
  });

  it('seeds every required local feature control with its safe default', () => {
    const bootstrap = readFileSync(
      resolve(import.meta.dirname, '../../scripts/bootstrap.ts'),
      'utf8',
    );
    expect(bootstrap).toContain('WORK_LOCATION_PROJECTION_ENABLED=false');
    expect(bootstrap).toContain('BILLING_CANARY_EMAILS=');
    expect(bootstrap).toContain('BILLING_RECONCILIATION_MODE=off');
  });
});

describe('Linear production manifest', () => {
  it('prefills public distribution, every callback host, and Docket webhook resources', () => {
    const url = new URL(
      linearOAuthAppManifestUrl('production', {
        apiBase: 'https://docket-api.hypertext.studio',
        webBases: ['https://docket.hypertext.studio', 'https://docket-admin.hypertext.studio'],
      }),
    );

    expect(url.origin + url.pathname).toBe('https://linear.app/settings/api/applications/new');
    expect(url.searchParams.get('distribution')).toBe('public');
    expect(url.searchParams.getAll('oauth.redirect_uris')).toEqual([
      'https://docket.hypertext.studio/api/auth/callback/linear',
      'https://docket-admin.hypertext.studio/api/auth/callback/linear',
      'https://docket-api.hypertext.studio/api/auth/callback/linear',
    ]);
    expect(url.searchParams.get('webhook.url')).toBe(
      'https://docket-api.hypertext.studio/internal/ingest/linear',
    );
    expect(url.searchParams.getAll('webhook.resourceTypes')).toEqual(['Issue', 'Comment']);
    expect(url.toString()).not.toContain('oauth2%2Fcallback');
  });
});

describe('mandatory production provider catalog', () => {
  it('keeps every provider group identifiable and backed by at least one configured value', () => {
    expect(PROVIDER_GROUPS.map((group) => group.id)).toEqual([
      'google',
      'github',
      'linear',
      'linear-agent',
      'notion',
      'apple',
      'stripe',
      'anthropic',
      'email',
      'observability',
    ]);
    expect(PROVIDER_GROUPS.every((group) => group.vars.length > 0)).toBe(true);
  });

  it('registers every provider credential so the wizard can prompt for it', () => {
    for (const group of PROVIDER_GROUPS) {
      for (const varName of group.vars) {
        expect(findVar(varName), `${group.label}: ${varName}`).toBeDefined();
      }
    }
  });
  it('uses Mailpit variables locally and the native Resend API contract in production', () => {
    const email = PROVIDER_GROUPS.find((group) => group.id === 'email');
    expect(email).toBeDefined();
    if (!email) throw new Error('email provider group missing');

    expect(providerVars(email, 'local')).toEqual([
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASS',
      'MAIL_FROM',
    ]);
    expect(providerVars(email, 'production')).toEqual(['RESEND_API_KEY', 'MAIL_FROM']);
  });

  it('separates primary, Docket policy, and optional connector fields', () => {
    const google = PROVIDER_GROUPS.find((group) => group.id === 'google');
    const github = PROVIDER_GROUPS.find((group) => group.id === 'github');
    if (!google || !github) throw new Error('provider catalog is incomplete');

    expect(requiredProviderVars(google, 'production')).toEqual([
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
    ]);
    expect(policyProviderVars(google, 'production')).toEqual([
      'GOOGLE_OAUTH_PUBLIC',
      'GOOGLE_OAUTH_TEST_EMAILS',
    ]);
    expect(setupProviderVars(google, 'production', false)).toEqual([
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_OAUTH_PUBLIC',
      'GOOGLE_OAUTH_TEST_EMAILS',
    ]);
    expect(requiredProviderVars(github, 'production')).toEqual([
      'GITHUB_APP_CLIENT_ID',
      'GITHUB_APP_CLIENT_SECRET',
    ]);
    expect(setupProviderVars(github, 'production', false)).not.toContain('GITHUB_APP_PRIVATE_KEY');
    expect(setupProviderVars(github, 'production', true)).toContain('GITHUB_APP_PRIVATE_KEY');
  });

  it('recognizes placeholder values without exposing or printing them', () => {
    expect(classifyCredentialValue('')).toBe('missing');
    expect(classifyCredentialValue('your-client-id...')).toBe('placeholder');
    expect(classifyCredentialValue('real-value')).toBe('ready');
  });

  it('provisions Stripe resources instead of prompting for generated bindings', () => {
    const stripe = PROVIDER_GROUPS.find((group) => group.id === 'stripe');
    if (!stripe?.instructions) throw new Error('Stripe provider flow is incomplete');

    expect(stripe.provisioner).toBe('docket-stripe');
    expect(setupProviderVars(stripe, 'production', false)).toEqual([
      'STRIPE_SECRET_KEY',
      'STRIPE_PUBLISHABLE_KEY',
    ]);
    expect(stripe.managedVars).toEqual([
      'STRIPE_WEBHOOK_SECRET',
      'DOCKET_PRICE_LOOKUP_DOCKET_PRO',
      'STRIPE_PRICE_DOCKET_PRO',
      'STRIPE_BILLING_PORTAL_CONFIG_ID',
      'BILLING_ENABLED',
      'BILLING_RECONCILIATION_MODE',
    ]);
    expect(stripe.autoFetch).toBeUndefined();
    const guide = stripe
      .instructions('production', {
        apiBase: 'https://docket-api.hypertext.studio',
        webBases: ['https://docket.hypertext.studio'],
      })
      .join('\n');
    expect(guide).toContain('/internal/billing/webhook');
    expect(guide).toContain('Docket Pro');
    expect(guide).toContain('test mode before live mode');
    expect(guide).not.toContain('/api/auth/stripe/webhook');
    expect(guide).not.toContain('created separately');
  });

  it('reconciles managed Stripe resources when configured credentials are kept', () => {
    const stripe = PROVIDER_GROUPS.find((group) => group.id === 'stripe');
    const google = PROVIDER_GROUPS.find((group) => group.id === 'google');
    if (!stripe || !google) throw new Error('provider catalog is incomplete');

    expect(shouldRunProviderProvisioner(stripe, 'keep')).toBe(true);
    expect(shouldRunProviderProvisioner(stripe, 'configure')).toBe(true);
    expect(shouldRunProviderProvisioner(stripe, 'replace')).toBe(true);
    expect(shouldRunProviderProvisioner(stripe, 'skip')).toBe(false);
    expect(shouldRunProviderProvisioner(google, 'keep')).toBe(false);
  });

  it('redacts Stripe credential shapes from provider errors', () => {
    expect(
      redactIntegrationError(new Error('Invalid rk_live_********1234 and webhook whsec_signing')),
    ).toBe('Invalid [Stripe key redacted] and webhook [Stripe webhook secret redacted]');
  });

  it('keeps GitHub identity setup separate from optional Permissions & events setup', () => {
    const github = PROVIDER_GROUPS.find((group) => group.id === 'github');
    if (!github?.steps || !github.optionalSteps)
      throw new Error('GitHub provider flow is incomplete');
    const identityCopy = github
      .steps('production', {
        apiBase: 'https://docket-api.hypertext.studio',
        webBases: ['https://docket.hypertext.studio'],
      })
      .flatMap((step) => step.note);
    const connectorCopy = github
      .optionalSteps('production', {
        apiBase: 'https://docket-api.hypertext.studio',
        webBases: ['https://docket.hypertext.studio'],
      })
      .flatMap((step) => step.note);
    expect(identityCopy.join('\n')).toContain('Redirect on update');
    expect(identityCopy.join('\n')).toContain('clear "Request user authorization (OAuth) during');
    expect(identityCopy.join('\n')).toContain('/internal/integrations/github/callback');
    expect(identityCopy.join('\n')).toContain('Any account');
    expect(identityCopy.join('\n')).not.toContain('Setup URL field may turn gray');
    expect(identityCopy.join('\n')).not.toContain('Expire user authorization tokens');
    expect(connectorCopy.join('\n')).toContain('Permissions & events');
    expect(connectorCopy.join('\n')).toContain('Repository permissions');
  });

  it('makes the Linear OAuth form choices explicit', () => {
    const linear = PROVIDER_GROUPS.find((group) => group.id === 'linear');
    if (!linear?.instructions) throw new Error('Linear provider guide is missing');
    const guide = linear
      .instructions('staging', {
        apiBase: 'https://docket-api.hypertext.studio',
        webBases: ['https://docket.hypertext.studio'],
      })
      .join('\n');

    expect(guide).toContain('Authorization Code grant');
    expect(guide).toContain('Client credentials OFF');
    expect(guide).toContain('select only read');
    expect(guide).toContain('Select only Issues and Comments');
    expect(guide).toContain('Public OFF for this non-production app');
    expect(guide).not.toContain('Copy the Client ID, Client secret, and webhook signing secret');
  });

  it('accepts focused standalone environment and provider flags', () => {
    expect(parseIntegrationArgs(['--env', 'staging,production', '--provider=github'])).toEqual({
      environments: ['staging', 'production'],
      providers: ['github'],
      help: false,
    });
    expect(() => parseIntegrationArgs(['--provider', 'not-a-provider'])).toThrow(
      /Unknown integration provider/,
    );
  });

  it('uses progressive steps for every provider guide instead of a static checklist dump', () => {
    const staticGuides = PROVIDER_GROUPS.filter((group) => group.instructions);
    expect(staticGuides).not.toHaveLength(0);

    for (const group of staticGuides) {
      const steps = splitInstructionSteps(
        group.instructions?.('production', {
          apiBase: 'https://docket-api.hypertext.studio',
          webBases: ['https://docket.hypertext.studio'],
          projectId: 'athena-services',
        }) ?? [],
      );
      expect(steps.length, `${group.label} needs multiple operator steps`).toBeGreaterThan(1);
      expect(steps.every((step) => step.note.length > 0)).toBe(true);
    }

    const setupSource = readFileSync(
      resolve(import.meta.dirname, '../../scripts/integrations-setup.ts'),
      'utf8',
    );
    expect(setupSource).toContain('splitInstructionSteps(group.instructions(env, urls))');
    expect(setupSource).not.toContain('runInstructionChecklist');
    expect(setupSource).toContain('if (current.var && shouldCollect && !generated)');
  });
});

describe('bootstrap note wrapping', () => {
  it('hard-wraps long unbroken provider URLs without overflowing the requested width', () => {
    const lines = wrapLines([`URL: https://linear.app/${'x'.repeat(120)}`], 40);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.length <= 40)).toBe(true);
  });
});

describe('cloud secret normalization', () => {
  it('removes invisible clipboard whitespace without changing internal value content', () => {
    expect(normalizeCloudSecret('  client.apps.googleusercontent.com\r\n')).toBe(
      'client.apps.googleusercontent.com',
    );
    expect(normalizeCloudSecret('  Docket <no-reply@example.com>  ')).toBe(
      'Docket <no-reply@example.com>',
    );
  });

  it('rejects a value that becomes empty after normalization', () => {
    expect(() => normalizeCloudSecret(' \r\n ')).toThrow(/must not be empty/);
  });
});

describe('bootstrap runtime Secret Manager access', () => {
  const bootstrap = readFileSync(
    resolve(import.meta.dirname, '../../scripts/bootstrap.ts'),
    'utf8',
  );

  it('binds the default Cloud Run runtime identity to every base secret', () => {
    expect(
      runtimeSecretAccessorBindingArgs('123456789', 'docket-auth-secret', 'docket-prod'),
    ).toEqual([
      'secrets',
      'add-iam-policy-binding',
      'docket-auth-secret',
      '--project=docket-prod',
      '--member=serviceAccount:123456789-compute@developer.gserviceaccount.com',
      '--role=roles/secretmanager.secretAccessor',
      '--quiet',
    ]);
    expect(bootstrap).toContain('ensureRuntimeSecretAccess(cfg.project, name)');
  });
});

describe('production account-creation deployment contract', () => {
  const workflow = readFileSync(
    resolve(import.meta.dirname, '../../.github/workflows/deploy.yml'),
    'utf8',
  );

  it('generates the complete native Resend API contract without exposing a value in argv', () => {
    const configured = new Set(['docket-resend-api-key', 'docket-mail-from']);
    const bindings = buildApiSecretBindings('production', configured);
    for (const mount of [
      'RESEND_API_KEY=docket-resend-api-key:latest',
      'MAIL_FROM=docket-mail-from:latest',
    ]) {
      expect(bindings).toContain(mount);
    }
    expect(workflow).not.toContain('SMTP_PASS=');
    expect(workflow).toContain('secrets: ${{ vars.API_SECRET_BINDINGS }}');
    expect(workflow).toContain('--env DATABASE_URL_UNPOOLED');
    expect(workflow).not.toContain('--env DATABASE_URL_UNPOOLED=');
  });

  it('migrates before deployment and verifies health plus the signup route afterward', () => {
    const migration = workflow.indexOf('- name: Apply production database migrations');
    const deployment = workflow.indexOf('- id: deploy-api');
    const verification = workflow.indexOf('- name: Verify production health and auth routes');

    expect(migration).toBeGreaterThan(-1);
    expect(deployment).toBeGreaterThan(migration);
    expect(verification).toBeGreaterThan(deployment);
    expect(workflow).toContain('$API_URL/v1/health');
    expect(workflow).toContain('$API_URL/api/auth/sign-up/request-code');
    expect(workflow).toContain(
      'BETTER_AUTH_ALLOWED_HOSTS: "${{ vars.BETTER_AUTH_ALLOWED_HOSTS }}"',
    );
    expect(workflow).toContain(
      'BETTER_AUTH_TRUSTED_ORIGINS: "${{ vars.WEB_URL }},${{ vars.ADMIN_URL }}"',
    );
    expect(workflow).toContain('--env-vars-file=${{ runner.temp }}/docket-api-env.yaml');
    expect(workflow).not.toContain('BETTER_AUTH_TRUSTED_ORIGINS=');
    expect(workflow).toContain('env_vars_update_strategy: overwrite');
    expect(workflow).toContain('secrets_update_strategy: overwrite');
  });

  it('boots the API with outbound work-location projection disabled', () => {
    expect(workflow).toContain('WORK_LOCATION_PROJECTION_ENABLED: "false"');
  });

  it('keeps the Linear Agent runtime disabled until its protected release gate is enabled', () => {
    expect(workflow).toContain(
      'LINEAR_AGENT_ENABLED: "${{ vars.LINEAR_AGENT_ENABLED || \'false\' }}"',
    );
    expect(workflow).toContain(
      "--min-instances=${{ vars.LINEAR_AGENT_ENABLED == 'true' && '1' || '0' }}",
    );
  });

  it('deploys bootstrap-managed billing without an MCP vendor allowlist', () => {
    expect(workflow).toContain('BILLING_CANARY_EMAILS: "${{ vars.BILLING_CANARY_EMAILS }}"');
    expect(workflow).toContain('BILLING_ENABLED: "${{ vars.BILLING_ENABLED }}"');
    expect(workflow).toContain(
      'BILLING_RECONCILIATION_MODE: "${{ vars.BILLING_RECONCILIATION_MODE }}"',
    );
    expect(workflow).toContain(
      'STRIPE_HYPERTEXT_STUDIO_ACCOUNT_ID: "${{ vars.STRIPE_HYPERTEXT_STUDIO_ACCOUNT_ID }}"',
    );
    expect(workflow).not.toContain('BILLING_ENABLED: "false"');
    expect(workflow).not.toContain('MCP_ALLOWED_ORIGINS');
    expect(workflow).not.toContain('https://claude.ai');
    expect(workflow).not.toContain('https://claude.com');
  });
});
