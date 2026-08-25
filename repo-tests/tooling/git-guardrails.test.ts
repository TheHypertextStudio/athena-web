import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const installer = resolve(import.meta.dirname, '../../scripts/install-git-guardrails.sh');
const lintStagedConfig = resolve(import.meta.dirname, '../../lint-staged.config.js');

describe('generated Git guardrails', () => {
  it('validates the commit message before running the quality gate', () => {
    const source = readFileSync(installer, 'utf8');
    const validator = source.indexOf('node scripts/validate-commit-message.mjs "$1"');
    const formatter = source.indexOf('pnpm lint-staged');
    const designPolicy = source.indexOf(
      'pnpm --filter @docket/test-utils exec vitest run tests/design-policies/design-token-policy.test.ts --maxWorkers=1',
    );
    const lint = source.indexOf(
      'NODE_OPTIONS=--max-old-space-size=3072 pnpm turbo run lint --concurrency=1',
    );

    expect(validator).toBeGreaterThan(-1);
    expect(formatter).toBeGreaterThan(validator);
    expect(designPolicy).toBeGreaterThan(formatter);
    expect(lint).toBeGreaterThan(designPolicy);
  });

  it('does not run a duplicate staged ESLint pass', () => {
    const source = readFileSync(lintStagedConfig, 'utf8');

    expect(source).not.toContain('eslint');
  });
});
