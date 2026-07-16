import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../..');

describe('legacy Athena routes', () => {
  it.each(['athena', 'agents'])(
    'redirects the old workspace %s route into personal Athena',
    (route) => {
      const source = readFileSync(
        resolve(root, `apps/web/src/app/(app)/orgs/[orgId]/${route}/page.tsx`),
        'utf8',
      );
      expect(source).toContain('redirect(`/athena?workspace=${orgId}`)');
    },
  );
});
