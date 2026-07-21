import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../../');
const overviewPath = join(root, 'apps/web/src/app/(app)/orgs/[orgId]/projects/projects-client.tsx');
const detailPath = join(root, 'apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/page.tsx');
const documentPath = join(root, 'apps/web/src/components/editor/entity-document.tsx');
const editorPath = join(root, 'apps/web/src/components/editor/freeform-text.tsx');
const pageLayoutPath = join(root, 'apps/web/src/components/views/page-layout.tsx');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Projects experience contract', () => {
  it('keeps list, dependencies, and timeline as equal lenses over shared view state', () => {
    const overview = source(overviewPath);
    // The list-page arrangement + canonical title token live once in the shared layout; the page
    // adopts ListPageLayout and supplies content, rather than restating the skeleton or the token.
    expect(source(pageLayoutPath)).toContain('text-headline-medium');
    expect(overview).toContain('<ListPageLayout');
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
    expect(detail).toContain('text-headline-large');
    expect(detail).toContain('aria-label="Project people"');
    expect(detail).toContain('Properties');
    expect(detail.indexOf('<PopoverContent')).toBeLessThan(detail.indexOf('<PropertiesPanel'));
    expect(detail.indexOf('<InitiativeIconPicker')).toBeLessThan(
      detail.indexOf('text-headline-large'),
    );
    expect(detail).not.toContain('Project lead');
    expect(detail).not.toContain('Contributor');
    expect(detail).not.toContain('No people yet');
    expect(detail).not.toContain('Project info');
    expect(detail).not.toContain('Print');
  });

  it('makes visible properties operate the anchored disclosure', () => {
    const detail = source(detailPath);
    expect(detail).toContain('const [propertiesOpen, setPropertiesOpen]');
    expect(detail).toContain('open={propertiesOpen}');
    expect(detail).not.toContain('aria-label="Open project properties"');
    expect(detail).toContain('Add health or target');
    expect(detail).toContain('aria-label="Edit project health"');
    expect(detail).toContain('aria-label="Edit project target date"');
    expect(detail.indexOf('<InitiativeIconPicker')).toBeLessThan(detail.indexOf('<Popover open='));
    expect(detail).toContain('bg-surface-container-low hover:bg-surface-container-high');
    expect(detail).toContain('hover:bg-surface-container-high');
    // The tab bar now adopts the shared Tabs primitive, which owns the 40px touch-target floor.
    expect(source(join(root, 'apps/web/src/components/project-detail/tabs.tsx'))).toContain(
      '<Tabs',
    );
    expect(source(join(root, 'packages/ui/src/primitives/tabs.tsx'))).toContain('min-h-10');
  });

  it('uses full-width heading-free documents and canonical MD3 prose hierarchy', () => {
    const document = source(documentPath);
    const editor = source(editorPath);
    // The contents rail sits in a right-hand column and the body is the first column, so the body
    // stays flush with the masthead instead of being indented by a left rail.
    expect(document).toContain('@4xl:grid-cols-[minmax(0,1fr)_11rem]');
    expect(document).not.toContain('grid-cols-[9rem');
    expect(document).toContain('ExpandMoreRounded');
    expect(document).toContain('bg-surface-container-low');
    expect(document).not.toContain('border-y');
    expect(editor).toContain('text-body-large');
    // In-document headings sit a tier below the page title (headline-large) so they never compete:
    // the body ramp tops out at title-large and steps down from there.
    expect(editor).toContain('[&_h1]:text-title-large');
    expect(editor).toContain('[&_h2]:text-title-medium');
    expect(editor).toContain('[&_h3]:text-title-small');
  });

  it('gives Resources a dedicated operating tab', () => {
    const detail = source(detailPath);
    expect(detail).toContain("{ id: 'resources', label: 'Resources'");
    expect(detail).toContain('<ProjectResourcesTab');
  });
});
