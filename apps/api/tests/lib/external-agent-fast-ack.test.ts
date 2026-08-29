import { describe, expect, it, vi } from 'vitest';

import { runWithExternalAgentFastAckTimeout } from '../../src/lib/external-agent-fast-ack';

describe('external agent fast acknowledgement timeout', () => {
  it('returns at the deadline when the post-persistence operation remains pending', async () => {
    vi.useFakeTimers();
    try {
      const pending = new Promise<string>(() => undefined);
      const result = runWithExternalAgentFastAckTimeout(() => pending, 2_000);

      await vi.advanceTimersByTimeAsync(1_999);
      expect(vi.isFakeTimers()).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
