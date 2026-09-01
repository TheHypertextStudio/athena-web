import { describe, expect, it } from 'vitest';

import { checkEnvForTarget, VAR_REGISTRY } from '../../src/registry';
import { sampleEnvForTarget } from '../support/sample-env';

describe('checkEnvForTarget', () => {
  it('accepts an environment that satisfies every required var for the target', () => {
    expect(checkEnvForTarget('api', sampleEnvForTarget('api'))).toEqual([]);
  });

  it('reports a required var that is absent', () => {
    const env = sampleEnvForTarget('api');
    delete env['ADMIN_GOOGLE_SSO_ENABLED'];

    const issues = checkEnvForTarget('api', env);

    expect(issues.map((i) => i.name)).toContain('ADMIN_GOOGLE_SSO_ENABLED');
    expect(issues.find((i) => i.name === 'ADMIN_GOOGLE_SSO_ENABLED')?.reason).toBe(
      'missing (required)',
    );
  });

  it('treats an empty string as absent, which is what an unset CI variable writes', () => {
    // The exact production failure this query exists to catch: `vars.X` unset interpolates to ''.
    const issues = checkEnvForTarget('api', {
      ...sampleEnvForTarget('api'),
      ADMIN_GOOGLE_SSO_ENABLED: '',
    });

    expect(issues.map((i) => i.name)).toContain('ADMIN_GOOGLE_SSO_ENABLED');
  });

  it('parses with the real schema, so a present-but-malformed value still fails', () => {
    const issues = checkEnvForTarget('api', {
      ...sampleEnvForTarget('api'),
      ADMIN_GOOGLE_SSO_ENABLED: 'yes',
    });

    const issue = issues.find((i) => i.name === 'ADMIN_GOOGLE_SSO_ENABLED');
    expect(issue).toBeDefined();
    expect(issue?.reason).not.toBe('missing (required)');
  });

  it('carries the registry hint so a failure says how to fix itself', () => {
    const env = sampleEnvForTarget('api');
    delete env['ADMIN_GOOGLE_SSO_ENABLED'];

    expect(
      checkEnvForTarget('api', env).find((i) => i.name === 'ADMIN_GOOGLE_SSO_ENABLED')?.where,
    ).toBeTruthy();
  });

  it('ignores an absent optional var', () => {
    const optional = VAR_REGISTRY.find((v) => v.targets.includes('api') && !v.required);
    expect(optional).toBeDefined();

    const issues = checkEnvForTarget('api', sampleEnvForTarget('api'));

    expect(issues.map((i) => i.name)).not.toContain(optional?.name);
  });

  it('scopes to the target, so another surface’s requirement is not this one’s failure', () => {
    // A var required by the api but not declared for the admin console must not fail the console.
    const apiOnly = VAR_REGISTRY.find(
      (v) => v.required && v.targets.includes('api') && !v.targets.includes('admin'),
    );
    expect(apiOnly).toBeDefined();

    const issues = checkEnvForTarget('admin', {});

    expect(issues.map((i) => i.name)).not.toContain(apiOnly?.name);
  });

  it('stays quiet about undeclared vars unless asked, since a process env carries thousands', () => {
    const env = { ...sampleEnvForTarget('api'), HOME: '/root', SOME_UNRELATED_TOOL: '1' };

    expect(checkEnvForTarget('api', env)).toEqual([]);
  });

  it('reports undeclared vars when the environment is a closed set', () => {
    const env = { ...sampleEnvForTarget('api'), LEFTOVER_AFTER_A_RENAME: 'x' };

    const issues = checkEnvForTarget('api', env, { rejectUnknown: true });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.name).toBe('LEFTOVER_AFTER_A_RENAME');
    expect(issues[0]?.reason).toBe('unknown variable');
  });
});
