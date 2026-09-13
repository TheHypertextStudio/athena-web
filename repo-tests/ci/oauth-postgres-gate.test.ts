import { describe, expect, it } from 'vitest';

import { loadWorkflows } from '../../scripts/ci-gate-policy';

describe('OAuth PostgreSQL CI gate', () => {
  it('runs the acceptance suite as a required core-screen smoke step', () => {
    const ci = loadWorkflows().find((workflow) => workflow.path === '.github/workflows/ci.yml');
    const smoke = ci?.jobs.find((job) => job.id === 'core-screen-smoke');
    const oauthStep = smoke?.steps.find((step) => step.run?.trim() === 'pnpm oauth:test:postgres');

    expect(oauthStep).toBeDefined();
    expect(oauthStep?.continueOnError).toBe(false);
    expect(oauthStep?.env['POSTGRES_CONTROL_URL']).toBe(
      'postgres://docket:docket@127.0.0.1:5432/postgres',
    );
  });
});
