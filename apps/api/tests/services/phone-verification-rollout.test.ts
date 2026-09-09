import { describe, expect, it } from 'vitest';

import { phoneVerificationEnabled } from '../../src/services/phone-verification-rollout';

describe('phone verification rollout', () => {
  it('admits every verified account after public launch', () => {
    expect(
      phoneVerificationEnabled(true, undefined, {
        email: 'person@example.com',
        emailVerified: true,
      }),
    ).toBe(true);
  });

  it('admits only a verified account on the normalized canary list before launch', () => {
    expect(
      phoneVerificationEnabled(false, ' Owner@Example.com ', {
        email: 'owner@example.com',
        emailVerified: true,
      }),
    ).toBe(true);
    expect(
      phoneVerificationEnabled(false, 'owner@example.com', {
        email: 'owner@example.com',
        emailVerified: false,
      }),
    ).toBe(false);
    expect(
      phoneVerificationEnabled(false, 'owner@example.com', {
        email: 'other@example.com',
        emailVerified: true,
      }),
    ).toBe(false);
  });
});
