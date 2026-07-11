import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

type ParseGoogleOAuthClientBundle = (
  raw: string,
  urls: { readonly apiBase: string; readonly webBases: readonly string[] },
) => Record<'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET', string>;

// Keep this package's compile boundary intact while exercising the repository-level bootstrap.
const scriptModule: string = new URL('../../../scripts/integration-providers.ts', import.meta.url)
  .href;
const { parseGoogleOAuthClientBundle } = (await import(scriptModule)) as {
  readonly parseGoogleOAuthClientBundle: ParseGoogleOAuthClientBundle;
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
