/**
 * Unit tests for the work-status DTOs, the category taxonomy, and the seeded default sets.
 *
 * @remarks
 * The seed assertions are invariants rather than snapshots: a workspace may rename anything,
 * so what matters is that every seeded set can satisfy the rules the API enforces and the
 * app assumes (one default, a completed status, a canceled status, unique keys).
 */
import { describe, expect, it } from 'vitest';

import {
  compareWorkStatusOrder,
  DEFAULT_WORK_STATUSES,
  isTerminalCategory,
  TERMINAL_CATEGORIES,
  WORK_STATUS_CATEGORIES,
  WORK_STATUS_CATEGORY_RANK,
  WORK_STATUS_ENTITY_TYPES,
  WorkStatusCategory,
  WorkStatusCreate,
  WorkStatusReorder,
  WorkStatusUpdate,
  type WorkStatusEntityType,
  type WorkStatusSeed,
} from '../../src/contracts/work-status';
import { DEFAULT_WORKFLOW_STATES } from '@docket/work/workflow';

describe('WorkStatusCategory', () => {
  it('accepts every canonical category', () => {
    for (const category of WORK_STATUS_CATEGORIES) {
      expect(WorkStatusCategory.safeParse(category).success).toBe(true);
    }
  });

  it('refuses a category the taxonomy does not define', () => {
    expect(WorkStatusCategory.safeParse('paused').success).toBe(false);
  });

  it('ranks every category, with no two sharing a rank', () => {
    const ranks = WORK_STATUS_CATEGORIES.map((c) => WORK_STATUS_CATEGORY_RANK[c]);
    expect(ranks).toHaveLength(WORK_STATUS_CATEGORIES.length);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('ranks categories in the declared order, so the array index is the rank', () => {
    WORK_STATUS_CATEGORIES.forEach((category, index) => {
      expect(WORK_STATUS_CATEGORY_RANK[category]).toBe(index);
    });
  });
});

describe('isTerminalCategory', () => {
  it('treats exactly the terminal categories as terminal', () => {
    for (const category of WORK_STATUS_CATEGORIES) {
      expect(isTerminalCategory(category)).toBe(
        (TERMINAL_CATEGORIES as readonly string[]).includes(category),
      );
    }
  });
});

describe('compareWorkStatusOrder', () => {
  it('orders by category rank when the categories differ', () => {
    expect(
      compareWorkStatusOrder(
        { category: 'started', position: 99 },
        { category: 'completed', position: 0 },
      ),
    ).toBeLessThan(0);
  });

  it('falls back to position when the categories match', () => {
    expect(
      compareWorkStatusOrder(
        { category: 'started', position: 3 },
        { category: 'started', position: 1 },
      ),
    ).toBeGreaterThan(0);
  });

  it('reports two statuses in the same slot as equal', () => {
    expect(
      compareWorkStatusOrder(
        { category: 'backlog', position: 0 },
        { category: 'backlog', position: 0 },
      ),
    ).toBe(0);
  });
});

describe('WorkStatusCreate', () => {
  const valid = { entityType: 'task', name: 'In Review', category: 'started' };

  it('accepts a minimal status', () => {
    expect(WorkStatusCreate.safeParse(valid).success).toBe(true);
  });

  it('refuses a name that is blank once trimmed', () => {
    expect(WorkStatusCreate.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });

  it('refuses a negative position', () => {
    expect(WorkStatusCreate.safeParse({ ...valid, position: -1 }).success).toBe(false);
  });

  it('refuses a kind of work that carries no status set', () => {
    expect(WorkStatusCreate.safeParse({ ...valid, entityType: 'cycle' }).success).toBe(false);
  });
});

describe('WorkStatusUpdate', () => {
  it('accepts a rename on its own', () => {
    expect(WorkStatusUpdate.safeParse({ name: 'Shipped' }).success).toBe(true);
  });

  it('accepts clearing the description', () => {
    expect(WorkStatusUpdate.safeParse({ description: null }).success).toBe(true);
  });

  it('refuses a blank rename', () => {
    expect(WorkStatusUpdate.safeParse({ name: ' ' }).success).toBe(false);
  });

  it('carries no key, so a rename cannot break stored references', () => {
    const parsed = WorkStatusUpdate.parse({ name: 'Shipped', key: 'shipped' });
    expect(parsed).not.toHaveProperty('key');
  });

  it('refuses unsetting the default, which would leave a set with none', () => {
    expect(WorkStatusUpdate.safeParse({ isDefault: false }).success).toBe(false);
  });
});

describe('WorkStatusReorder', () => {
  const first = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  const second = '01ARZ3NDEKTSV4RRFFQ69G5FAW';

  it('accepts a non-empty order', () => {
    expect(
      WorkStatusReorder.safeParse({ entityType: 'project', order: [first, second] }).success,
    ).toBe(true);
  });

  it('refuses an empty order', () => {
    expect(WorkStatusReorder.safeParse({ entityType: 'project', order: [] }).success).toBe(false);
  });

  it('refuses an order carrying something that is not a status id', () => {
    expect(
      WorkStatusReorder.safeParse({ entityType: 'project', order: ['in_review'] }).success,
    ).toBe(false);
  });
});

describe('DEFAULT_WORK_STATUSES', () => {
  const entries = Object.entries(DEFAULT_WORK_STATUSES) as [
    WorkStatusEntityType,
    readonly WorkStatusSeed[],
  ][];

  it('seeds a set for every kind of work that carries one', () => {
    expect(Object.keys(DEFAULT_WORK_STATUSES).sort()).toEqual([...WORK_STATUS_ENTITY_TYPES].sort());
  });

  it.each(entries)('%s seeds exactly one default status', (_entity, seeds) => {
    expect(seeds.filter((s) => s.isDefault)).toHaveLength(1);
  });

  it.each(entries)('%s seeds unique keys', (_entity, seeds) => {
    expect(new Set(seeds.map((s) => s.key)).size).toBe(seeds.length);
  });

  it.each(entries)('%s seeds a way to finish and a way to abandon', (_entity, seeds) => {
    expect(seeds.some((s) => s.category === 'completed')).toBe(true);
    expect(seeds.some((s) => s.category === 'canceled')).toBe(true);
  });

  it.each(entries)('%s seeds a status that is not terminal', (_entity, seeds) => {
    expect(seeds.some((s) => !isTerminalCategory(s.category))).toBe(true);
  });

  it.each(entries)('%s starts new work somewhere non-terminal', (_entity, seeds) => {
    expect(seeds.filter((s) => s.isDefault && !isTerminalCategory(s.category))).toHaveLength(1);
  });

  it.each(entries)('%s numbers positions contiguously within each category', (_entity, seeds) => {
    for (const category of WORK_STATUS_CATEGORIES) {
      const positions = seeds
        .filter((s) => s.category === category)
        .map((s) => s.position)
        .sort((a, b) => a - b);
      expect(positions).toEqual(positions.map((_value, index) => index));
    }
  });

  it('lets a Program reach an end, which its status enum previously forbade', () => {
    expect(DEFAULT_WORK_STATUSES.program.some((s) => s.category === 'completed')).toBe(true);
  });

  it('keeps a Program status for retirement that is distinct from completion', () => {
    const retired = DEFAULT_WORK_STATUSES.program.find((s) => s.category === 'canceled');
    const finished = DEFAULT_WORK_STATUSES.program.find((s) => s.category === 'completed');
    expect(retired?.key).toBeDefined();
    expect(retired?.key).not.toBe(finished?.key);
  });
});

describe('DEFAULT_WORKFLOW_STATES', () => {
  it('flattens the seeded Task set without losing or inventing a status', () => {
    expect(DEFAULT_WORKFLOW_STATES.map((s) => s.key)).toEqual(
      [...DEFAULT_WORK_STATUSES.task].sort(compareWorkStatusOrder).map((s) => s.key),
    );
  });

  it('numbers positions contiguously from zero', () => {
    expect(DEFAULT_WORKFLOW_STATES.map((s) => s.position)).toEqual(
      DEFAULT_WORKFLOW_STATES.map((_state, index) => index),
    );
  });

  it('lands new tasks in the seeded default, which is the first state', () => {
    const seededDefault = DEFAULT_WORK_STATUSES.task.find((s) => s.isDefault);
    expect(DEFAULT_WORKFLOW_STATES[0]?.key).toBe(seededDefault?.key);
  });

  it('carries the seed category through as the state type', () => {
    for (const state of DEFAULT_WORKFLOW_STATES) {
      const seed = DEFAULT_WORK_STATUSES.task.find((s) => s.key === state.key);
      expect(state.type).toBe(seed?.category);
    }
  });
});
