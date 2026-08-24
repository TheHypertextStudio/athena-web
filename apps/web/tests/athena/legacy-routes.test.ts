import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../..');

describe('retired workspace Athena routes', () => {
  it.each(['athena', 'agents'])(
    'does not retain the old workspace %s route or a compatibility redirect',
    (route) => {
      expect(
        existsSync(resolve(root, `apps/web/src/app/(app)/orgs/[orgId]/${route}/page.tsx`)),
      ).toBe(false);
    },
  );
});
