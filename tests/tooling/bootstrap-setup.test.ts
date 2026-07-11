import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseBootstrapFlags } from '../../scripts/bootstrap';
import {
  linearOAuthAppManifestUrl,
  PROVIDER_GROUPS,
  providerVars,
} from '../../scripts/integration-providers';
import { buildApiSecretBindings, wrapLines } from '../../scripts/integrations-setup';

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
});

describe('bootstrap note wrapping', () => {
  it('hard-wraps long unbroken provider URLs without overflowing the requested width', () => {
    const lines = wrapLines([`URL: https://linear.app/${'x'.repeat(120)}`], 40);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.length <= 40)).toBe(true);
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
      'BETTER_AUTH_ALLOWED_HOSTS=docket.hypertext.studio\\,docket-api.hypertext.studio\\,docket-admin.hypertext.studio',
    );
  });
});
