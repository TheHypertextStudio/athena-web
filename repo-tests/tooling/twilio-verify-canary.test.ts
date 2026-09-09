import { describe, expect, it } from 'vitest';

import {
  maskCanaryDestination,
  parseCanaryCode,
  parseCanaryDestination,
} from '../../scripts/twilio-verify-canary';

describe('Twilio Verify canary input', () => {
  it('accepts only a US E.164 destination', () => {
    expect(parseCanaryDestination(' +14155550123 ')).toBe('+14155550123');
    expect(() => parseCanaryDestination(undefined)).toThrow(/E\.164/);
    expect(() => parseCanaryDestination('4155550123')).toThrow(/E\.164/);
    expect(() => parseCanaryDestination('+442071838750')).toThrow(/US number/);
  });

  it('accepts only a six-digit verification code', () => {
    expect(parseCanaryCode(' 123456 ')).toBe('123456');
    expect(() => parseCanaryCode(undefined)).toThrow(/6-digit/);
    expect(() => parseCanaryCode('12345')).toThrow(/6-digit/);
  });

  it('leaves only the country code and final two digits visible', () => {
    const masked = maskCanaryDestination('+14155550123');

    expect(masked).toBe('+1••••••••23');
    expect(masked).not.toContain('41555501');
  });
});
