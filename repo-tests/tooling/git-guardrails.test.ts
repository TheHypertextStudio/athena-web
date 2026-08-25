import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const installer = resolve(import.meta.dirname, '../../scripts/install-git-guardrails.sh');
const lintStagedConfig = resolve(import.meta.dirname, '../../lint-staged.config.js');

describe('generated Git guardrails', () => {
  it('keeps code checks in pre-commit and message checks in commit-msg', () => {
    const source = readFileSync(installer, 'utf8');
    const preCommit = source.match(/cat > "\$hooks_dir\/pre-commit" <<'HOOK'([\s\S]*?)\nHOOK/);
    const commitMessage = source.match(/cat > "\$hooks_dir\/commit-msg" <<'HOOK'([\s\S]*?)\nHOOK/);

    expect(preCommit?.[1]).toContain('pnpm lint-staged');
    expect(preCommit?.[1]).toContain('tests/design-policies/design-token-policy.test.ts');
    expect(preCommit?.[1]).toContain('pnpm turbo run lint --concurrency=1');
    expect(preCommit?.[1]).not.toContain('validate-commit-message');

    expect(commitMessage?.[1]).toContain('node scripts/validate-commit-message.mjs "$1"');
    expect(commitMessage?.[1]).not.toContain('pnpm');
  });

  it('does not run a duplicate staged ESLint pass', () => {
    const source = readFileSync(lintStagedConfig, 'utf8');

    expect(source).not.toContain('eslint');
  });
});
