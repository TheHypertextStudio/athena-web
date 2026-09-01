/**
 * The deploy-manifest gate, proven against the failure it exists to prevent.
 *
 * @remarks
 * The manifest fixture here is the shape `deploy.yml` writes. The first test reproduces the
 * production incident — a repository variable that was never set, interpolating to an empty
 * string — and asserts the gate is red for it, before the later tests assert it is green for a
 * complete manifest. A guard nobody has watched fail is a guard nobody should rely on.
 */
import { describe, expect, it } from 'vitest';

import { VAR_REGISTRY } from '../../packages/env/src/registry';
import { sampleEnvForTarget } from '../../packages/env/tests/support/sample-env';
import { parseEnvManifest, verifyEnvManifest } from '../../scripts/verify-env-manifest';

/** The env names `deploy.yml` mounts from Secret Manager rather than writing into the manifest. */
const SECRET_BINDINGS = [
  'DATABASE_URL=docket-database-url:latest',
  'DATABASE_URL_UNPOOLED=docket-database-url-unpooled:latest',
  'BETTER_AUTH_SECRET=docket-auth-secret:latest',
  'CRON_SECRET=docket-cron-secret:latest',
].join('\n');

/** A manifest carrying every required api var that is not secret-mounted. */
function completeManifest(): Record<string, string> {
  const secretNames = SECRET_BINDINGS.split('\n').map((binding) => binding.split('=')[0] ?? '');
  // PORT is required but injected by Cloud Run, so the manifest never declares it either.
  return sampleEnvForTarget('api', [...secretNames, 'PORT']);
}

describe('the deploy-manifest gate', () => {
  it('fails on the unset repository variable that broke production', () => {
    // `vars.ADMIN_GOOGLE_SSO_ENABLED` did not exist on an already-bootstrapped project, so the
    // heredoc wrote an empty string, the container refused to boot, and Cloud Run reported only a
    // failed rollout. This is that manifest.
    const issues = verifyEnvManifest(
      { ...completeManifest(), ADMIN_GOOGLE_SSO_ENABLED: '' },
      SECRET_BINDINGS,
    );

    const issue = issues.find((i) => i.name === 'ADMIN_GOOGLE_SSO_ENABLED');
    expect(issue).toBeDefined();
    expect(issue?.reason).toBe('missing (required)');
    expect(issue?.where).toBeTruthy();
  });

  it('passes a complete manifest, so the gate is not simply always red', () => {
    expect(verifyEnvManifest(completeManifest(), SECRET_BINDINGS)).toEqual([]);
  });

  it('counts secret-mounted variables as present without reading their values', () => {
    // Dropping the bindings must make exactly the secret-backed vars fail — proving the mount is
    // what satisfies them, not a blanket exemption for anything absent.
    const issues = verifyEnvManifest(completeManifest(), '');

    // Only the REQUIRED secret-backed vars: an optional one (DATABASE_URL_UNPOOLED) is legitimately
    // absent either way, so listing it here would assert a failure the contract does not claim.
    const requiredSecretNames = SECRET_BINDINGS.split('\n')
      .map((binding) => binding.split('=')[0] ?? '')
      .filter((name) =>
        VAR_REGISTRY.some((v) => v.name === name && v.required && v.targets.includes('api')),
      );
    expect(issues.map((i) => i.name).sort()).toEqual([...requiredSecretNames].sort());
    expect(issues.every((i) => i.reason === 'missing (required)')).toBe(true);
  });

  it('does not demand a variable Cloud Run injects on the container', () => {
    // PORT is required by the API and deliberately absent from the manifest: the platform sets it,
    // and pinning it would fight Cloud Run for the listen port. Without this the gate would fail
    // every single deploy — verified against the manifest the workflow actually writes.
    const manifest = completeManifest();
    delete manifest['PORT'];

    expect(verifyEnvManifest(manifest, SECRET_BINDINGS)).toEqual([]);
  });

  it('rejects a value the schema refuses, not only an absent one', () => {
    const issues = verifyEnvManifest(
      { ...completeManifest(), ADMIN_GOOGLE_SSO_ENABLED: 'yes' },
      SECRET_BINDINGS,
    );

    expect(issues.map((i) => i.name)).toContain('ADMIN_GOOGLE_SSO_ENABLED');
  });

  it('reports a variable left behind after a rename', () => {
    const issues = verifyEnvManifest(
      { ...completeManifest(), RETIRED_FLAG: 'true' },
      SECRET_BINDINGS,
    );

    expect(issues.map((i) => i.name)).toContain('RETIRED_FLAG');
  });
});

describe('parseEnvManifest', () => {
  it('reads the quoted and bare forms the heredoc emits, and skips comments', () => {
    expect(
      parseEnvManifest(
        ['# a comment', 'NODE_ENV: production', 'API_URL: "https://api.example.com"', ''].join(
          '\n',
        ),
      ),
    ).toEqual({ NODE_ENV: 'production', API_URL: 'https://api.example.com' });
  });

  it('keeps an empty value as empty rather than dropping the key', () => {
    // The distinction the incident turned on: the key was written, its value was ''.
    expect(parseEnvManifest('ADMIN_GOOGLE_SSO_ENABLED: ""')).toEqual({
      ADMIN_GOOGLE_SSO_ENABLED: '',
    });
  });

  it('preserves a colon inside a value', () => {
    expect(parseEnvManifest('BINDING: "name:latest"')).toEqual({ BINDING: 'name:latest' });
  });
});
