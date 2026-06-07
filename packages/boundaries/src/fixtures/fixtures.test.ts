import { describe, expect, it } from 'vitest';

import {
  BILLING_LIFECYCLE,
  CONNECTOR_ITEMS,
  FIXED_NOW,
  fixedClock,
  SCRIPTED_SESSION,
} from './index';

describe('fixtures', () => {
  it('fixedClock always returns FIXED_NOW', () => {
    expect(fixedClock()).toBe(FIXED_NOW);
    expect(fixedClock()).toBe(fixedClock());
  });

  it('SCRIPTED_SESSION proposes a gated action for the approval gate', () => {
    expect(SCRIPTED_SESSION.map((a) => a.type)).toEqual([
      'thought',
      'action',
      'elicitation',
      'response',
    ]);
    expect(SCRIPTED_SESSION.find((a) => a.type === 'action')?.approval).toBe('proposed');
  });

  it('CONNECTOR_ITEMS carries provenance for every provider', () => {
    const providers = ['github', 'linear', 'drive', 'gmail', 'calendar'] as const;
    for (const provider of providers) {
      const items = CONNECTOR_ITEMS[provider];
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]?.provenance.provider).toBe(provider);
      expect(items[0]?.provenance.importedAt).toBe(FIXED_NOW);
    }
  });

  it('BILLING_LIFECYCLE walks trialing -> active -> past_due -> canceled', () => {
    expect(BILLING_LIFECYCLE.map((s) => s.status)).toEqual([
      'trialing',
      'active',
      'past_due',
      'canceled',
    ]);
  });
});
