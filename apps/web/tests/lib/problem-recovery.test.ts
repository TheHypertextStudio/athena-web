import { PROBLEM_CATALOG } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { PUBLIC_PROBLEM_RECOVERY } from '../../src/lib/problem-recovery';

describe('PUBLIC_PROBLEM_RECOVERY', () => {
  it('offers a non-empty, same-origin action for every catalog recovery mode', () => {
    for (const problem of Object.values(PROBLEM_CATALOG)) {
      const action = PUBLIC_PROBLEM_RECOVERY[problem.recovery];
      expect(action.href.startsWith('/')).toBe(true);
      expect(action.href.startsWith('//')).toBe(false);
      expect(action.label).not.toBe('');
      expect(action.instruction).not.toBe('');
    }
  });

  it('gives reauthentication and scope reconnection distinct, actionable guidance', () => {
    expect(PUBLIC_PROBLEM_RECOVERY.reauthenticate).toMatchObject({
      href: '/sign-in',
      label: 'Sign in again',
    });
    expect(PUBLIC_PROBLEM_RECOVERY.reauthenticate.instruction).toContain('verify your identity');

    expect(PUBLIC_PROBLEM_RECOVERY.reconnect).toMatchObject({
      href: '/sign-in',
      label: 'Sign in to reconnect',
    });
    expect(PUBLIC_PROBLEM_RECOVERY.reconnect.instruction).toContain('additional access');
  });
});
