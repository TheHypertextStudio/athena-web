/**
 * `@docket/api` — the personal-data export archive builder (pure, no database).
 *
 * @remarks
 * `src/account/archive.ts` is exercised indirectly through `tests/account/export.test.ts` (real
 * collected documents), but several of its branches — the README's name/email/scope phrasing,
 * the row-count fallbacks, and the account/personal file-inclusion guards — are only reachable
 * with specific `ExportDocument`/`ExportArchiveMeta` shapes that the collector never happens to
 * produce. This file drives `exportSlug`, `exportFilename`, and `buildExportArchive` directly
 * with hand-built documents to reach those shapes.
 */
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import type { AccountExportScope } from '@docket/types';

import {
  buildExportArchive,
  exportFilename,
  exportSlug,
  type ExportArchiveMeta,
  type ExportDocument,
} from '../../src/account/archive';

const META: ExportArchiveMeta = {
  generatedAt: '2026-02-01T00:00:00.000Z',
  expiresAt: '2026-02-15T00:00:00.000Z',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
};

function scope(overrides: Partial<AccountExportScope> = {}): AccountExportScope {
  return {
    categories: ['account', 'personal', 'workspaces'],
    workspaces: [],
    allWorkspaces: true,
    ...overrides,
  };
}

function doc(overrides: Partial<ExportDocument> = {}): ExportDocument {
  return {
    schemaVersion: 1,
    identity: { user: { id: 'user_1' } },
    personal: { notifications: [], observations: [] },
    memberships: [],
    scope: scope(),
    ...overrides,
  };
}

function readme(files: Record<string, Uint8Array>): string {
  const file = files['README.md'];
  if (!file) throw new Error('expected README.md in the archive');
  return strFromU8(file);
}

describe('exportSlug', () => {
  it('slugifies a name to lowercase, hyphenated form', () => {
    expect(exportSlug('Ada Lovelace!')).toBe('ada-lovelace');
  });

  it('strips leading and trailing hyphens produced by non-alphanumeric edges', () => {
    expect(exportSlug('--Ada--')).toBe('ada');
  });

  it('falls back to "account" for null', () => {
    expect(exportSlug(null)).toBe('account');
  });

  it('falls back to "account" for an empty/whitespace-only string', () => {
    expect(exportSlug('   ')).toBe('account');
  });

  it('falls back to "account" when every character is stripped as non-alphanumeric', () => {
    expect(exportSlug('!!!')).toBe('account');
  });
});

describe('exportFilename', () => {
  it('embeds the slugified name and a date-time stamp', () => {
    const readyAt = new Date('2026-06-29T14:30:52.000Z');
    expect(exportFilename('Ada Lovelace', readyAt)).toBe(
      'docket-export-ada-lovelace-2026-06-29-143052.zip',
    );
  });

  it('falls back to the "account" slug when name is null', () => {
    const readyAt = new Date('2026-06-29T14:30:52.000Z');
    expect(exportFilename(null, readyAt)).toBe('docket-export-account-2026-06-29-143052.zip');
  });
});

describe('buildExportArchive — README phrasing', () => {
  it('greets by name and email when both are present', () => {
    const files = unzipSync(buildExportArchive(doc(), META));
    expect(readme(files)).toContain('for Ada Lovelace <ada@example.com>');
  });

  it('greets by name alone when email is absent', () => {
    const files = unzipSync(buildExportArchive(doc(), { ...META, email: null }));
    expect(readme(files)).toContain('for Ada Lovelace,');
    expect(readme(files)).not.toContain('<ada@example.com>');
  });

  it('greets by email alone when name is absent', () => {
    const files = unzipSync(buildExportArchive(doc(), { ...META, name: null }));
    expect(readme(files)).toContain('for ada@example.com,');
  });

  it('falls back to "your account" when both name and email are absent', () => {
    const files = unzipSync(buildExportArchive(doc(), { ...META, name: null, email: null }));
    expect(readme(files)).toContain('for your account,');
  });

  it('reports a complete-copy summary when every category and all workspaces are included', () => {
    const files = unzipSync(buildExportArchive(doc(), META));
    expect(readme(files)).toContain('a complete copy of everything Docket holds');
  });

  it('reports a selected-data summary when a category is excluded', () => {
    const files = unzipSync(
      buildExportArchive(doc({ scope: scope({ categories: ['account', 'personal'] }) }), META),
    );
    expect(readme(files)).toContain('the data you selected');
  });

  it('describes a single selected workspace in the singular', () => {
    const files = unzipSync(
      buildExportArchive(
        doc({
          scope: scope({ allWorkspaces: false }),
          memberships: [
            {
              organization: { id: 'org_1', slug: 'lvbt', name: 'LVBT' },
              work: {},
            },
          ],
        }),
        META,
      ),
    );
    expect(readme(files)).toContain('1 selected workspace\n');
  });

  it('describes multiple selected workspaces in the plural', () => {
    const files = unzipSync(
      buildExportArchive(
        doc({
          scope: scope({ allWorkspaces: false }),
          memberships: [
            { organization: { id: 'org_1', slug: 'lvbt', name: 'LVBT' }, work: {} },
            { organization: { id: 'org_2', slug: 'ht', name: 'Hypertext' }, work: {} },
          ],
        }),
        META,
      ),
    );
    expect(readme(files)).toContain('2 selected workspaces\n');
  });

  it('reports "all workspaces available" when allWorkspaces is true', () => {
    const files = unzipSync(
      buildExportArchive(
        doc({
          memberships: [{ organization: { id: 'org_1', slug: 'lvbt', name: 'LVBT' }, work: {} }],
        }),
        META,
      ),
    );
    expect(readme(files)).toContain('All workspaces available when generated');
  });

  it('marks account information as not selected when the category is absent', () => {
    const files = unzipSync(
      buildExportArchive(
        doc({ identity: null, scope: scope({ categories: ['personal', 'workspaces'] }) }),
        META,
      ),
    );
    expect(readme(files)).toContain('Account information was not selected.');
  });

  it('marks workspace data as not selected when the category is absent', () => {
    const files = unzipSync(
      buildExportArchive(doc({ scope: scope({ categories: ['account', 'personal'] }) }), META),
    );
    expect(readme(files)).toContain('Workspace data was not selected.');
  });

  it('marks personal data as not selected when the category is absent', () => {
    const files = unzipSync(
      buildExportArchive(
        doc({ personal: null, scope: scope({ categories: ['account', 'workspaces'] }) }),
        META,
      ),
    );
    expect(readme(files)).toContain('Personal Docket data was not selected.');
  });

  it('counts zero tasks/projects/comments when a membership work map has none of those keys', () => {
    const files = unzipSync(
      buildExportArchive(
        doc({
          scope: scope({ allWorkspaces: false }),
          memberships: [
            { organization: { id: 'org_1', slug: 'lvbt', name: 'LVBT' }, work: { label: [1, 2] } },
          ],
        }),
        META,
      ),
    );
    const text = readme(files);
    expect(text).toContain('Projects: 0');
    expect(text).toContain('Tasks: 0');
    expect(text).toContain('Comments: 0');
  });

  it('sums tasks/projects/comments across every membership', () => {
    const files = unzipSync(
      buildExportArchive(
        doc({
          scope: scope({ allWorkspaces: false }),
          memberships: [
            {
              organization: { id: 'org_1', slug: 'lvbt', name: 'LVBT' },
              work: { task: [1, 2], project: [1] },
            },
            {
              organization: { id: 'org_2', slug: 'ht', name: 'Hypertext' },
              work: { task: [1], comment: [1, 2, 3] },
            },
          ],
        }),
        META,
      ),
    );
    const text = readme(files);
    expect(text).toContain('Projects: 1');
    expect(text).toContain('Tasks: 3');
    expect(text).toContain('Comments: 3');
  });

  it('counts zero notifications/observations when the personal document lacks those keys', () => {
    const files = unzipSync(buildExportArchive(doc({ personal: {} }), META));
    const text = readme(files);
    expect(text).toContain('Notifications: 0');
    expect(text).toContain('Activity records (observations): 0');
  });
});

describe('buildExportArchive — file inclusion', () => {
  it('always includes README.md and manifest.json', () => {
    const files = unzipSync(buildExportArchive(doc(), META));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['README.md', 'manifest.json']));
  });

  it('omits account.json when the account category is selected but identity is null', () => {
    const files = unzipSync(buildExportArchive(doc({ identity: null }), META));
    expect(files['account.json']).toBeUndefined();
  });

  it('omits personal.json when the personal category is selected but the document is null', () => {
    const files = unzipSync(buildExportArchive(doc({ personal: null }), META));
    expect(files['personal.json']).toBeUndefined();
  });

  it('writes no workspace files for a document with no memberships', () => {
    const files = unzipSync(buildExportArchive(doc({ memberships: [] }), META));
    expect(Object.keys(files).some((name) => name.startsWith('workspaces/'))).toBe(false);
  });

  it('writes one collision-proof file per membership, suffixed with the org id', () => {
    const files = unzipSync(
      buildExportArchive(
        doc({
          scope: scope({ allWorkspaces: false }),
          memberships: [
            { organization: { id: 'org_aaaaaa111111', slug: 'lvbt', name: 'LVBT' }, work: {} },
            { organization: { id: 'org_bbbbbb222222', slug: null, name: 'No Slug Org' }, work: {} },
          ],
        }),
        META,
      ),
    );
    const workspaceFiles = Object.keys(files).filter((name) => name.startsWith('workspaces/'));
    expect(workspaceFiles.sort()).toEqual([
      'workspaces/lvbt-111111.json',
      'workspaces/no-slug-org-222222.json',
    ]);
  });

  it('embeds the schema version, timestamps, scope, and workspace count in manifest.json', () => {
    const files = unzipSync(
      buildExportArchive(
        doc({
          schemaVersion: 3,
          scope: scope({ allWorkspaces: false }),
          memberships: [{ organization: { id: 'org_1', slug: 'lvbt', name: 'LVBT' }, work: {} }],
        }),
        META,
      ),
    );
    const manifest = JSON.parse(strFromU8(files['manifest.json']!)) as {
      schemaVersion: number;
      generatedAt: string;
      expiresAt: string;
      workspaceCount: number;
    };
    expect(manifest.schemaVersion).toBe(3);
    expect(manifest.generatedAt).toBe(META.generatedAt);
    expect(manifest.expiresAt).toBe(META.expiresAt);
    expect(manifest.workspaceCount).toBe(1);
  });
});
