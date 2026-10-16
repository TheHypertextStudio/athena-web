import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertDefined } from '@docket/test-utils';

import { parseWorkflow, parseYaml, REPO_ROOT } from '../../scripts/ci-gate-policy';

/** Cache identity and endpoint configuration that every trusted cache job must use. */
interface CacheAction {
  runs?: {
    steps: {
      id?: string;
      if?: string;
      uses?: string;
      with?: Record<string, unknown>;
      run?: string;
    }[];
  };
}

/** Reads the composite without turning an absent implementation into a setup error. */
function cacheAction(): CacheAction {
  const path = join(REPO_ROOT, '.github/actions/turbo-cache/action.yml');
  return existsSync(path) ? (parseYaml(readFileSync(path, 'utf8')) as CacheAction) : {};
}

describe('signed Cloud Run Turbo cache authentication', () => {
  it('defaults local Turbo runs to the signed Studio cache endpoint and namespace', () => {
    const source = readFileSync(join(REPO_ROOT, 'turbo.json'), 'utf8');
    const remoteCache = JSON.parse(
      assertDefined(/"remoteCache"\s*:\s*(\{[^}]*\})/.exec(source)?.[1]),
    ) as unknown;

    expect(remoteCache).toEqual({
      apiUrl: 'https://docket-turbo-cache-mdchlo736a-uc.a.run.app',
      teamSlug: 'docket',
      signature: true,
    });
  });

  it.each(['ci', 'e2e'])('keeps %s local-only until a cache identity is minted', (name) => {
    const source = readFileSync(join(REPO_ROOT, `.github/workflows/${name}.yml`), 'utf8');
    const workflow = parseYaml(source) as { env: Record<string, string> };

    expect(workflow.env['TURBO_CACHE']).toBe('local:rw');
    expect(workflow.env).not.toHaveProperty('TURBO_TOKEN');
    expect(source).not.toContain('secrets.TURBO_TOKEN');
    const signingSecret = workflow.env['TURBO_REMOTE_CACHE_SIGNATURE_KEY'];
    expect(signingSecret).toContain("github.repository == 'TheHypertextStudio/athena-web'");
    expect(signingSecret).toContain("github.ref == 'refs/heads/main'");
    expect(signingSecret).toContain("github.event_name == 'push'");
    expect(signingSecret).toContain("github.event_name == 'workflow_dispatch'");
    expect(signingSecret).toContain(
      "github.workflow_ref == 'TheHypertextStudio/athena-web/.github/workflows/ci.yml@refs/heads/main'",
    );
    expect(signingSecret).toContain(
      "github.workflow_ref == 'TheHypertextStudio/athena-web/.github/workflows/e2e.yml@refs/heads/main'",
    );
    expect(signingSecret).toContain("&& secrets.TURBO_REMOTE_CACHE_SIGNATURE_KEY || ''");
  });

  it('mints an audience-bound ID token only for configured Studio main workflows', () => {
    const authentication = assertDefined(
      cacheAction().runs?.steps.find((step) => step.id === 'auth'),
    );

    expect(authentication.uses).toBe(
      'google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093',
    );
    expect(authentication.with).toMatchObject({
      workload_identity_provider: '${{ inputs.workload-identity-provider }}',
      service_account: '${{ inputs.service-account }}',
      token_format: 'id_token',
      id_token_audience: '${{ inputs.api }}',
      id_token_include_email: true,
      create_credentials_file: false,
    });
    expect(authentication.if).toContain("github.repository == 'TheHypertextStudio/athena-web'");
    expect(authentication.if).toContain("github.ref == 'refs/heads/main'");
    expect(authentication.if).toContain("github.event_name == 'push'");
    expect(authentication.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(authentication.if).toContain("inputs.api != ''");
    expect(authentication.if).toContain("inputs.team != ''");
    expect(authentication.if).toContain("inputs.workload-identity-provider != ''");
    expect(authentication.if).toContain("inputs.service-account != ''");
    expect(authentication.if).toContain("env.TURBO_REMOTE_CACHE_SIGNATURE_KEY != ''");
  });

  it('keeps repository variable resolution in callers, outside the composite manifest', () => {
    const source = readFileSync(join(REPO_ROOT, '.github/actions/turbo-cache/action.yml'), 'utf8');

    expect(source).not.toMatch(/\bvars\./);
  });

  it.each(['ci', 'e2e'])(
    'authenticates immediately before each cacheable %s Turbo invocation',
    (name) => {
      const source = readFileSync(join(REPO_ROOT, `.github/workflows/${name}.yml`), 'utf8');
      const workflow = parseWorkflow(`${name}.yml`, source);
      const document = parseYaml(source) as {
        jobs: Record<string, { permissions?: Record<string, string> }>;
      };
      let cacheSteps = 0;

      for (const job of workflow.jobs) {
        for (const [index, step] of job.steps.entries()) {
          if (!step.run?.includes('pnpm turbo run ') || step.run.includes('run db:migrate')) {
            continue;
          }
          cacheSteps++;
          expect(
            job.steps[index - 1]?.uses,
            `${job.id}: cache auth must precede ${step.label}`,
          ).toBe('./.github/actions/turbo-cache');
          expect(job.steps[index - 1]?.with).toEqual({
            'workload-identity-provider': '${{ vars.GCP_WIF_PROVIDER }}',
            'service-account': '${{ vars.GCP_TURBO_CACHE_SERVICE_ACCOUNT }}',
            api: '${{ vars.TURBO_API }}',
            team: '${{ vars.TURBO_TEAM }}',
          });
          expect(document.jobs[job.id]?.permissions?.['id-token']).toBe('write');
          expect(
            job.steps.slice(0, index - 1).some((prior) => prior.uses === './.github/actions/setup'),
          ).toBe(true);
        }
      }

      expect(cacheSteps).toBe(name === 'ci' ? 5 : 1);
    },
  );
});
