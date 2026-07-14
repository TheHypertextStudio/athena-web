import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../../');
const overviewPath = join(root, 'apps/web/src/app/(app)/orgs/[orgId]/projects/projects-client.tsx');
const detailPath = join(root, 'apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/page.tsx');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Projects experience contract', () => {
  it('keeps list, dependencies, and timeline as equal lenses over shared view state', () => {
    const overview = source(overviewPath);
    expect(overview).toContain("type Lens = 'list' | 'dependencies' | 'timeline'");
    expect(overview).toContain('<FilterToolbar');
    expect(overview).toContain('<DependencyLens');
    expect(overview).toContain('<TimelineLens');
  });

  it('preserves dense, stable rows and full columns inside a local scroller', () => {
    const overview = source(overviewPath);
    expect(overview).toContain('overflow-x-auto overscroll-x-contain');
    expect(overview).toContain('min-w-[61rem]');
    expect(overview).toContain('min-h-[72px]');
    expect(overview).toContain('line-clamp-2 max-w-[52ch]');
    expect(overview).toContain('{item.summary ? (');
  });

  it('uses decoupled customizable display icons with 40px targets', () => {
    const overview = source(overviewPath);
    expect(overview).toContain('<InitiativeIconPicker');
    expect(overview).toContain("subjectType: 'project'");
  });

  it('keeps Project identity and work ahead of progressive metadata', () => {
    const detail = source(detailPath);
    expect(detail).toContain('text-document-title');
    expect(detail).toContain('aria-label="Project people"');
    expect(detail).toContain('Project info');
    expect(detail.indexOf('<PopoverContent')).toBeLessThan(detail.indexOf('<PropertiesPanel'));
    expect(detail).not.toContain('Project lead');
    expect(detail).not.toContain('Contributor');
    expect(detail).not.toContain('Print');
  });

  it('gives Resources a dedicated operating tab', () => {
    const detail = source(detailPath);
    expect(detail).toContain("{ id: 'resources', label: 'Resources'");
    expect(detail).toContain('<ProjectResourcesTab');
  });
});
