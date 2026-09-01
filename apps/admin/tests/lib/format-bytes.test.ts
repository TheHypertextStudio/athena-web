import { describe, expect, it } from 'vitest';

import { formatBytes } from '@/lib/format-bytes';

describe('formatBytes', () => {
  it('reads whole bytes without a decimal', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(999)).toBe('999 B');
  });

  it('steps up a unit at each decimal thousand, matching how providers bill', () => {
    expect(formatBytes(1000)).toBe('1.0 KB');
    expect(formatBytes(1_000_000)).toBe('1.0 MB');
    expect(formatBytes(1_000_000_000)).toBe('1.0 GB');
    expect(formatBytes(1_000_000_000_000)).toBe('1.0 TB');
  });

  it('keeps one decimal place above kilobytes', () => {
    expect(formatBytes(4096)).toBe('4.1 KB');
    expect(formatBytes(2_300_000_000)).toBe('2.3 GB');
  });

  it('stops at the largest unit rather than inventing one', () => {
    expect(formatBytes(10 ** 18)).toBe('1000.0 PB');
  });

  it('reads a missing or impossible size as zero rather than NaN', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B');
  });
});
