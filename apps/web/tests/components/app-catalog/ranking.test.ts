import { describe, expect, it } from 'vitest';

import {
  mergeSearchCandidates,
  rankSearchCandidates,
  type SearchCandidate,
} from '@/components/app-catalog/ranking';

function candidate(
  id: string,
  label: string,
  input: Partial<SearchCandidate> = {},
): SearchCandidate {
  return {
    id,
    label,
    description: '',
    aliases: [],
    breadcrumb: [],
    kindLabel: 'Destination',
    source: 'catalog',
    sourceRank: 0,
    ...input,
  };
}

describe('rankSearchCandidates', () => {
  it('orders exact labels and aliases before prefixes, descriptions, and subsequences', () => {
    const ranked = rankSearchCandidates(
      [
        candidate('subsequence', 'Secure activity'),
        candidate('description', 'Account', { description: 'Change your security preferences.' }),
        candidate('alias', 'Passkeys', { aliases: ['security'] }),
        candidate('prefix', 'Security center'),
        candidate('exact', 'Security'),
      ],
      'security',
    );

    expect(ranked.map((item) => item.id)).toEqual([
      'exact',
      'alias',
      'prefix',
      'description',
      'subsequence',
    ]);
  });

  it('normalizes case, punctuation, and accents before matching', () => {
    const ranked = rankSearchCandidates(
      [candidate('calendar', 'Calendár sync'), candidate('unrelated', 'Notifications')],
      'calendar-sync',
    );

    expect(ranked.map((item) => item.id)).toEqual(['calendar']);
  });

  it('treats an exact alias as an exact match before a label prefix', () => {
    const ranked = rankSearchCandidates(
      [
        candidate('prefix', 'Security center'),
        candidate('alias', 'Passkeys', { aliases: ['security'] }),
      ],
      'security',
    );

    expect(ranked.map((item) => item.id)).toEqual(['alias', 'prefix']);
  });
});

describe('mergeSearchCandidates', () => {
  it('lets an exact catalog match outrank a weak server match', () => {
    const merged = mergeSearchCandidates(
      [candidate('setting:security', 'Security', { kindLabel: 'Setting' })],
      [
        candidate('task:security-review', 'Quarterly review', {
          description: 'Review the security program.',
          kindLabel: 'Task',
          source: 'remote',
          sourceRank: 0,
        }),
      ],
      'security',
    );

    expect(merged.map((item) => item.id)).toEqual(['setting:security', 'task:security-review']);
  });

  it('uses server rank to order otherwise equal remote results and caps the list', () => {
    const remote = Array.from({ length: 24 }, (_, index) =>
      candidate(`remote:${String(index)}`, `Budget ${String(index)}`, {
        source: 'remote',
        sourceRank: index,
      }),
    );

    const merged = mergeSearchCandidates([], remote, 'budget');

    expect(merged).toHaveLength(20);
    expect(merged[0]?.id).toBe('remote:23');
  });
});
