import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../');
const rosterGridPath = join(root, 'apps/web/src/components/views/roster-grid.ts');
const rosterPaths = [
  join(root, 'apps/web/src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx'),
  join(root, 'apps/web/src/app/(app)/orgs/[orgId]/projects/projects-client.tsx'),
  join(root, 'apps/web/src/components/programs/program-list-ui.tsx'),
  join(root, 'apps/web/src/components/teams/team-list-ui.tsx'),
];

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Roster grid contract', () => {
  it('gives every metadata cell a 16px clipping gutter', () => {
    const contract = source(rosterGridPath);
    expect(contract).toContain(
      "'text-label-medium min-w-0 overflow-hidden px-4 whitespace-nowrap'",
    );
    expect(contract).toContain("'flex min-w-0 items-center overflow-hidden px-4'");

    for (const path of rosterPaths) {
      const roster = source(path);
      expect(roster).toContain("from '@/components/views/roster-grid'");
      expect(roster).toContain('ROSTER_HEADER_CELL_CLASS');
      expect(roster).toContain('ROSTER_DATA_CELL_CLASS');
    }
  });

  it('keeps strategic roster rows at 56px instead of the old 72px', () => {
    for (const path of rosterPaths) {
      const roster = source(path);
      expect(roster).toMatch(/(?:h-14|min-h-14)/);
      expect(roster).not.toContain('h-[72px]');
      expect(roster).not.toContain('min-h-[72px]');
    }
  });
});
