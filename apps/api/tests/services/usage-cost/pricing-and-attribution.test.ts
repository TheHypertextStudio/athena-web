import { describe, expect, it } from 'vitest';

import { assertDefined } from '@docket/test-utils';

import {
  attributeLedger,
  totalByHolder,
  UNATTRIBUTED_KEY,
  userKey,
  workspaceKey,
  type LedgerRow,
} from '../../../src/services/usage-cost/attribution';
import { mergeTokenRows } from '../../../src/services/usage-cost/lattice-tokens';
import { costMicros, resolveRate, type RateRow } from '../../../src/services/usage-cost/rates';
import { samplePercent, splitByRowBytes } from '../../../src/services/usage-cost/storage';

function rate(overrides: Partial<RateRow> & Pick<RateRow, 'resource'>): RateRow {
  return {
    dimension: '',
    microsPerMillionUnits: 1_000_000,
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function row(overrides: Partial<LedgerRow> & Pick<LedgerRow, 'resource'>): LedgerRow {
  return {
    day: '2026-03-10',
    userId: null,
    organizationId: null,
    dimension: '',
    quantity: 1_000_000,
    unmeasuredEvents: 0,
    ...overrides,
  };
}

describe('resolveRate', () => {
  it('never applies a general hosted-token rate to own-hardware usage', () => {
    const general = rate({ resource: 'ai_input_tokens' });
    const local = rate({
      resource: 'ai_input_tokens',
      dimension: 'lattice:model',
      microsPerMillionUnits: 0,
    });
    expect(
      resolveRate([general], 'ai_input_tokens', 'lattice:model', '2026-03-10'),
    ).toBeUndefined();
    expect(resolveRate([general, local], 'ai_input_tokens', 'lattice:model', '2026-03-10')).toBe(
      local,
    );
  });

  it('uses the resource rate when no rate names the dimension', () => {
    const general = rate({ resource: 'ai_input_tokens', microsPerMillionUnits: 3 });

    expect(resolveRate([general], 'ai_input_tokens', 'some-model', '2026-03-10')).toBe(general);
  });

  it('prefers a rate for the exact dimension while it is in effect', () => {
    const general = rate({ resource: 'ai_input_tokens', microsPerMillionUnits: 3 });
    const specific = rate({
      resource: 'ai_input_tokens',
      dimension: 'big-model',
      microsPerMillionUnits: 15,
    });

    expect(resolveRate([general, specific], 'ai_input_tokens', 'big-model', '2026-03-10')).toBe(
      specific,
    );
    expect(resolveRate([general, specific], 'ai_input_tokens', 'small-model', '2026-03-10')).toBe(
      general,
    );
  });

  it('does not let a dimension rate that starts later hide the general rate before it', () => {
    const general = rate({ resource: 'ai_input_tokens' });
    const specific = rate({
      resource: 'ai_input_tokens',
      dimension: 'big-model',
      effectiveFrom: new Date('2026-06-01T00:00:00Z'),
    });

    expect(resolveRate([general, specific], 'ai_input_tokens', 'big-model', '2026-03-10')).toBe(
      general,
    );
  });

  it('applies a newer price from its first day and keeps the old price before it', () => {
    const old = rate({ resource: 'postgres_bytes', microsPerMillionUnits: 10 });
    const next = rate({
      resource: 'postgres_bytes',
      microsPerMillionUnits: 20,
      effectiveFrom: new Date('2026-03-10T15:00:00Z'),
    });

    expect(resolveRate([old, next], 'postgres_bytes', '', '2026-03-09')).toBe(old);
    expect(resolveRate([old, next], 'postgres_bytes', '', '2026-03-10')).toBe(next);
  });

  it('reports no rate when none applies', () => {
    const future = rate({
      resource: 'object_bytes',
      effectiveFrom: new Date('2026-12-01T00:00:00Z'),
    });

    expect(resolveRate([future], 'object_bytes', '', '2026-03-10')).toBeUndefined();
    expect(resolveRate([future], 'postgres_bytes', '', '2026-12-02')).toBeUndefined();
  });
});

describe('costMicros', () => {
  it('prices a quantity per million units', () => {
    expect(costMicros(2_000_000, 3_000_000)).toBe(6_000_000);
    expect(costMicros(500_000, 3_000_000)).toBe(1_500_000);
  });

  it('rounds to the nearest micro-dollar', () => {
    expect(costMicros(1, 500_000)).toBe(1);
    expect(costMicros(1, 499_999)).toBe(0);
  });

  it('stays exact where a double would not', () => {
    const quantity = 9_000_000_000_000;
    const price = 9_000_000;

    expect(costMicros(quantity, price)).toBe(81_000_000_000_000);
  });
});

describe('attributeLedger', () => {
  const rates = [
    rate({ resource: 'ai_input_tokens', microsPerMillionUnits: 2_000_000 }),
    rate({ resource: 'postgres_bytes', microsPerMillionUnits: 1_000_000 }),
  ];
  const owners = new Map([['org-1', ['alice', 'bob']]]);

  it('assigns by recorded person, then workspace, then nothing, under the caused lens', () => {
    const rows = [
      row({ resource: 'postgres_bytes', userId: 'carol', organizationId: 'org-1' }),
      row({ resource: 'postgres_bytes', organizationId: 'org-1' }),
      row({ resource: 'postgres_bytes' }),
    ];

    const keys = attributeLedger(rows, rates, owners, 'caused').map((entry) => entry.key);

    expect(keys).toEqual([userKey('carol'), workspaceKey('org-1'), UNATTRIBUTED_KEY]);
  });

  it('charges AI usage to its owning person under the pays lens, wherever it ran', () => {
    const attributed = attributeLedger(
      [row({ resource: 'ai_input_tokens', userId: 'carol', organizationId: 'org-1' })],
      rates,
      owners,
      'pays',
    );

    expect(attributed.map((entry) => entry.key)).toEqual([userKey('carol')]);
  });

  it('splits workspace storage equally among the workspace owners under the pays lens', () => {
    const attributed = attributeLedger(
      [row({ resource: 'postgres_bytes', userId: 'carol', organizationId: 'org-1' })],
      rates,
      owners,
      'pays',
    );

    expect(attributed.map((entry) => entry.key)).toEqual([userKey('alice'), userKey('bob')]);
    expect(attributed.map((entry) => entry.costMicros)).toEqual([500_000, 500_000]);
    expect(attributed.map((entry) => entry.quantity)).toEqual([500_000, 500_000]);
  });

  it('keeps an ownerless workspace and an unowned row visible under the pays lens', () => {
    const attributed = attributeLedger(
      [
        row({ resource: 'postgres_bytes', organizationId: 'org-orphan' }),
        row({ resource: 'postgres_bytes' }),
        row({ resource: 'postgres_bytes', userId: 'dana' }),
      ],
      rates,
      owners,
      'pays',
    );

    expect(attributed.map((entry) => entry.key)).toEqual([
      workspaceKey('org-orphan'),
      UNATTRIBUTED_KEY,
      userKey('dana'),
    ]);
  });

  it('prices nothing it has no rate for, and says so', () => {
    const attributed = attributeLedger(
      [row({ resource: 'object_bytes', userId: 'carol' })],
      rates,
      owners,
      'caused',
    );

    expect(assertDefined(attributed[0]).costMicros).toBeNull();
    const totals = totalByHolder(attributed);
    expect(assertDefined(totals[0]).costMicros).toBe(0);
    expect(assertDefined(totals[0]).hasUnpriced).toBe(true);
  });

  it('assigns the same total cost under both lenses', () => {
    const rows = [
      row({ resource: 'ai_input_tokens', userId: 'carol', organizationId: 'org-1' }),
      row({ resource: 'postgres_bytes', userId: 'carol', organizationId: 'org-1' }),
      row({ resource: 'postgres_bytes', organizationId: 'org-orphan' }),
      row({ resource: 'postgres_bytes' }),
    ];
    const sum = (lens: 'caused' | 'pays'): number =>
      totalByHolder(attributeLedger(rows, rates, owners, lens)).reduce(
        (total, holder) => total + holder.costMicros,
        0,
      );

    expect(sum('pays')).toBe(sum('caused'));
  });
});

describe('totalByHolder', () => {
  it('ranks holders by priced cost and names each one’s largest resource', () => {
    const rates = [
      rate({ resource: 'ai_input_tokens', microsPerMillionUnits: 1_000_000 }),
      rate({ resource: 'postgres_bytes', microsPerMillionUnits: 5_000_000 }),
    ];
    const attributed = attributeLedger(
      [
        row({ resource: 'ai_input_tokens', userId: 'small', quantity: 1_000_000 }),
        row({ resource: 'ai_input_tokens', userId: 'big', quantity: 1_000_000 }),
        row({ resource: 'postgres_bytes', userId: 'big', quantity: 1_000_000 }),
      ],
      rates,
      new Map(),
      'caused',
    );

    const totals = totalByHolder(attributed);

    expect(totals.map((holder) => holder.key)).toEqual([userKey('big'), userKey('small')]);
    expect(assertDefined(totals[0]).costMicros).toBe(6_000_000);
    expect(assertDefined(totals[0]).topResource).toBe('postgres_bytes');
  });

  it('carries unmeasured events without turning them into cost', () => {
    const totals = totalByHolder(
      attributeLedger(
        [row({ resource: 'ai_input_tokens', userId: 'carol', quantity: 0, unmeasuredEvents: 4 })],
        [rate({ resource: 'ai_input_tokens' })],
        new Map(),
        'caused',
      ),
    );

    expect(assertDefined(totals[0]).unmeasuredEvents).toBe(4);
    expect(assertDefined(totals[0]).costMicros).toBe(0);
    expect(assertDefined(totals[0]).hasUnpriced).toBe(false);
  });
});

describe('storage splitting', () => {
  it('divides a table’s size among owners in proportion to their row bytes', () => {
    const split = splitByRowBytes(1_000, [{ bytes: 75 }, { bytes: 25 }]);

    expect(split.map((owner) => owner.attributed)).toEqual([750, 250]);
  });

  it('attributes nothing when no row bytes were measured', () => {
    expect(splitByRowBytes(1_000, [])).toEqual([]);
    expect(splitByRowBytes(1_000, [{ bytes: 0 }])).toEqual([]);
  });

  it('scans a small table in full and samples a large one', () => {
    expect(samplePercent(10_000)).toBe(100);
    expect(samplePercent(1_000_000)).toBe(100);
    expect(samplePercent(10_000_000)).toBe(10);
    expect(samplePercent(5_000_000_000)).toBe(1);
  });
});

describe('merging token sources', () => {
  it('combines matching owners and models while preserving missing measurements', () => {
    const base = {
      day: '2026-10-26',
      userId: 'person',
      organizationId: 'workspace',
      resource: 'ai_input_tokens' as const,
      dimension: 'lattice:model',
    };
    expect(
      mergeTokenRows([
        { ...base, quantity: 120, unmeasuredEvents: 0 },
        { ...base, quantity: 5, unmeasuredEvents: 1 },
        { ...base, dimension: 'model', quantity: 40, unmeasuredEvents: 0 },
      ]),
    ).toEqual([
      { ...base, quantity: 125, unmeasuredEvents: 1 },
      { ...base, dimension: 'model', quantity: 40, unmeasuredEvents: 0 },
    ]);
  });
});
