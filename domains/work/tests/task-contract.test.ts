import { describe, expect, it } from 'vitest';

import { Priority } from '../src/task-contract';

describe('Task contract', () => {
  it('parses the complete task-priority vocabulary and rejects unknown values', () => {
    for (const priority of ['none', 'urgent', 'high', 'medium', 'low'] as const) {
      expect(Priority.parse(priority)).toBe(priority);
    }

    expect(Priority.safeParse('critical').success).toBe(false);
  });
});
