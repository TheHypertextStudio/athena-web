import { describe, expect, it } from 'vitest';

import { CONNECTOR_ITEMS, FIXED_NOW, fixedClock } from '../src/fixtures';

describe('fixtures', () => {
  it('fixedClock always returns FIXED_NOW', () => {
    expect(fixedClock()).toBe(FIXED_NOW);
    expect(fixedClock()).toBe(fixedClock());
  });

  it('CONNECTOR_ITEMS carries provenance for every provider', () => {
    const providers = ['github', 'linear', 'gmail', 'calendar', 'gtasks'] as const;
    for (const provider of providers) {
      const items = CONNECTOR_ITEMS[provider];
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]?.provenance.provider).toBe(provider);
      expect(items[0]?.provenance.importedAt).toBe(FIXED_NOW);
    }
  });
});
