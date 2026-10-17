import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertDefined } from '@docket/test-utils';

import { parseWorkflow, parseYaml, REPO_ROOT } from '../../scripts/ci-gate-policy';

const sharedCacheAction =
  'TheHypertextStudio/release-engineering/actions/turbo-cache@a6dfdc28ff1dfbb4de567d813bfbee4208145367';

describe('signed Workers/R2 Turbo cache authentication', () => {
  it('defaults local Turbo runs to the signed Studio cache endpoint and namespace', () => {
    const source = readFileSync(join(REPO_ROOT, 'turbo.json'), 'utf8');
    const remoteCache = JSON.parse(
      assertDefined(/"remoteCache"\s*:\s*(\{[^}]*\})/.exec(source)?.[1]),
    ) as unknown;

    expect(remoteCache).toEqual({
      apiUrl: 'https://turbo-cache.hypertext.studio',
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

  it('uses the shared pinned action instead of a repository copy', () => {
    expect(existsSync(join(REPO_ROOT, '.github/actions/turbo-cache/action.yml'))).toBe(false);
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
          ).toBe(sharedCacheAction);
          expect(job.steps[index - 1]?.with).toEqual({
            'workload-identity-provider': '${{ vars.GCP_TURBO_CACHE_WIF_PROVIDER }}',
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
