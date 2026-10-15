import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isAdvisoryWorkflow,
  parseWorkflow,
  parseYaml,
  REPO_ROOT,
} from '../../scripts/ci-gate-policy';

describe('native web artifact workflow', () => {
  it('keeps production build settings out of the test environment', () => {
    const source = readFileSync(join(REPO_ROOT, '.github/workflows/vercel-artifact.yml'), 'utf8');
    const config = parseYaml(source) as {
      jobs: {
        artifact: {
          env: Record<string, unknown>;
          steps: { name: string; env?: Record<string, unknown> }[];
        };
      };
    };
    const job = config.jobs.artifact;
    expect(Object.keys(job.env).sort()).toEqual([
      'NEXT_TELEMETRY_DISABLED',
      'VERCEL_GIT_COMMIT_REF',
      'VERCEL_GIT_COMMIT_SHA',
      'VERCEL_TELEMETRY_DISABLED',
    ]);
    const build = job.steps.find(
      (step) => step.name === 'Build native Linux Vercel output using existing package access',
    );
    const production = {
      VERCEL_ENV: 'production',
      STUDIO_DEPLOYMENT_ENV: 'production',
      NEXT_PUBLIC_APP_URL: 'https://clearthedocket.com',
      NEXT_PUBLIC_API_URL: 'https://api.clearthedocket.com',
      API_URL: 'https://api.clearthedocket.com',
      NEXT_PUBLIC_PASSKEY_RP_ID: 'clearthedocket.com',
      NEXT_PUBLIC_BRIEF_HOST: 'briefs.clearthedocket.com',
      BETTER_AUTH_PASSKEY_LEGACY_RP_ID: 'docket.hypertext.studio',
      DOCS_MINTLIFY_ORIGIN: 'https://docket.mintlify.dev',
    };
    expect(build?.env).toMatchObject(production);
    for (const key of Object.keys(production)) expect(job.env).not.toHaveProperty(key);
  });

  it('keeps web artifact preparation confined to the reviewed feature branch without a deploy job', () => {
    const file = '.github/workflows/vercel-artifact.yml';
    const source = readFileSync(join(REPO_ROOT, file), 'utf8');
    const artifact = parseWorkflow(file, source);
    expect(isAdvisoryWorkflow(artifact)).toBe(true);
    expect(parseYaml(source)).toMatchObject({
      on: { push: { branches: ['codex/studio-legal-policies-20261014'] } },
      jobs: {
        artifact: {
          if: "github.repository == 'TheHypertextStudio/athena-web' && github.ref == 'refs/heads/codex/studio-legal-policies-20261014'",
          permissions: { contents: 'read', packages: 'read' },
        },
      },
    });
    const commands = artifact.jobs
      .flatMap((job) => job.steps.map((step) => step.run ?? ''))
      .join('\n');
    expect(commands).toContain('vercel build --prod\n');
    expect(commands).not.toContain('--standalone');
    expect(commands).not.toMatch(/\bvercel\s+(deploy|promote|alias)\b|deploy-cloudrun|deploy\.yml/);
  });
});
