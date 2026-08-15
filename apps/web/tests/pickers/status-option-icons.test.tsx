import '@testing-library/jest-dom/vitest';

import type { WorkStatusCategory } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { CYCLE_STATUS, CYCLE_STATUS_ORDER } from '@/components/cycles/cycle-status';
import { CYCLE_STATUS_OPTIONS, statusOptions } from '@/components/pickers/options';
import type { StatusLike } from '@/components/statuses/status-registry';

/** Read the `type` prop off a `<StatusIcon type={…} />` element without rendering it. */
function glyphType(icon: unknown): unknown {
  return (icon as { props?: { type?: unknown } }).props?.type;
}

/** A workspace status, named however this workspace chose to name it. */
function status(
  key: string,
  name: string,
  category: WorkStatusCategory,
  description = '',
): StatusLike {
  return {
    id: '' as StatusLike['id'],
    key,
    name,
    description,
    category,
    position: 0,
    isDefault: false,
  };
}

/**
 * Every status picker row carries the same glyph its list row renders, and that glyph comes from
 * the status's *category* rather than from its key.
 *
 * @remarks
 * The pickers used to map four fixed keys per entity onto a glyph. A workspace that renamed a
 * stage got a picker row with the wrong glyph and, for Initiatives, no glyph at all. These lock in
 * the replacement: the option order, label, and glyph are all read straight off the set, so a
 * workspace calling its in-progress stage "Building" gets the in-progress glyph beside it.
 */
describe('status picker options', () => {
  const set: readonly StatusLike[] = [
    status('planned', 'Queued', 'backlog', 'Captured, waiting to be picked up.'),
    status('building', 'Building', 'started'),
    status('shipped', 'Shipped', 'completed'),
  ];

  it('offers one option per status, in the order the set arrives', () => {
    expect(statusOptions(set).map((option) => option.value)).toEqual([
      'planned',
      'building',
      'shipped',
    ]);
  });

  it('labels each option with the name the workspace chose', () => {
    expect(statusOptions(set).map((option) => option.label)).toEqual([
      'Queued',
      'Building',
      'Shipped',
    ]);
  });

  it('draws each option glyph from the status category, whatever the key is called', () => {
    for (const option of statusOptions(set)) {
      const source = set.find((candidate) => candidate.key === option.value);
      expect(option.icon, option.label).toBeTruthy();
      expect(glyphType(option.icon), option.label).toBe(source?.category);
    }
  });

  it('carries a status description as the supporting line, and omits it when there is none', () => {
    const [queued, building] = statusOptions(set);
    expect(queued?.supporting).toBe('Captured, waiting to be picked up.');
    expect(building?.supporting).toBeUndefined();
  });

  it('gives every cycle status option the glyph a cycle row renders', () => {
    for (const option of CYCLE_STATUS_OPTIONS) {
      expect(option.icon, option.label).toBeTruthy();
      expect(glyphType(option.icon), option.label).toBe(CYCLE_STATUS[option.value].category);
    }
  });

  it('offers every declared cycle status', () => {
    expect([...CYCLE_STATUS_OPTIONS].map((option) => option.value).sort()).toEqual(
      [...CYCLE_STATUS_ORDER].map((cycleStatus) => cycleStatus.key).sort(),
    );
  });
});
