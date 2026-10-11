import { resolve } from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

describe('shared frontend lint composition', () => {
  it.each([
    'src/lib/docs-site.ts',
    'src/app/(app)/layout.tsx',
    'tests/work-views/work-view-controller-hook.test.tsx',
  ])('preserves every effective product rule for %s', async (filename) => {
    const file = resolve(filename);
    const original = await new ESLint({
      cwd: resolve('../..'),
      overrideConfigFile: resolve('../../eslint.config.js'),
    }).calculateConfigForFile(file);
    const composed = await new ESLint().calculateConfigForFile(file);
    expect(original).toBeDefined();
    expect(composed).toBeDefined();
    for (const [rule, value] of Object.entries(original?.rules ?? {})) {
      expect(composed?.rules?.[rule], rule).toEqual(value);
    }
  });
});
