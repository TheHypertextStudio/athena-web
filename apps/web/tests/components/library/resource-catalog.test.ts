import { describe, expect, it } from 'vitest';
import type { SearchResult } from '../../../src/lib/contracts/search';

import { buildResourceCatalog } from '@/components/library/resource-catalog';
import { applyView, EMPTY_GROUP_ID } from '@/components/views/apply-view';

function row(
  id: string,
  usedIn: SearchResult['usedIn'],
  overrides: Partial<SearchResult> = {},
): SearchResult {
  return {
    id,
    organizationId: null,
    userId: null,
    kind: 'external_resource',
    family: 'content',
    title: id,
    summary: null,
    snippet: null,
    matchedFields: [],
    route: { type: 'external', externalUrl: `https://example.com/${id}` },
    subject: null,
    source: null,
    facets: { provider: 'web' },
    actions: [],
    score: 0,
    entityId: id,
    externalUrl: `https://example.com/${id}`,
    usedIn,
    updatedAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
  };
}

describe('Library resource catalog', () => {
  it('groups one resource into every work context and leaves Unreferenced last', () => {
    const rows = [
      row('multi', [
        { kind: 'initiative', id: 'initiative-1', title: 'Q3 launch' },
        { kind: 'project', id: 'project-1', title: 'API audit' },
      ]),
      row('orphan', []),
    ];
    const applied = applyView(
      rows,
      { filters: [], groupBy: { field: 'usedIn' }, sort: [] },
      buildResourceCatalog(rows),
    );

    expect(applied.groups?.map((group) => group.label)).toEqual([
      'Q3 launch',
      'API audit',
      'Unreferenced',
    ]);
    expect(applied.groups?.at(-1)?.id).toBe(EMPTY_GROUP_ID);
    expect(applied.groups?.slice(0, 2).map((group) => group.rows[0]?.id)).toEqual([
      'multi',
      'multi',
    ]);
  });

  it('keeps Source and Type as independent Display groupings', () => {
    const rows = [
      row('linked', [], { facets: { provider: 'google_drive' } }),
      row('file', [], {
        kind: 'attachment',
        facets: { attachmentKind: 'file' },
        externalUrl: null,
      }),
    ];
    const catalog = buildResourceCatalog(rows);

    expect(
      applyView(
        rows,
        { filters: [], groupBy: { field: 'provider' }, sort: [] },
        catalog,
      ).groups?.map((group) => group.label),
    ).toEqual(['Drive', 'Uploaded file']);
    expect(
      applyView(rows, { filters: [], groupBy: { field: 'type' }, sort: [] }, catalog).groups?.map(
        (group) => group.label,
      ),
    ).toEqual(['Linked', 'Attached']);
  });
});
