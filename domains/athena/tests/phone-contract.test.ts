/** Athena's caller-identity phone contract belongs with the voice feature. */
import { describe, expect, it } from 'vitest';

import { composeE164, maskE164 } from '../src/phone';

describe('Athena phone contract', () => {
  it('composes a dial code and a nationally-formatted number into E.164', () => {
    expect(composeE164('44', '(0)20 7946 0958')).toBe('+442079460958');
    expect(composeE164('1', '415 555 0171')).toBe('+14155550171');
  });

  it('rejects an unknown dial code or a number without any national digits', () => {
    expect(composeE164('999', '4155550171')).toBeNull();
    expect(composeE164('abc', '4155550171')).toBeNull();
    expect(composeE164('1', '()  -')).toBeNull();
    expect(composeE164('44', '0')).toBeNull();
  });

  it('rejects an E.164 candidate that is too short to be a callable number', () => {
    expect(composeE164('1', '1')).toBeNull();
  });

  it('redacts all but the country code and final two digits', () => {
    expect(maskE164('+14155550171', '1')).toBe('+1 ••• ••• ••71');
    expect(maskE164('+14155550171')).toBe('+1 ••• ••• ••71');
    expect(maskE164('+14155550171', '44')).toBe('+1 ••• ••• ••71');
    expect(maskE164('not-a-number')).toBe('•••');
    expect(maskE164('14155550171')).toBe('•••');
  });
});
