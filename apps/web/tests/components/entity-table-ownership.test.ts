import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../');
const applicationRoot = join(root, 'apps/web/src');

function applicationSources(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return applicationSources(path);
    return ['.ts', '.tsx'].includes(extname(path)) ? [path] : [];
  });
}

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('EntityTable ownership', () => {
  it('keeps application feature code from owning column headers', () => {
    const columnHeaderRole = /role\s*=\s*(?:["']columnheader["']|\{\s*["']columnheader["']\s*\})/;
    const owners = applicationSources(applicationRoot)
      .filter((path) => columnHeaderRole.test(source(path)))
      .map((path) => relative(root, path));

    expect(owners).toEqual([]);
  });

  it('routes each remaining roster adapter through EntityTable', () => {
    const rosterPaths = [
      'apps/web/src/components/teams/team-list-ui.tsx',
      'apps/web/src/components/cycles/cycle-row.tsx',
      'apps/web/src/components/work-views/work-list.tsx',
    ];

    for (const path of rosterPaths) {
      expect(source(join(root, path))).toMatch(
        /import\s*\{[^}]*\bEntityTable\b[^}]*\}\s*from '@docket\/ui\/components'/,
      );
    }
  });
});
