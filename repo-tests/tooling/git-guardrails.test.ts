import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const installer = resolve(import.meta.dirname, '../../scripts/install-git-guardrails.sh');
const lintStagedConfig = resolve(import.meta.dirname, '../../lint-staged.config.js');

describe('generated Git guardrails', () => {
  it('runs repository-wide lint after formatting staged files', () => {
    const source = readFileSync(installer, 'utf8');
    expect(source).toContain('pnpm lint-staged');
    expect(source).toContain(
      'NODE_OPTIONS=--max-old-space-size=3072 pnpm turbo run lint --concurrency=1',
    );
  });

  it('does not run a duplicate staged ESLint pass', () => {
    const source = readFileSync(lintStagedConfig, 'utf8');

    expect(source).not.toContain('eslint');
  });
});
