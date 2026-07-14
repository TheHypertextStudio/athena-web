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

  it('gives the Initiative overview a named branded page-title scale', () => {
    const typography = source(typographyPath);
    const overview = source(overviewPath);
    expect(typography).toContain('--text-page-title: clamp(2rem, 1.8rem + 0.8vw, 2.5rem);');
    expect(overview).toContain('text-page-title');
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
    expect(overview).toContain('max-w-7xl flex-col gap-6');
    expect(overview).toContain('bg-surface-container-low mb-2 flex flex-col rounded-xl p-4');
    expect(overview).not.toContain('max-w-7xl flex-col gap-5');
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
