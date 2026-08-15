import { describe, expect, it } from 'vitest';

import { CAPABILITY_RANK, Capability, satisfies } from '@docket/identity-access/capabilities';

describe('capability vocabulary', () => {
  it('parses the five ordered capability values', () => {
    const capabilities = ['view', 'comment', 'contribute', 'assign', 'manage'] as const;

    expect(Capability.options).toEqual(capabilities);
    expect(capabilities.map((capability) => Capability.parse(capability))).toEqual(capabilities);
    expect(Capability.safeParse('delete').success).toBe(false);
    expect(capabilities.map((capability) => CAPABILITY_RANK[capability])).toEqual([0, 1, 2, 3, 4]);
  });

  it('lets each higher capability satisfy every lower requirement', () => {
    expect(satisfies('view', 'view')).toBe(true);
    expect(satisfies('manage', 'view')).toBe(true);
    expect(satisfies('assign', 'contribute')).toBe(true);
    expect(satisfies('comment', 'assign')).toBe(false);
    expect(satisfies('view', 'manage')).toBe(false);
  });
});
