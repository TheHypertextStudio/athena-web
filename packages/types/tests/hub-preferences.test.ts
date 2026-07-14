import { describe, expect, it } from 'vitest';

import { HubLanding, HubPreferences } from '../src/hub-preferences';

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
      calendar: {
        pixelsPerHour: 88.5,
        minLaneWidth: 260.25,
        defaultCreateIntent: 'timebox',
        defaultLayerId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      },
      athena: {
        instructions: 'Protect two hours for focused work every morning.',
        approvalMode: 'routine_autonomy',
      },
    });
    expect(parsed.density).toBe('compact');
    expect(parsed.theme).toBe('dark');
    expect(parsed.calendar?.pixelsPerHour).toBe(88.5);
    expect(parsed.calendar?.defaultCreateIntent).toBe('timebox');
    expect(parsed.athena?.approvalMode).toBe('routine_autonomy');
  });

  it('keeps calendar preferences continuous and allows clearing the destination layer', () => {
    expect(
      HubPreferences.parse({
        calendar: { pixelsPerHour: 73.125, minLaneWidth: 241.75, defaultLayerId: null },
      }).calendar,
    ).toEqual({ pixelsPerHour: 73.125, minLaneWidth: 241.75, defaultLayerId: null });
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

  it('rejects invalid Athena approval modes and oversized instructions', () => {
    expect(HubPreferences.safeParse({ athena: { approvalMode: 'always_act' } }).success).toBe(
      false,
    );
    expect(HubPreferences.safeParse({ athena: { instructions: 'x'.repeat(4001) } }).success).toBe(
      false,
    );
  });

  it('rejects out-of-range calendar geometry and unknown create intents', () => {
    expect(HubPreferences.safeParse({ calendar: { pixelsPerHour: 12 } }).success).toBe(false);
    expect(HubPreferences.safeParse({ calendar: { minLaneWidth: 100 } }).success).toBe(false);
    expect(HubPreferences.safeParse({ calendar: { defaultCreateIntent: 'block' } }).success).toBe(
      false,
    );
  });
});
