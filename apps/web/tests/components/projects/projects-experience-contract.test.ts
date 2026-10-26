import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../../');
const overviewPath = join(root, 'apps/web/src/app/(app)/orgs/[orgId]/projects/projects-client.tsx');
const workPagePath = join(root, 'apps/web/src/components/work-views/work-view-page.tsx');
// The tab row moved into its own component; the contract is about the row existing, not about
// which file draws it.
const workTabsPath = join(root, 'apps/web/src/components/work-views/work-view-tabs.tsx');
const workListPath = join(root, 'apps/web/src/components/work-views/work-list.tsx');
const workListColumnsPath = join(root, 'apps/web/src/components/work-views/work-list-columns.tsx');
const timelinePath = join(root, 'apps/web/src/components/work-views/project-timeline-adapter.tsx');
const dependencyRoutePath = join(root, 'apps/web/src/components/canvas/project-graph-route.tsx');
const dependencyClientPath = join(
  root,
  'apps/web/src/app/(app)/orgs/[orgId]/projects/dependencies/dependencies-client.tsx',
);
const detailPath = join(
  root,
  'apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/project-detail-client.tsx',
);
const documentPath = join(root, 'apps/web/src/components/editor/entity-document.tsx');
const documentContentsPath = join(root, 'apps/web/src/components/editor/document-contents.tsx');
const editorPath = join(root, 'apps/web/src/components/editor/freeform-text.tsx');
const pageLayoutPath = join(root, 'apps/web/src/components/views/page-layout.tsx');
const entityDetailLayoutPath = join(root, 'apps/web/src/components/views/entity-detail-layout.tsx');
const entityDetailHeaderPath = join(
  root,
  'apps/web/src/components/views/entity-detail-header-content.tsx',
);
const projectHeaderActionsPath = join(
  root,
  'apps/web/src/components/project-detail/project-header-actions.tsx',
);

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Projects experience contract', () => {
  it('keeps list and timeline lenses over shared view state, with dependencies on its own page', () => {
    const overview = source(overviewPath);
    const workPage = source(workPagePath);
    // The list-page arrangement + canonical title token live once in the shared layout; the page
    // adopts ListPageLayout and supplies content, rather than restating the skeleton or the token.
    expect(source(pageLayoutPath)).toContain('text-headline-medium');
    expect(overview).toContain('<WorkViewPage');
    expect(workPage).toContain('<ListPageLayout');
    expect(workPage).toContain('<WorkViewToolbar');
    expect(workPage).toContain('<WorkViewTabs');
    const workTabs = source(workTabsPath);
    expect(workTabs).toContain('onToggleFavorite');
    // Dependencies is its own route rendering the shared React Flow canvas (lazy-loaded); the
    // roster carries no dependency mode of its own.
    expect(source(dependencyClientPath)).toContain('<ProjectGraphRoute');
    expect(source(dependencyRoutePath)).toContain('<ProjectGraphPanel');
    expect(workPage).not.toContain('dependencyMode');
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
    expect(workList).toContain('buildWorkListRoster({');
    expect(workList).toContain('pages: groupPages');
  });

  it('preserves dense, stable rows and full columns inside a local scroller', () => {
    const workList = source(workListPath);
    expect(workList).toContain('<EntityTable');
    expect(workList).toContain('tone="tonal"');
    expect(workList).toContain('rowHeight={rowHeight}');
    expect(workList).toContain('virtualized');
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
    const workListColumns = source(workListColumnsPath);
    expect(workPage).toContain("properties: ['status', 'priority', 'health', 'lead'");
    expect(workListColumns).toContain('workViewDisplayFieldCatalog(target)');
  });

  it('keeps Project identity and work ahead of progressive metadata', () => {
    const detail = source(detailPath);
    const header = source(entityDetailHeaderPath);
    // Identity + arrangement come from the one shared shell; the page composes it and never
    // hand-rolls its own masthead or restates the canonical title token.
    expect(detail).toContain('<EntityDetailLayout');
    expect(detail).toMatch(/<EntityMetadataRow\s+ariaLabel="Project properties"\s+layout="wrap"/);
    expect(detail).toContain('<PropertiesPanel');
    expect(detail).toContain('<ProjectPeopleRow');
    expect(detail).toContain('<EntityIconPicker');
    // The owner is a primary visible property inside the shared row, ahead of status and dates.
    expect(detail).toMatch(
      /<EntityMetadataRow[\s\S]*?<EntityMetadataItem priority=\{0\}[^>]*>\s*<ProjectPeopleRow/,
    );
    expect(detail.indexOf('<ProjectPeopleRow')).toBeLessThan(detail.indexOf('<PropertiesPanel'));
    expect(detail).toContain('ownerId={project.leadId ?? null}');
    expect(detail).toContain('patchProject({ leadId })');
    expect(detail).not.toContain('aria-label="Project people"');
    // Shared identity markup owns the title scale, including legacy stacked headers.
    expect(header).toContain('text-headline-medium');
    expect(detail).not.toContain('text-headline-large');
    // Both work and legacy masthead identities precede the subtitle and metadata section.
    const masthead = header.slice(
      header.indexOf('export function FullDetailMasthead'),
      header.indexOf('function ResponsiveWorkIdentity'),
    );
    expect(masthead.indexOf('<ResponsiveWorkIdentity')).toBeGreaterThan(-1);
    expect(masthead.indexOf('<MastheadIdentity')).toBeGreaterThan(-1);
    expect(masthead.indexOf('<ResponsiveWorkIdentity')).toBeLessThan(
      masthead.indexOf('{metadata}'),
    );
    expect(masthead.indexOf('<MastheadIdentity')).toBeLessThan(masthead.indexOf('{metadata}'));
    expect(masthead.indexOf('{subtitle}')).toBeLessThan(masthead.indexOf('{metadata}'));
    expect(detail).not.toContain('Project lead');
    expect(detail).not.toContain('Contributor');
    expect(detail).not.toContain('No people yet');
    expect(detail).not.toContain('Project info');
    expect(detail).toContain('<DetailPrintSummary');
  });

  it('composes a document-first operating overview without duplicating operational tabs', () => {
    const detail = source(detailPath);
    expect(detail).toContain('<LatestUpdateSummary');
    expect(detail).toContain('<OverviewSummary');
    expect(detail).toContain('<ProjectMilestonesPanel');
    expect(detail).toContain('<AgentsStrip');
    expect(detail).toContain('<AgentActivityFeed');
    expect(detail).toContain('<ProjectDependenciesPanel');
    expect(detail.indexOf('<TemplateAwareEntityDocument')).toBeLessThan(
      detail.indexOf('<LatestUpdateSummary'),
    );
    expect(detail).toMatch(/<TemplateAwareEntityDocument\s+presentation="writing"/);
    expect(detail).toContain("tab === 'overview' || tab === 'tasks'");
  });

  it('keeps Repeat project inside the Project actions menu', () => {
    const detail = source(detailPath);
    const actions = source(projectHeaderActionsPath);
    expect(detail).toMatch(
      /<ProjectHeaderActions[\s\S]*?onRepeat=\{\(\) => \{\s*setRepeatProjectOpen\(true\)/,
    );
    expect(actions).toMatch(/<WorkTemplateHeader[\s\S]*?presentation="menu"[\s\S]*?menuItems=/);
    expect(actions).toMatch(
      /canEdit \? \(\s*<DropdownMenuItem onSelect=\{onRepeat\}>[\s\S]*?Repeat \{noun\.toLowerCase\(\)\}[\s\S]*?<\/DropdownMenuItem>/,
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

  it('keeps primary properties visible in a wrapping row with supplemental properties in overflow', () => {
    const detail = source(detailPath);
    const layout = source(entityDetailLayoutPath);
    // Primary properties remain visible; the shared row owns supplemental disclosure.
    expect(detail).not.toContain('propertiesOpen');
    expect(detail).not.toContain('<Popover open=');
    expect(detail).not.toContain('<PopoverContent');
    expect(detail).not.toContain('aria-label="Open project properties"');
    expect(detail).toMatch(/<EntityMetadataRow\s+ariaLabel="Project properties"\s+layout="wrap"/);
    expect(detail).toContain('overflowLabel="Properties"');
    expect(detail).toContain('<EntityMetadataItem priority={6} overflowOnly>');
    // Every chip reads as the same calm pill, wired once through the shell's shared chip class.
    expect(layout).toContain('bg-surface-container-low hover:bg-surface-container-high');
    // The tab bar adopts the shared Tabs primitive (which owns the touch-target floor and its
    // own track styling), so the shell draws no rule beneath it. The header still needs a boundary
    // — it is sticky and opaque, and content passes behind it — and M3 expresses that with the
    // scrolled app bar's tonal step rather than a hairline or a shadow. `.detail-header` takes
    // `surface-container` as the collapse progresses; see `detail-header-lift` in globals.css.
    expect(detail).toContain('<Tabs');
    expect(layout).not.toContain('<Separator');
  });

  it('uses full-width heading-free documents and canonical MD3 prose hierarchy', () => {
    const document = source(documentPath);
    const editor = source(editorPath);
    // The contents rail sits in a right-hand column and the body is the first column, so the body
    // stays flush with the masthead instead of being indented by a left rail. The body's surface
    // spans its column (docs/design/references/detail-page-layout.md, rule 2); the editor inside
    // it holds the 75ch line length.
    expect(document).toContain('@4xl:grid-cols-[minmax(0,1fr)_11rem]');
    expect(document).toContain('grid min-w-0 flex-1 gap-4');
    expect(document).not.toContain('max-w-[calc(75ch+2rem)]');
    expect(document).toContain('max-w-[75ch]');
    expect(document).not.toContain('max-w-none');
    expect(document).not.toContain('grid-cols-[9rem');
    // The rail itself — including the compact disclosure it collapses into — is shared with the
    // create composer, so its markup lives in the extracted module the document composes.
    expect(source(documentContentsPath)).toContain('ExpandMoreRounded');
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
