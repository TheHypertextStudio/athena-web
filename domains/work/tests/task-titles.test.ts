import { describe, expect, it } from 'vitest';

import { TITLE_MAX, truncateTitle } from '../src/task-titles';

describe('truncateTitle', () => {
  it('trims a title and keeps it unchanged when it fits the shared limit', () => {
    expect(truncateTitle('  Draft the rollout brief  ')).toBe('Draft the rollout brief');
  });

  it('uses the email follow-up fallback for blank text', () => {
    expect(truncateTitle('   ')).toBe('Follow up on an email');
  });

  it('caps a title with a terminal ellipsis without exceeding the shared limit', () => {
    const title = truncateTitle('x'.repeat(TITLE_MAX + 1));

    expect(title).toHaveLength(TITLE_MAX);
    expect(title).toBe(`${'x'.repeat(TITLE_MAX - 1)}…`);
  });
});
