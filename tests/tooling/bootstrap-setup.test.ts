import { describe, expect, it } from 'vitest';

import { parseBootstrapFlags } from '../../scripts/bootstrap';
import { linearOAuthAppManifestUrl, PROVIDER_GROUPS } from '../../scripts/integration-providers';
import {
  ensureLinearWebhookSecretMount,
  isConfiguredProviderValue,
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

  it('does not mistake bootstrap placeholders for configured cloud credentials', () => {
    expect(isConfiguredProviderValue('')).toBe(false);
    expect(isConfiguredProviderValue('placeholder')).toBe(false);
    expect(isConfiguredProviderValue('your-client-secret')).toBe(false);
    expect(isConfiguredProviderValue('real-provider-value')).toBe(true);
  });
});

describe('Linear deploy secret mount', () => {
  const workflow = `jobs:
  deploy-api:
    steps:
      - id: deploy-api
        with:
          secrets: |
            LINEAR_CLIENT_ID=docket-linear-client-id:latest
            LINEAR_CLIENT_SECRET=docket-linear-client-secret:latest
            APPLE_CLIENT_ID=docket-apple-client-id:latest
`;

  it('adds the webhook mount beside the Linear OAuth secrets exactly once', () => {
    const once = ensureLinearWebhookSecretMount(workflow);
    expect(once).toContain(
      'LINEAR_CLIENT_SECRET=docket-linear-client-secret:latest\n' +
        '            LINEAR_WEBHOOK_SECRET=docket-linear-webhook-secret:latest',
    );
    expect(ensureLinearWebhookSecretMount(once)).toBe(once);
  });

  it('fails closed when the expected deploy-api anchor is absent', () => {
    expect(() => ensureLinearWebhookSecretMount('jobs: {}\n')).toThrow(/deploy-api Linear secret/);
  });
});

describe('bootstrap note wrapping', () => {
  it('hard-wraps long unbroken provider URLs without overflowing the requested width', () => {
    const lines = wrapLines([`URL: https://linear.app/${'x'.repeat(120)}`], 40);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.length <= 40)).toBe(true);
  });
});
