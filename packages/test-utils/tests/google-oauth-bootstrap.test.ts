import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

type ParseGoogleOAuthClientBundle = (
  raw: string,
  urls: { readonly apiBase: string; readonly webBases: readonly string[] },
) => Record<'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET', string>;

interface ProviderFixture {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly vars: readonly string[];
  readonly requiredVars?: readonly string[];
  readonly optionalVars?: readonly string[];
  readonly optionalCapabilities?: readonly (readonly string[])[];
}

// Keep this package's compile boundary intact while exercising the repository-level bootstrap.
const scriptModule: string = new URL('../../../scripts/integration-providers.ts', import.meta.url)
  .href;
const { parseGoogleOAuthClientBundle, PROVIDER_GROUPS } = (await import(scriptModule)) as {
  readonly parseGoogleOAuthClientBundle: ParseGoogleOAuthClientBundle;
  readonly PROVIDER_GROUPS: readonly (ProviderFixture & {
    readonly consoleUrl?: string;
    readonly instructions?: (...args: never[]) => readonly string[];
    readonly steps?: (...args: never[]) => readonly unknown[];
  })[];
};
const setupModule: string = new URL('../../../scripts/integrations-setup.ts', import.meta.url).href;
const {
  buildApiSecretBindings,
  classifyProviderStatus,
  optionalProviderVars,
  setupProviderVars,
  splitInstructionSteps,
} = (await import(setupModule)) as {
  readonly buildApiSecretBindings: (
    env: 'local' | 'staging' | 'production',
    configured: ReadonlySet<string>,
  ) => string[];
  readonly classifyProviderStatus: (
    group: ProviderFixture,
    configured: ReadonlySet<string>,
  ) => 'missing' | 'partial' | 'configured';
  readonly optionalProviderVars: (
    group: ProviderFixture,
    env: 'local' | 'staging' | 'production',
  ) => readonly string[];
  readonly setupProviderVars: (
    group: ProviderFixture,
    env: 'local' | 'staging' | 'production',
    includeOptional: boolean,
  ) => readonly string[];
  readonly splitInstructionSteps: (
    lines: readonly string[],
  ) => readonly { readonly note: readonly string[] }[];
};

const urls = {
  apiBase: 'https://docket-api.hypertext.studio',
  webBases: ['https://docket.hypertext.studio'],
} as const;

function googleClient(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    web: {
      client_id: 'client.apps.googleusercontent.com',
      client_secret: 'secret-value',
      javascript_origins: ['https://docket.hypertext.studio'],
      redirect_uris: ['https://docket.hypertext.studio/api/auth/callback/google'],
      ...overrides,
    },
  };
}

describe('Google OAuth bootstrap credential import', () => {
  it('extracts both credentials from a valid downloaded Web-client file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'docket-google-oauth-'));
    const path = join(directory, 'client.json');
    writeFileSync(path, JSON.stringify(googleClient()), { mode: 0o600 });

    expect(parseGoogleOAuthClientBundle(path, urls)).toEqual({
      GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'secret-value',
    });
  });

  it('rejects a client configured for a different browser origin', () => {
    const raw = JSON.stringify(
      googleClient({ javascript_origins: ['https://unrelated.example.com'] }),
    );

    expect(() => parseGoogleOAuthClientBundle(raw, urls)).toThrow(
      'missing authorized origin: https://docket.hypertext.studio',
    );
  });

  it('rejects a client missing the production callback', () => {
    const raw = JSON.stringify(googleClient({ redirect_uris: [] }));

    expect(() => parseGoogleOAuthClientBundle(raw, urls)).toThrow(
      'missing authorized redirect URI: https://docket.hypertext.studio/api/auth/callback/google',
    );
  });

  it('rejects installed-app credentials without exposing their contents', () => {
    const raw = JSON.stringify({
      installed: {
        client_id: 'private-client-id',
        client_secret: 'private-client-secret',
      },
    });

    expect(() => parseGoogleOAuthClientBundle(raw, urls)).toThrow(
      'must be an OAuth Web application client',
    );
    try {
      parseGoogleOAuthClientBundle(raw, urls);
    } catch (error) {
      expect(String(error)).not.toContain('private-client');
    }
  });
});

describe('guided integration bootstrap contracts', () => {
  it('splits numbered guides into one operator-sized checkpoint per action', () => {
    expect(
      splitInstructionSteps([
        'Set up the provider.',
        '',
        '1) Open its console.',
        '   Keep this tab open.',
        '2) Create the credential.',
      ]).map((step) => step.note),
    ).toEqual([
      ['Set up the provider.', ''],
      ['1) Open its console.', '   Keep this tab open.'],
      ['2) Create the credential.'],
    ]);
  });

  it('classifies missing, partial, configured, and any-capability provider states', () => {
    const oauth: ProviderFixture = {
      id: 'oauth',
      label: 'OAuth',
      title: 'OAuth setup',
      vars: ['CLIENT_ID', 'CLIENT_SECRET'],
    };
    expect(classifyProviderStatus(oauth, new Set())).toBe('missing');
    expect(classifyProviderStatus(oauth, new Set(['CLIENT_ID']))).toBe('partial');
    expect(classifyProviderStatus(oauth, new Set(['CLIENT_ID', 'CLIENT_SECRET']))).toBe(
      'configured',
    );
    const observability = PROVIDER_GROUPS.find((group) => group.id === 'observability');
    if (!observability)
      throw new Error('Observability provider is missing from the guided catalog');
    expect(observability.optionalVars).toEqual(observability.vars);
    expect(observability.optionalCapabilities).toEqual([
      ['SENTRY_DSN'],
      ['BLOB_READ_WRITE_TOKEN'],
      ['EXPORT_BUCKET_URL', 'EXPORT_BUCKET_TOKEN'],
    ]);
    expect(optionalProviderVars(observability, 'production')).toEqual(observability.vars);
    expect(setupProviderVars(observability, 'production', false)).toEqual([]);
    expect(setupProviderVars(observability, 'production', true)).toEqual(observability.vars);
    expect(classifyProviderStatus(observability, new Set())).toBe('missing');
    expect(classifyProviderStatus(observability, new Set(['SENTRY_DSN']))).toBe('configured');
    expect(classifyProviderStatus(observability, new Set(['BLOB_READ_WRITE_TOKEN']))).toBe(
      'configured',
    );
    expect(classifyProviderStatus(observability, new Set(['EXPORT_BUCKET_URL']))).toBe('partial');
    expect(classifyProviderStatus(observability, new Set(['EXPORT_BUCKET_TOKEN']))).toBe('partial');
    expect(
      classifyProviderStatus(observability, new Set(['EXPORT_BUCKET_URL', 'EXPORT_BUCKET_TOKEN'])),
    ).toBe('configured');
    expect(
      classifyProviderStatus(observability, new Set(['SENTRY_DSN', 'EXPORT_BUCKET_URL'])),
    ).toBe('partial');
    expect(
      classifyProviderStatus(
        observability,
        new Set(['BLOB_READ_WRITE_TOKEN', 'EXPORT_BUCKET_TOKEN']),
      ),
    ).toBe('partial');
  });

  it('builds deploy bindings from existing canonical and legacy secrets only', () => {
    const bindings = buildApiSecretBindings(
      'production',
      new Set([
        'docket-google-client-id',
        'docket-google-client-secret',
        'docket-github-client-id',
        'docket-github-client-secret',
      ]),
    );
    expect(bindings).toContain('DATABASE_URL=docket-database-url:latest');
    expect(bindings).toContain('GOOGLE_CLIENT_ID=docket-google-client-id:latest');
    expect(bindings).toContain('GITHUB_APP_CLIENT_ID=docket-github-client-id:latest');
    expect(bindings.some((binding) => binding.startsWith('SLACK_CLIENT_ID='))).toBe(false);
  });

  it('keeps every provider in the guided catalog and deploys through the generated manifest', () => {
    expect(PROVIDER_GROUPS.map((group) => group.id)).toEqual([
      'google',
      'github',
      'linear',
      'apple',
      'stripe',
      'anthropic',
      'email',
      'observability',
    ]);
    for (const group of PROVIDER_GROUPS) {
      expect(Boolean(group.instructions ?? group.steps), `${group.id} needs guided content`).toBe(
        true,
      );
    }
    const workflow = readFileSync(
      new URL('../../../.github/workflows/deploy.yml', import.meta.url),
      'utf8',
    );
    expect(workflow).toContain('secrets: ${{ vars.API_SECRET_BINDINGS }}');
    expect(workflow.match(/environment: production/g)).toHaveLength(2);
    expect(workflow).not.toContain('GITHUB_CLIENT_ID=docket-github-client-id');
  });
});
