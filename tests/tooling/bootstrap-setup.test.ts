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
  requiredProviderVars,
  setupProviderVars,
  splitInstructionSteps,
  wrapLines,
} from '../../scripts/integrations-setup';

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
      'apple',
      'slack',
      'stripe',
      'anthropic',
      'email',
      'observability',
    ]);
    expect(PROVIDER_GROUPS.every((group) => group.vars.length > 0)).toBe(true);
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
    expect(identityCopy.join('\n')).toContain('Setup URL field may turn gray');
    expect(identityCopy.join('\n')).not.toContain('Expire user authorization tokens');
    expect(connectorCopy.join('\n')).toContain('Permissions & events');
    expect(connectorCopy.join('\n')).toContain('Repository permissions');
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
});
