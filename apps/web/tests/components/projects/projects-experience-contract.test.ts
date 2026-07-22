import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../../');
const overviewPath = join(root, 'apps/web/src/app/(app)/orgs/[orgId]/projects/projects-client.tsx');
const detailPath = join(root, 'apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/page.tsx');
const documentPath = join(root, 'apps/web/src/components/editor/entity-document.tsx');
const editorPath = join(root, 'apps/web/src/components/editor/freeform-text.tsx');
const pageLayoutPath = join(root, 'apps/web/src/components/views/page-layout.tsx');
const entityDetailLayoutPath = join(root, 'apps/web/src/components/views/entity-detail-layout.tsx');

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
    // The dependencies lens now renders the shared React Flow canvas (lazy-loaded) instead of the
    // old hand-rolled SVG DependencyLens.
    expect(overview).toContain('<ProjectGraphPanel');
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
    const layout = source(entityDetailLayoutPath);
    // Identity + arrangement come from the one shared shell; the page composes it and never
    // hand-rolls its own masthead or restates the canonical title token.
    expect(detail).toContain('<EntityDetailLayout');
    expect(detail).toContain('<EntityMetadataRow ariaLabel="Project properties">');
    expect(detail).toContain('<PropertiesPanel');
    expect(detail).toContain('<InitiativeIconPicker');
    expect(detail).toContain('aria-label="Project people"');
    // The canonical title token lives once in the shell as headline-medium; no detail page may
    // diverge to headline-large or restate the token.
    expect(layout).toContain('text-headline-medium');
    expect(detail).not.toContain('text-headline-large');
    // In the shell the property chips render in the metadata slot below the subtitle — never inline
    // with the <h1> — and the identity block precedes the metadata row.
    expect(layout.indexOf('</h1>')).toBeLessThan(layout.indexOf('{metadata}'));
    expect(layout.indexOf('{subtitle}')).toBeLessThan(layout.indexOf('{metadata}'));
    expect(detail).not.toContain('Project lead');
    expect(detail).not.toContain('Contributor');
    expect(detail).not.toContain('No people yet');
    expect(detail).not.toContain('Project info');
    expect(detail).not.toContain('Print');
  });

  it('operates properties as an inline metadata chip row, not an anchored disclosure', () => {
    const detail = source(detailPath);
    const layout = source(entityDetailLayoutPath);
    // Properties are the inline chip row in the masthead, not a popover the user must open first.
    expect(detail).not.toContain('propertiesOpen');
    expect(detail).not.toContain('<Popover open=');
    expect(detail).not.toContain('<PopoverContent');
    expect(detail).not.toContain('aria-label="Open project properties"');
    expect(detail).toContain('<EntityMetadataRow ariaLabel="Project properties">');
    // Every chip reads as the same calm pill, wired once through the shell's shared chip class.
    expect(layout).toContain('bg-surface-container-low hover:bg-surface-container-high');
    // The tab bar adopts the shared Tabs primitive (which owns the 40px touch-target floor and its
    // own track styling), so the shell doesn't also draw a Separator beneath it.
    expect(detail).toContain('<Tabs');
    expect(layout).not.toContain('<Separator');
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
    expect(detail).toContain("{ value: 'resources', label: 'Resources'");
    expect(detail).toContain('<ResourcesTab');
  });
});
