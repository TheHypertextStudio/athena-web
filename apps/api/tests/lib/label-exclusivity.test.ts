/**
 * `@docket/api` — group-exclusivity collapse.
 *
 * @remarks
 * `applyExclusivity` is the whole reason `label_group` exists as a table rather than a text
 * column, and it is the one piece of label logic every write path shares — the REST routes, the
 * automation engine, MCP, and the Linear reconciler. Its rule (last occurrence wins) is what
 * lets one function serve both "replace the whole set" and "add one label" without either
 * caller special-casing the other.
 */
import { describe, expect, it } from 'vitest';

import { applyExclusivity, type ResolvedLabel } from '../../src/lib/labels';

/** Build a resolved label; `exclusiveGroup` null means ungrouped or a visual-only cluster. */
function mk(id: string, exclusiveGroup: string | null = null): ResolvedLabel {
  return { id, name: id, groupId: exclusiveGroup, exclusiveGroupId: exclusiveGroup };
}

describe('applyExclusivity', () => {
  it('leaves ungrouped labels entirely alone', () => {
    const set = [mk('bug'), mk('design'), mk('urgent')];
    expect(applyExclusivity(set).map((l) => l.id)).toEqual(['bug', 'design', 'urgent']);
  });

  it('keeps the last member when two labels share an exclusive group', () => {
    // The picker case: `Type: Feature` was already on, the user just clicked `Type: Bug`.
    const set = [mk('feature', 'type'), mk('bug', 'type')];
    expect(applyExclusivity(set).map((l) => l.id)).toEqual(['bug']);
  });

  it('collapses independently per group', () => {
    const set = [
      mk('feature', 'type'),
      mk('discovery', 'stage'),
      mk('bug', 'type'),
      mk('launch', 'stage'),
    ];
    expect(applyExclusivity(set).map((l) => l.id)).toEqual(['bug', 'launch']);
  });

  it('preserves caller order among the survivors', () => {
    // `bug` survives its group but must not jump ahead of the ungrouped labels around it.
    const set = [mk('urgent'), mk('feature', 'type'), mk('bug', 'type'), mk('design')];
    expect(applyExclusivity(set).map((l) => l.id)).toEqual(['urgent', 'bug', 'design']);
  });

  it('does not constrain a non-exclusive group', () => {
    // A visual cluster resolves to a null exclusiveGroupId, so its members never collide.
    const set = [mk('frontend'), mk('backend')];
    expect(applyExclusivity(set)).toHaveLength(2);
  });

  it('is idempotent — collapsing an already-collapsed set changes nothing', () => {
    const once = applyExclusivity([mk('feature', 'type'), mk('bug', 'type'), mk('design')]);
    expect(applyExclusivity(once)).toEqual(once);
  });

  it('handles the empty set', () => {
    expect(applyExclusivity([])).toEqual([]);
  });

  it('resolves a three-way collision down to the last one asked for', () => {
    const set = [mk('p0', 'priority'), mk('p1', 'priority'), mk('p2', 'priority')];
    expect(applyExclusivity(set).map((l) => l.id)).toEqual(['p2']);
  });

  it('gives the incoming label the win, which is what makes attach swap rather than stack', () => {
    // `attachLabels` composes [...existing, ...incoming] and delegates here; this is the
    // property that makes an automation's `task.applyLabel` behave like a human's click.
    const existing = [mk('feature', 'type'), mk('urgent')];
    const incoming = [mk('bug', 'type')];
    const result = applyExclusivity([...existing, ...incoming]);
    expect(result.map((l) => l.id)).toEqual(['urgent', 'bug']);
  });
});
