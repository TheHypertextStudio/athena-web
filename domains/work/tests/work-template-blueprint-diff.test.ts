import { present } from './blueprint-fixtures';
import { describe, expect, it } from 'vitest';
import { diffBlueprint } from '../src/blueprints/diff';
import { input, existing } from './blueprint-fixtures';
import { planBlueprint } from '../src/blueprints/rules';
import { graph, publication, resolution, step } from './blueprint-fixtures';

describe('explicit selective blueprint differences', () => {
  it('never matches hand-added equal names and gives additions stable opaque IDs', () => {
    const selected = input();
    const current = existing().map((node, i) =>
      i === 1 ? { ...node, sourceStepId: null, sourceWorkTypeId: null } : node,
    );
    const first = diffBlueprint({ mode: 'update', selected, current, currentDependencies: [] });
    expect(first.map((change) => change.kind)).toEqual(['add_child']);
    expect(first[0]?.changeId).toMatch(/^bp_/);
    expect(
      diffBlueprint({
        mode: 'update',
        selected,
        current: [...current].reverse(),
        currentDependencies: [],
      }),
    ).toEqual(first);
  });
  it('offers derived fields independently without replacing title, body or manual dates', () => {
    const selected = input();
    const current = existing();
    const child = present(current[1]);
    const edited = {
      ...child,
      fields: { title: 'Edited', description: '## Authored' },
      dates: { startDate: null, dueDate: '2026-09-16' },
      dateBindings: {
        startDate: { ...present(child.dateBindings.dueDate), manual: true, lastDerivedDate: null },
        dueDate: child.dateBindings.dueDate,
      },
    };
    const changes = diffBlueprint({
      mode: 'update',
      selected,
      current: [present(current[0]), edited],
      currentDependencies: [],
    });
    expect(changes.map((change) => change.kind)).toEqual(['set_derived_date']);
    expect(changes[0]).toMatchObject({ field: 'dueDate', selectedByDefault: false });
  });
  it('retains removed ever-started and terminal work and only offers safe cancellation unchecked', () => {
    const base = publication(9, 'task');
    const selected = input({ graph: graph(publication(2, 'project'), [base], []) });
    const current = existing();
    expect(
      diffBlueprint({ mode: 'update', selected, current, currentDependencies: [] }),
    ).toMatchObject([{ kind: 'cancel_removed_child', selectedByDefault: false }]);
    for (const edit of [
      { everStarted: true },
      { state: 'completed' as const },
      { state: 'canceled' as const },
      { cancellable: false },
    ])
      expect(
        diffBlueprint({
          mode: 'update',
          selected,
          current: [present(current[0]), { ...present(current[1]), ...edit }],
          currentDependencies: [],
        }),
      ).toEqual([]);
  });
  it('offers only service-owned edge removal and respects identity-only terminal roots', () => {
    const selected = input();
    const edge = { blockerPath: ['child'], blockedPath: ['other'], serviceOwned: false };
    expect(
      diffBlueprint({ mode: 'update', selected, current: existing(), currentDependencies: [edge] }),
    ).toEqual([]);
    expect(
      diffBlueprint({
        mode: 'change',
        selected: { ...selected, root: { ...selected.root, terminal: true } },
        current: existing(),
        currentDependencies: [],
      }),
    ).toEqual([]);
    expect(() =>
      diffBlueprint({
        mode: 'update',
        selected: { ...selected, root: { ...selected.root, terminal: true } },
        current: existing(),
        currentDependencies: [],
      }),
    ).toThrow(/terminal/i);
  });
  it('does not offer current authored outline replacement while using child override outlines once', () => {
    const base = publication(9, 'task');
    base.definition.payload = { targetType: 'task', description: '## Template heading' };
    const root = publication(2, 'project', [
      step('child', 'task', {
        template: { workTypeId: base.workTypeId, selection: { kind: 'latest' } },
        fields: { title: 'Authored title', description: '## Step heading' },
      }),
    ]);
    const selected = input({ graph: graph(root, [base], [resolution(['child'], base)]) });
    expect(planBlueprint(selected).nodes[1]?.fields.description).toBe(
      '## Template heading\n\n## Step heading',
    );
  });
});

it('shows new optional work unchecked rather than hiding it from the update preview', () => {
  const base = publication(9, 'task');
  const root = publication(2, 'project', [
    step('optional', 'task', { optional: { enabled: true, selectedByDefault: false } }),
  ]);
  const selected = input({ graph: graph(root, [base], [resolution(['optional'], base)]) });
  expect(
    diffBlueprint({
      mode: 'update',
      selected,
      current: [present(existing()[0])],
      currentDependencies: [],
    }),
  ).toMatchObject([{ kind: 'add_child', selectedByDefault: false, count: 1 }]);
});

it('does not replace existing date bindings during Change template', () => {
  const current = existing();
  const selected = input();
  const changed = { ...present(current[1]), dates: { dueDate: '2026-09-16' } };
  expect(
    diffBlueprint({
      mode: 'change',
      selected,
      current: [present(current[0]), changed],
      currentDependencies: [],
    }),
  ).toEqual([]);
});

it('does not offer new descendants below an existing terminal child', () => {
  const base = publication(9, 'task');
  const root = publication(2, 'project', [
    step('child'),
    step('nested', 'task', { parentStepKey: 'child' }),
  ]);
  const selected = input({
    graph: graph(
      root,
      [base],
      ['child', 'nested'].map((key) => resolution([key], base)),
    ),
  });
  const current = existing().map((row, i) =>
    i === 1 ? { ...row, state: 'completed' as const, everStarted: true } : row,
  );
  expect(
    diffBlueprint({ mode: 'update', selected, current, currentDependencies: [] }).some(
      (change) => change.kind === 'add_child',
    ),
  ).toBe(false);
});

it('never coalesces shared nested template work across a root template change', () => {
  const base = publication(9, 'task');
  const nested = publication(3, 'task', [step('quote')]);
  const reference = { workTypeId: nested.workTypeId, selection: { kind: 'latest' } };
  const old = publication(2, 'project', [step('vendor', 'task', { template: reference })]);
  const next = publication(4, 'project', [step('vendor', 'task', { template: reference })]);
  const oldPlan = planBlueprint(
    input({
      graph: graph(
        old,
        [nested, base],
        [resolution(['vendor'], nested), resolution(['vendor', 'quote'], base)],
      ),
    }),
  );
  const current = existing(oldPlan).map((row, i) => ({
    ...row,
    sourceWorkTypeId: oldPlan.nodes[i]?.sourceWorkTypeId ?? null,
  }));
  const selected = input({
    graph: graph(
      next,
      [nested, base],
      [resolution(['vendor'], nested), resolution(['vendor', 'quote'], base)],
    ),
  });
  expect(
    diffBlueprint({ mode: 'change', selected, current, currentDependencies: [] }),
  ).toMatchObject([{ kind: 'add_child', count: 2 }]);
});

it('does not cancel a removed parent whose descendant has ever started', () => {
  const base = publication(9, 'task');
  const root = publication(2, 'project', [
    step('child'),
    step('nested', 'task', { parentStepKey: 'child' }),
  ]);
  const old = input({
    graph: graph(
      root,
      [base],
      ['child', 'nested'].map((key) => resolution([key], base)),
    ),
  });
  const current = existing(planBlueprint(old)).map((row, i) =>
    i === 2 ? { ...row, state: 'started' as const, everStarted: true } : row,
  );
  const selected = input({ graph: graph(publication(2, 'project'), [base], []) });
  expect(
    diffBlueprint({ mode: 'update', selected, current, currentDependencies: [] }).some(
      (change) => change.kind === 'cancel_removed_child' && change.id === 'existing-1',
    ),
  ).toBe(false);
});

it('refuses previews whose combined existing and new work exceed 500 nodes', () => {
  const nodes = existing();
  const current = [
    present(nodes[0]),
    ...Array.from({ length: 499 }, (_, i) => ({
      ...present(nodes[1]),
      id: `manual-${i}`,
      path: [`m${i}`],
      sourceStepId: null,
      sourceWorkTypeId: null,
    })),
  ];
  expect(() =>
    diffBlueprint({ mode: 'update', selected: input(), current, currentDependencies: [] }),
  ).toThrow(/500|limit/i);
});
