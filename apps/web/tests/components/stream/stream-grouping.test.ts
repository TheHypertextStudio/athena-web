import { describe, expect, it } from 'vitest';

import { groupByRecency } from '@/components/stream/stream-grouping';
import type { StreamEventRow } from '@/components/stream/stream-meta';

function row(id: string, occurredAt: string): StreamEventRow {
  return {
    id,
    organizationId: 'org_1',
    provider: 'docket',
    origin: 'docket',
    kind: 'status_change',
    occurredAt,
    title: id,
    summary: null,
    permalink: null,
    actorName: null,
    actorAvatar: null,
    subjectType: null,
    subjectTitle: null,
    subjectId: null,
    relevance: null,
    rendering: { icon: 'status', category: 'progress' },
    payload: {},
  };
}

const NOW = new Date('2026-06-29T15:00:00');

describe('groupByRecency', () => {
  it('buckets rows into Today / Yesterday / Earlier this week / Earlier', () => {
    const rows = [
      row('today', '2026-06-29T09:00:00'),
      row('yesterday', '2026-06-28T20:00:00'),
      row('thisweek', '2026-06-25T10:00:00'),
      row('earlier', '2026-05-01T10:00:00'),
    ];
    const groups = groupByRecency(rows, NOW);
    expect(groups.map((g) => g.label)).toEqual([
      'Today',
      'Yesterday',
      'Earlier this week',
      'Earlier',
    ]);
    expect(groups.map((g) => g.rows.map((r) => r.id))).toEqual([
      ['today'],
      ['yesterday'],
      ['thisweek'],
      ['earlier'],
    ]);
  });

  it('omits empty buckets', () => {
    const groups = groupByRecency([row('a', '2026-06-29T08:00:00')], NOW);
    expect(groups.map((g) => g.label)).toEqual(['Today']);
  });

  it('returns nothing for no rows', () => {
    expect(groupByRecency([], NOW)).toEqual([]);
  });
});
