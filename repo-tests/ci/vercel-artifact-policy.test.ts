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
