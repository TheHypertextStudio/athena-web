import { describe, expect, it } from 'vitest';

import * as api from './api';
import * as types from './index';

describe('package barrels', () => {
  it('re-exports the public surface from the root index', () => {
    expect(typeof types.satisfies).toBe('function');
    expect(types.Capability.parse('view')).toBe('view');
    expect(types.OrgCreate.parse({ name: 'A' }).name).toBe('A');
  });

  it('the api subpath is the documented (empty) contract pointer', () => {
    expect(Object.keys(api)).toHaveLength(0);
  });
});
