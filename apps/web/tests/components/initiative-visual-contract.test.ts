import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../');
const overviewPath = join(
  root,
  'apps/web/src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx',
);
const detailPath = join(
  root,
  'apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/page.tsx',
);
const typographyPath = join(root, 'packages/ui/src/styles/globals.css');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function productionTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTsxFiles(path);
    return entry.isFile() && path.endsWith('.tsx') ? [path] : [];
  });
}

describe('Initiative visual contract', () => {
  it('uses the named 32–56px document title with status before the title', () => {
    const typography = source(typographyPath);
    const detail = source(detailPath);
    expect(typography).toContain('--text-document-title: clamp(2rem, 1.35rem + 2.4vw, 3.5rem);');
    expect(detail).toContain('text-document-title');
    expect(detail.indexOf('STATUS_LABEL[detail.status]')).toBeLessThan(
      detail.indexOf('text-document-title'),
    );
    expect(detail).not.toContain('clamp(2.25rem,5vw,4.5rem)');
  });

  it('keeps attention content and controls in one borderless tonal surface', () => {
    const overview = source(overviewPath);
    expect(overview).toContain('bg-surface-container-low');
    expect(overview).toContain('data-testid="initiative-attention-controls"');
    expect(overview).not.toContain('gap-3 border-y px-1 py-4');
  });

  it('reserves the full table for wide containers and retains compact metadata', () => {
    const overview = source(overviewPath);
    expect(overview).toContain('@5xl:table-header-group');
    expect(overview).toContain('@5xl:table-row-group');
    expect(overview).toContain('@5xl:table-cell');
    expect(overview).toContain('Owner ${item.ownerName ??');
    expect(overview).toContain('Target ${item.targetDate');
  });

  it('does not style semantic labels as uppercase overlines', () => {
    const appSource = join(root, 'apps/web/src');
    const allowed = new Set(['apps/web/src/components/teams/create-team.tsx']);
    const violations = productionTsxFiles(appSource)
      .filter((path) => !allowed.has(relative(root, path)))
      .flatMap((path) =>
        source(path)
          .split('\n')
          .map((line, index) => ({ line, lineNumber: index + 1, path: relative(root, path) }))
          .filter(({ line }) => /className=.*\buppercase\b/.test(line)),
      );
    expect(violations).toEqual([]);
  });
});
