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
const buttonPath = join(root, 'packages/ui/src/primitives/button.tsx');
const dialogPath = join(root, 'packages/ui/src/primitives/dialog.tsx');
const iconPickerPath = join(root, 'apps/web/src/components/initiatives/initiative-icon-picker.tsx');
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

  it('gives the Initiative overview a restrained canonical MD3 headline scale', () => {
    const typography = source(typographyPath);
    const overview = source(overviewPath);
    // The canonical title token now lives once in the shared layout; the overview adopts it by
    // composing ListPageLayout rather than restating the token or the header skeleton.
    expect(typography).toContain('--text-headline-medium: 1.75rem;');
    expect(source(pageLayoutPath)).toContain('text-headline-medium');
    expect(overview).toContain('<ListPageLayout');
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

  it('keeps attention content and controls in one borderless tonal surface', () => {
    const overview = source(overviewPath);
    expect(overview).toContain('bg-surface-container-low');
    expect(overview).toContain('data-testid="initiative-attention-controls"');
    expect(overview).toContain('data-testid="initiative-attention-footer"');
    expect(overview).not.toContain('@4xl:flex-row @4xl:items-center @4xl:justify-between');
    expect(overview).not.toContain('gap-3 border-y px-1 py-4');
  });

  it('separates the page header, attention surface, and roster with grouped spacing', () => {
    const overview = source(overviewPath);
    // The container measure + rhythm now lives once in the shared layout; the page adopts
    // ListPageLayout rather than restating the utility string.
    expect(source(pageLayoutPath)).toContain('max-w-7xl flex-col gap-5');
    expect(overview).toContain('<ListPageLayout');
    expect(overview).toContain('bg-surface-container-low mb-2 flex flex-col rounded-xl p-4');
    expect(overview).not.toContain('max-w-7xl flex-col gap-6');
  });

  it('keeps the complete padded roster scrollable without wrapping metadata', () => {
    const overview = source(overviewPath);
    expect(overview).toContain('overflow-x-auto');
    expect(overview).toContain('min-w-[56rem]');
    expect(overview).toContain('role="treegrid"');
    expect(overview).toContain('px-3');
    expect(overview).toContain('whitespace-nowrap');
    expect(overview).toContain('line-clamp-1 min-w-0');
    expect(overview).toContain('line-clamp-2');
    expect(overview).toContain('max-w-[44ch]');
    expect(overview).toContain('{item.summary ? (');
    expect(overview).not.toContain('border-b md:table-row');
  });

  it('renders an always-visible hierarchy with curved semantic rails instead of collapse controls', () => {
    const overview = source(overviewPath);
    expect(overview).toContain('data-testid="initiative-hierarchy-rail"');
    expect(overview).toContain('strokeWidth="2"');
    expect(overview).toContain('strokeLinecap="round"');
    expect(overview).toContain('strokeLinejoin="round"');
    expect(overview).not.toContain('const [collapsed');
    expect(overview).not.toContain('Collapse ${item.name}');
    expect(overview).not.toContain('<ChevronDown');
  });

  it('keeps icon-only Initiative controls in 40px interactive targets', () => {
    const overview = source(overviewPath);
    const picker = source(iconPickerPath);
    const button = source(buttonPath);
    const dialog = source(dialogPath);
    expect(button).toContain("icon: 'h-10 w-10'");
    expect(dialog).toContain('h-10 w-10');
    expect(overview).toContain('size="icon"');
    expect(picker).toContain('flex size-10 shrink-0 items-center justify-center');
    expect(overview).not.toContain('@2xl:size-6');
  });

  it('uses Material icon components instead of Unicode control glyphs', () => {
    const overview = source(overviewPath);
    const picker = source(iconPickerPath);
    expect(overview).toContain('<ChevronLeft');
    expect(overview).toContain('<ChevronRight');
    expect(overview).toContain('<InitiativeIconPicker');
    expect(picker).toContain('<PopoverContent');
    expect(picker).toContain('Rounded');
    expect(picker).toContain('type="search"');
    expect(picker).toContain('aria-label="Initiative icon"');
    expect(picker).toContain('aria-label="Initiative color"');
    expect(overview).not.toMatch(/[←→›⌄]/u);
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
