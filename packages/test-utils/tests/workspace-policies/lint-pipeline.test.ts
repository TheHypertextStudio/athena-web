import { describe, expect, it } from 'vitest';

import { createStagedLintPlan } from '../../../../scripts/lint-pipeline';

describe('createStagedLintPlan', () => {
  it('puts each reverse-dependency closure in its own bounded phase', () => {
    expect(
      createStagedLintPlan([
        '@docket/api',
        '@docket/db',
        '@docket/types',
        '@docket/ui',
        '@docket/web',
      ]),
    ).toEqual([
      [{ label: '@docket/api', filters: ['...@docket/api'] }],
      [{ label: '@docket/db', filters: ['...@docket/db'] }],
      [{ label: '@docket/types', filters: ['...@docket/types'] }],
      [{ label: '@docket/ui', filters: ['...@docket/ui'] }],
      [{ label: '@docket/web', filters: ['...@docket/web'] }],
    ]);
  });
});
