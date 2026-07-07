import { expect, it } from 'vitest';

import { getDb } from '../support/routes-harness';

it('harness module loads', () => {
  expect(typeof getDb).toBe('function');
});
