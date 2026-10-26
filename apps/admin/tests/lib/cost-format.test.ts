import { describe, expect, it } from 'vitest';

import {
  formatCost,
  formatCostFloor,
  formatQuantity,
  holderName,
  parseRate,
} from '../../src/lib/cost-format';

describe('cost formatting', () => {
  it('writes millionths of a dollar as dollars, keeping small costs visible', () => {
    expect(formatCost(1_500_000)).toBe('$1.50');
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(2_500)).toBe('$0.0025');
  });

  it('marks a cost that is missing prices as a minimum', () => {
    expect(formatCostFloor(1_000_000, true)).toBe('$1.00+');
    expect(formatCostFloor(1_000_000, false)).toBe('$1.00');
  });

  it('writes storage as bytes and tokens as counts', () => {
    expect(formatQuantity('object_bytes', 4_100)).toBe('4.1 KB');
    expect(formatQuantity('ai_input_tokens', 1_234_567)).toBe((1_234_567).toLocaleString());
  });
});

describe('parseRate', () => {
  it('converts dollars per million units to the stored price', () => {
    expect(parseRate('3')).toBe(3_000_000);
    expect(parseRate('0.075')).toBe(75_000);
  });

  it('rejects text that is not a price', () => {
    expect(parseRate('')).toBeNull();
    expect(parseRate('abc')).toBeNull();
    expect(parseRate('-1')).toBeNull();
  });
});

describe('holderName', () => {
  it('prefers a name, then an email, then a label for the kind', () => {
    expect(holderName({ kind: 'user', name: 'Ada', email: 'ada@example.com' })).toBe('Ada');
    expect(holderName({ kind: 'user', name: null, email: 'ada@example.com' })).toBe(
      'ada@example.com',
    );
    expect(holderName({ kind: 'workspace', name: null, email: null })).toBe('Workspace');
    expect(holderName({ kind: 'unattributed', name: 'ignored', email: null })).toBe('Unattributed');
  });
});
