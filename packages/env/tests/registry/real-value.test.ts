import { describe, expect, it } from 'vitest';

import { isRealValue } from '../../src/index';

describe('isRealValue', () => {
  it('treats nullish, empty, and whitespace values as not real', () => {
    expect(isRealValue(undefined)).toBe(false);
    expect(isRealValue(null)).toBe(false);
    expect(isRealValue('')).toBe(false);
    expect(isRealValue('   ')).toBe(false);
  });

  it('treats each placeholder sentinel as not real', () => {
    expect(isRealValue('sk_live_secret...')).toBe(false);
    expect(isRealValue('PLACEHOLDER-key')).toBe(false);
    expect(isRealValue('changeme')).toBe(false);
    expect(isRealValue('change-me-now')).toBe(false);
    expect(isRealValue('your-api-key')).toBe(false);
    expect(isRealValue('mock')).toBe(false);
    expect(isRealValue('MOCK')).toBe(false);
  });

  it('treats a genuine credential as real', () => {
    expect(isRealValue('sk_live_realkey123')).toBe(true);
    expect(isRealValue('postgres://user:pass@host/db')).toBe(true);
  });
});
