import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../../');
const overviewPath = join(root, 'apps/web/src/app/(app)/orgs/[orgId]/projects/projects-client.tsx');
const workPagePath = join(root, 'apps/web/src/components/work-views/work-view-page.tsx');
const workListPath = join(root, 'apps/web/src/components/work-views/work-list.tsx');
const timelinePath = join(root, 'apps/web/src/components/work-views/project-timeline-adapter.tsx');
const dependencyPath = join(root, 'apps/web/src/components/work-views/project-dependency-lens.tsx');
const detailPath = join(
  root,
  'apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/project-detail-client.tsx',
);
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
    const workPage = source(workPagePath);
    // The list-page arrangement + canonical title token live once in the shared layout; the page
    // adopts ListPageLayout and supplies content, rather than restating the skeleton or the token.
    expect(source(pageLayoutPath)).toContain('text-headline-medium');
    expect(overview).toContain('<WorkViewPage');
    expect(workPage).toContain('<ListPageLayout');
    expect(workPage).toContain('<WorkViewToolbar');
    expect(workPage).toContain('role="tablist"');
    expect(workPage).toContain('controller.toggleFavoriteView(view.id)');
    // The dependencies lens now renders the shared React Flow canvas (lazy-loaded) instead of the
    // old hand-rolled SVG DependencyLens.
    expect(source(dependencyPath)).toContain('<ProjectGraphPanel');
    // The timeline lens renders the shared, entity-generic timeline engine rather than a
    // Projects-only implementation, so its axis, zoom, markers, and drag behavior are the same
    // code the Hub portfolio runs.
    expect(source(timelinePath)).toContain('<TimelineCanvas');
    expect(source(timelinePath)).toContain('buildProjectViewTimelineCatalog');
    expect(workPage).not.toContain('TimelineLens');
  });

  it('renders grouping in both lenses instead of flattening it away', () => {
    const workPage = source(workPagePath);
    const workList = source(workListPath);
    expect(workPage).toContain('groups={controller.response?.groups ?? []}');
    expect(workPage).toContain('groupPages={controller.groupPages}');
    expect(workList).toContain('subGroupBy=');
  });

  it('preserves dense, stable rows and full columns inside a local scroller', () => {
    const workList = source(workListPath);
    expect(workList).toContain('<ListView');
    expect(workList).toContain('bg-surface-container-low @container/table');
    expect(workList).toContain('rowHeight={56}');
    expect(workList).toContain('truncate');
  });

  it('keeps planning semantics in Project controls, lists, and timeline descriptions', () => {
    const detail = source(detailPath);
    const timeline = source(timelinePath);

    expect(detail).toContain('startDateResolution={project.startDateResolution}');
    expect(detail).toContain('targetDateResolution={project.targetDateResolution}');
    expect(timeline).toContain('row.startDate');
    expect(timeline).toContain('row.targetDate');
    expect(timeline).toContain('milestones');
  });

  it('uses target-derived properties instead of page-owned display columns', () => {
    const workPage = source(workPagePath);
    const workList = source(workListPath);
    expect(workPage).toContain("properties: ['status', 'priority', 'health', 'lead'");
    expect(workList).toContain('workViewDisplayFieldCatalog(target)');
  });

  it('keeps Project identity and work ahead of progressive metadata', () => {
    const detail = source(detailPath);
    const layout = source(entityDetailLayoutPath);
    // Identity + arrangement come from the one shared shell; the page composes it and never
    // hand-rolls its own masthead or restates the canonical title token.
    expect(detail).toContain('<EntityDetailLayout');
    expect(detail).toContain('<EntityMetadataRow ariaLabel="Project properties">');
    expect(detail).toContain('<PropertiesPanel');
    expect(detail).toContain('<ProjectPeopleRow');
    expect(detail).toContain('<EntityIconPicker');
    expect(detail.indexOf('<ProjectPeopleRow')).toBeLessThan(
      detail.indexOf('<EntityMetadataRow ariaLabel="Project properties">'),
    );
    expect(detail).toContain('ownerId={project.leadId ?? null}');
    expect(detail).toContain('patchProject({ leadId })');
    expect(detail).not.toContain('aria-label="Project people"');
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

  it('keeps Repeat project inside the Project actions menu', () => {
    const detail = source(detailPath);
    const repeatMutation = detail.indexOf('setRepeatProjectOpen(true)');
    const containingMenuItem = detail.lastIndexOf('<DropdownMenuItem', repeatMutation);
    const containingButton = detail.lastIndexOf('<Button', repeatMutation);

    expect(repeatMutation).toBeGreaterThan(-1);
    expect(containingMenuItem).toBeGreaterThan(containingButton);
    expect(detail.slice(containingMenuItem, repeatMutation + 200)).toContain(
      'Repeat {projectNoun.toLowerCase()}',
    );
  });

  it('moves a Project to recoverable trash and offers receipt replay', () => {
    const detail = source(detailPath);

    expect(detail).toContain("['object-commands'].$post");
    expect(detail).toContain("operation: { type: 'trash' }");
    expect(detail).toContain("direction: 'undo'");
    expect(detail).toContain('Move to trash');
    expect(detail).toContain('Undo');
    expect(detail).not.toContain("projects[':id'].$delete");
    expect(detail).not.toContain('permanently removes');
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
    expect(document).toContain('@4xl:grid-cols-[minmax(0,calc(75ch+2rem))_11rem]');
    expect(document).toContain('grid min-w-0 flex-1 gap-4');
    expect(document).toContain('max-w-[calc(75ch+2rem)]');
    expect(document).toContain('max-w-[75ch]');
    expect(document).not.toContain('max-w-none');
    expect(document).not.toContain('grid-cols-[9rem');
    expect(document).toContain('ExpandMoreRounded');
    expect(document).toContain('bg-surface-container-low');
    expect(document).not.toContain('border-y');
    expect(editor).toContain('text-body-medium');
    // In-document headings sit a tier below the page title (headline-large) so they never compete:
    // the body ramp tops out at title-large and steps down from there, with h2/h3 stepped up a
    // notch from body-adjacent sizes so the H2→H3 relationship reads as a clearer hierarchy.
    expect(editor).toContain('[&_h1]:text-title-large');
    expect(editor).toContain('[&_h2]:text-title-large');
    expect(editor).toContain('[&_h3]:text-title-medium');
  });

  it('gives Resources a dedicated operating tab', () => {
    const detail = source(detailPath);
    // Matched across whatever line breaks formatting chooses: the contract is that the tab exists,
    // not that its object literal fits on one line.
    expect(detail).toMatch(/value: 'resources',\s*\n?\s*label: 'Resources'/);
    expect(detail).toContain('<ResourcesTab');
  });

  it('keeps the Resources tab count-free while the panel still receives derived references', () => {
    const detail = source(detailPath);
    expect(detail).not.toMatch(/value: 'resources'[^}]*badge:/);
    expect(detail).toContain('mentionedExternal={entityMentions.external}');
    expect(detail).toContain('mentionedEntities={entityMentions.entities}');
  });
});
