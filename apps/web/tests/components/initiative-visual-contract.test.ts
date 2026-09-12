import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../');
const overviewPath = join(
  root,
  'apps/web/src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx',
);
const workPagePath = join(root, 'apps/web/src/components/work-views/work-view-page.tsx');
const workTabsPath = join(root, 'apps/web/src/components/work-views/work-view-tabs.tsx');
const workViewToolbarPath = join(root, 'apps/web/src/components/work-views/work-view-toolbar.tsx');
const detailPath = join(
  root,
  'apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/initiative-detail-client.tsx',
);
const typographyPath = join(root, 'packages/ui/src/styles/globals.css');
const buttonPath = join(root, 'packages/ui/src/primitives/button.tsx');
const dialogPath = join(root, 'packages/ui/src/primitives/dialog.tsx');
const controlPath = join(root, 'packages/ui/src/primitives/control.tsx');
const iconPickerPath = join(root, 'apps/web/src/components/entity-display/entity-icon-picker.tsx');
const loadedIconPickerPath = join(
  root,
  'apps/web/src/components/entity-display/entity-icon-picker-loaded.tsx',
);
const pageLayoutPath = join(root, 'apps/web/src/components/views/page-layout.tsx');
const entityDetailLayoutPath = join(root, 'apps/web/src/components/views/entity-detail-layout.tsx');

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

function productionTypeSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (
      entry.isDirectory() &&
      (entry.name === 'tests' || entry.name === 'node_modules' || entry.name.startsWith('.'))
    ) {
      return [];
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeSources(path);
    return entry.isFile() && /\.(?:css|ts|tsx)$/.test(path) ? [path] : [];
  });
}

describe('Initiative visual contract', () => {
  it('uses the canonical MD3 headline for detail titles and keeps status in the properties rail', () => {
    const typography = source(typographyPath);
    const detail = source(detailPath);
    const layout = source(entityDetailLayoutPath);
    // The detail title adopts the shared shell, whose canonical token is headline-medium; the page
    // composes the shell and never restates the token or diverges to headline-large.
    expect(typography).toContain('--text-headline-medium: 1.75rem;');
    expect(layout).toContain('text-headline-medium');
    expect(detail).toContain('<EntityDetailLayout');
    expect(detail).toContain('<EntityMetadataRow');
    expect(detail).not.toContain('text-headline-large');
    // Status is no longer duplicated as an eyebrow/chip above the title; it lives once in the rail
    // through the properties panel that fills the metadata slot.
    expect(detail).toContain('<InitiativePropertiesPanel');
    expect(detail).toContain('status={detail.status}');
    expect(detail).not.toContain('variant="secondary"');
  });

  it('keeps Initiative overview document-first: the document and a latest update, nothing else', () => {
    const detail = source(detailPath);
    expect(detail).toContain('<TemplateAwareEntityDocument');
    expect(detail).toContain('<LatestUpdateSummary');
    expect(detail.indexOf('<TemplateAwareEntityDocument')).toBeLessThan(
      detail.indexOf('<LatestUpdateSummary'),
    );
    expect(detail).toContain("tab === 'overview' || tab === 'updates'");
    // The connected-work rollup card used to sit between them: two headline-sized zeros counting
    // work you could not see, under a heading that repeated a tab's name, above a sentence telling
    // you to go to that tab. The counts are the rows on that tab, and the health spread now sits
    // beside them.
    expect(detail).not.toContain('<InitiativeOverviewSummary');
  });

  it('summarises connected-work health beside the work it summarises', () => {
    const panels = source(
      join(root, 'apps/web/src/components/initiatives/initiative-relationship-panels.tsx'),
    );
    expect(panels).toContain('<DistributionBar');
    expect(panels).toContain('distribution={distribution}');
    // Only alongside rows — a distribution over nothing is chrome drawn on an absence.
    expect(panels).toMatch(/!loading && connectedWork\.length \? \(/);
  });

  it('gives the Initiative overview a restrained canonical MD3 headline scale', () => {
    const typography = source(typographyPath);
    const overview = source(overviewPath);
    const workPage = source(workPagePath);
    // The canonical title token now lives once in the shared layout; the overview adopts it by
    // composing ListPageLayout rather than restating the token or the header skeleton.
    expect(typography).toContain('--text-headline-medium: 1.75rem;');
    expect(source(pageLayoutPath)).toContain('text-headline-medium');
    expect(overview).toContain('<WorkViewPage');
    expect(workPage).toContain('<ListPageLayout');
  });

  it('defines the complete MD3 type scale and removes the ad hoc application scale', () => {
    const typography = source(typographyPath);
    const required = [
      'display-large',
      'display-medium',
      'display-small',
      'headline-large',
      'headline-medium',
      'headline-small',
      'title-large',
      'title-medium',
      'title-small',
      'body-large',
      'body-medium',
      'body-small',
      'label-large',
      'label-medium',
      'label-small',
    ];
    for (const token of required) expect(typography).toContain(`--text-${token}:`);

    const removed = [
      'text-document-title',
      'text-page-title',
      'text-h1',
      'text-h2',
      'text-h3',
      'text-body',
      'text-mono',
      'text-display',
      'text-title',
    ];
    const production = productionTypeSources(join(root, 'apps'))
      .concat(productionTypeSources(join(root, 'packages')))
      .map((path) => `${relative(root, path)}\n${source(path)}`)
      .join('\n');
    for (const token of removed) {
      expect(production).not.toMatch(new RegExp(`(?<![A-Za-z0-9_-])${token}(?![A-Za-z0-9_-])`));
    }
  });

  it('keeps Initiative controls in the shared non-wrapping toolbar', () => {
    const workPage = source(workPagePath);
    expect(workPage).toContain('<WorkViewToolbar');
    expect(workPage).toContain('showQueryControls={!dependencyMode}');
    expect(workPage).not.toContain('data-testid="initiative-attention-controls"');
    expect(workPage).not.toContain('gap-3 border-y px-1 py-4');
  });

  it('keeps view tabs and the dedicated More menu in one clipped control row', () => {
    const workPage = source(workPagePath);
    const toolbar = source(workViewToolbarPath);

    expect(source(workTabsPath)).toContain(
      'flex min-w-0 flex-1 items-center gap-1 overflow-hidden',
    );
    expect(workPage).not.toContain('overflow-x-auto');
    expect(toolbar).toContain('w-full flex-nowrap overflow-hidden');
    expect(toolbar).toContain('aria-label="More view controls"');
    expect(workPage).toMatch(
      /const viewOverflowItems[\s\S]*?controller\.toggleFavoriteView\(view\.id\)/,
    );
  });

  it('separates the page header, attention surface, and roster with grouped spacing', () => {
    const overview = source(overviewPath);
    const workPage = source(workPagePath);
    // The container measure + rhythm still live once in the shared layout; the page adopts
    // ListPageLayout rather than restating the utility string. Two things have become conditional
    // since: the rhythm is a container-query step (a phone gives up gutter and gap so the surface's
    // own content keeps the width), and the reading measure applies only to *document* pages — a
    // canvas surface fills instead. Both are still declared exactly once, here.
    // Symmetric at every step: the base rung used to inset 12px at the sides and 16px at the top,
    // which is the same disagreement the detail shell had between its gutter and its literals.
    expect(source(pageLayoutPath)).toContain('mx-auto flex w-full flex-col p-3');
    expect(source(pageLayoutPath)).toContain('@2xl:gap-5');
    expect(source(pageLayoutPath)).toContain("'h-full min-h-0 gap-3 @2xl:gap-4 @2xl:p-4 @4xl:p-4'");
    expect(source(pageLayoutPath)).toContain("'max-w-7xl gap-4");
    expect(overview).toContain('<WorkViewPage');
    expect(workPage).toContain('<ListPageLayout');
    expect(workPage).toContain('fill');
    expect(overview).not.toContain('max-w-7xl flex-col gap-6');
  });

  it('keeps icon-only Initiative controls at least 40px and uses a 48px detail glyph', () => {
    const workPage = source(workPagePath);
    const detail = source(detailPath);
    const picker = source(iconPickerPath);
    const button = source(buttonPath);
    const dialog = source(dialogPath);
    // `size="icon"` no longer carries its own literal geometry: it maps onto the shared control
    // scale (`packages/ui/src/primitives/control.tsx`), whose `xl` step is the 40px target. The
    // assertion follows the mapping to the scale so the 40px guarantee is still checked at its
    // real source rather than at a string that has moved.
    const control = source(controlPath);
    expect(button).toContain("icon: 'xl'");
    expect(control).toMatch(/xl:\s*\{[^}]*height: 'h-10'/);
    expect(control).toMatch(/xl:\s*\{[^}]*width: 'w-10'/);
    expect(control).toContain("fixed: 'coarse:h-10'");
    expect(control).toContain("width: 'coarse:w-10'");
    expect(dialog).toContain("controlChrome('sm', { iconOnly: true })");
    expect(workPage).toContain('icon: Target');
    expect(picker).toContain('props.size ?? 32');
    expect(picker).toContain('Math.max(40, size)');
    expect(detail).toContain('size={48}');
    expect(workPage).not.toContain('@2xl:size-6');
  });

  it('uses Material icon components instead of Unicode control glyphs', () => {
    const workPage = source(workPagePath);
    const picker = source(loadedIconPickerPath);
    expect(workPage).toContain('icon: Target');
    expect(workPage).toContain('<Plus');
    expect(picker).toContain('<PopoverContent');
    expect(picker).toContain('Rounded');
    expect(picker).toContain('type="search"');
    expect(picker).toContain('aria-label="Glyph catalog"');
    expect(picker).toContain('aria-label="Entity color"');
    expect(workPage).not.toMatch(/[←→›⌄]/u);
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
