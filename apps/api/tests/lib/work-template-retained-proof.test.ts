import { describe, expect, it } from 'vitest';
import type { TemplateTransaction } from '../../src/lib/templates/persistence';
import { requireRetainedOccurrenceAuthority } from '../../src/lib/work-creation/retained-authority';

describe('retained occurrence opaque proof boundary', () => {
  it('rejects an unregistered token before reading any database or private binding metadata', () => {
    const tx = {} as TemplateTransaction;
    expect(() =>
      requireRetainedOccurrenceAuthority(tx, { kind: 'retained-occurrence', proof: {} }),
    ).toThrow('Forbidden');
  });
});
