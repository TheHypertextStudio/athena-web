import { describe, expect, it } from 'vitest';

import { rankInitiativeAttention } from '../src/routes/initiative-attention';

const NOW = new Date('2026-07-13T12:00:00.000Z');

describe('Initiative attention ranking', () => {
  it('ranks risk before stale, uses cadence boundaries, deduplicates, and caps at four', () => {
    const rows = [
      {
        id: 'risk',
        status: 'active' as const,
        health: 'at_risk' as const,
        updateCadence: 'weekly' as const,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        lastUpdateAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'off-track',
        status: 'active' as const,
        health: 'off_track' as const,
        updateCadence: 'none' as const,
        createdAt: NOW,
        lastUpdateAt: null,
      },
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `stale-${index}`,
        status: 'active' as const,
        health: null,
        updateCadence: 'weekly' as const,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        lastUpdateAt: index === 0 ? new Date('2026-07-06T12:00:00.000Z') : null,
      })),
    ];

    const ranked = rankInitiativeAttention(rows, NOW);
    expect(ranked).toHaveLength(4);
    expect(ranked.map((item) => item.candidate.id).slice(0, 2)).toEqual(['off-track', 'risk']);
    expect(ranked.find((item) => item.candidate.id === 'risk')?.severity).toBe('at_risk');
    expect(ranked.filter((item) => item.candidate.id === 'risk')).toHaveLength(1);
    expect(ranked.some((item) => item.severity === 'stale')).toBe(true);
    const boundary = rows[2];
    if (!boundary) throw new Error('boundary fixture missing');
    expect(rankInitiativeAttention([boundary], NOW)[0]?.severity).toBe('stale');
  });

  it('does not stale proposed, terminal, or no-cadence Initiatives', () => {
    const ranked = rankInitiativeAttention(
      ['proposed', 'completed', 'canceled', 'none'].map((id) => ({
        id,
        status: id === 'none' ? ('active' as const) : (id as 'proposed' | 'completed' | 'canceled'),
        health: null,
        updateCadence: id === 'none' ? ('none' as const) : ('weekly' as const),
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
        lastUpdateAt: null,
      })),
      NOW,
    );
    expect(ranked).toEqual([]);
  });
});
