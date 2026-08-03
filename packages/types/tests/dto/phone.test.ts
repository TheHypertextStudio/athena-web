/**
 * Unit tests for the phone-number composition and masking helpers.
 *
 * @remarks
 * `composeE164`/`maskE164` are the two pure functions standing between what a person types and
 * the credential Docket dials — every branch here is a real "what did the person actually type"
 * case, not a synthetic one.
 */
import { describe, expect, it } from 'vitest';

import { composeE164, maskE164 } from '../../src/phone';

describe('composeE164', () => {
  it('composes a dial code and a nationally-formatted number into E.164', () => {
    expect(composeE164('44', '(0)20 7946 0958')).toBe('+442079460958');
    expect(composeE164('1', '415 555 0171')).toBe('+14155550171');
  });

  it('rejects a dial code that is not on the allowlist', () => {
    expect(composeE164('999', '4155550171')).toBeNull();
  });

  it('rejects a dial code that has no digits at all', () => {
    expect(composeE164('abc', '4155550171')).toBeNull();
  });

  it('rejects a national number that has no digits once separators are stripped', () => {
    expect(composeE164('1', '()  -')).toBeNull();
    // A lone leading trunk zero strips to nothing.
    expect(composeE164('44', '0')).toBeNull();
  });

  it('rejects a composed candidate that is not a plausible E.164 length', () => {
    // '+1' + a single national digit is far short of E.164's 7-digit minimum.
    expect(composeE164('1', '1')).toBeNull();
  });
});

describe('maskE164', () => {
  it('masks a number, keeping the recorded dial code and the last two digits', () => {
    expect(maskE164('+14155550171', '1')).toBe('+1 ••• ••• ••71');
  });

  it('falls back to the leading digit when no dial code was recorded', () => {
    expect(maskE164('+14155550171')).toBe('+1 ••• ••• ••71');
  });

  it('falls back to the leading digit when the recorded dial code does not match the number', () => {
    // A number stored under a stale/incorrect dial code should not surface a dial code it was
    // never actually entered under.
    expect(maskE164('+14155550171', '44')).toBe('+1 ••• ••• ••71');
  });

  it('returns a fully redacted placeholder for a value that is not a plausible E.164 number', () => {
    expect(maskE164('not-a-number')).toBe('•••');
    expect(maskE164('14155550171')).toBe('•••');
  });
});
