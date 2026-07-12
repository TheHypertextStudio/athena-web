import { describe, expect, it } from 'vitest';

import { signInReturnPath } from '../../src/components/app-shell-utils';

describe('signInReturnPath', () => {
  it('returns a protected export link to the exact same-origin path after sign-in', () => {
    expect(signInReturnPath('/exports/01JEXPORT')).toBe('/sign-in?next=%2Fexports%2F01JEXPORT');
  });

  it('preserves a protected route query without exposing it as an outer URL parameter', () => {
    expect(signInReturnPath('/tasks', 'view=assigned&filter=urgent')).toBe(
      '/sign-in?next=%2Ftasks%3Fview%3Dassigned%26filter%3Durgent',
    );
  });
});
