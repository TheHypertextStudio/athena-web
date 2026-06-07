import { describe, expect, it } from 'vitest';

import { HubLanding, HubPreferences } from './hub-preferences';

describe('HubLanding', () => {
  it("accepts the literal 'hub'", () => {
    expect(HubLanding.parse('hub')).toBe('hub');
  });

  it("accepts the literal 'last'", () => {
    expect(HubLanding.parse('last')).toBe('last');
  });

  it('accepts an org-target object', () => {
    expect(HubLanding.parse({ orgId: 'org-1' })).toEqual({ orgId: 'org-1' });
  });

  it('rejects an unknown literal', () => {
    expect(HubLanding.safeParse('elsewhere').success).toBe(false);
  });

  it('rejects an org-target missing orgId', () => {
    expect(HubLanding.safeParse({}).success).toBe(false);
  });
});

describe('HubPreferences', () => {
  it('parses an empty object (all fields optional)', () => {
    expect(HubPreferences.parse({})).toEqual({});
  });

  it('parses a fully-populated preferences object', () => {
    const parsed = HubPreferences.parse({
      landing: 'last',
      density: 'compact',
      theme: 'dark',
      timezone: 'America/Chicago',
    });
    expect(parsed.density).toBe('compact');
    expect(parsed.theme).toBe('dark');
  });

  it('rejects an invalid density', () => {
    expect(HubPreferences.safeParse({ density: 'cozy' }).success).toBe(false);
  });

  it('rejects an invalid theme', () => {
    expect(HubPreferences.safeParse({ theme: 'sepia' }).success).toBe(false);
  });

  it('rejects an invalid landing', () => {
    expect(HubPreferences.safeParse({ landing: 'nope' }).success).toBe(false);
  });
});
