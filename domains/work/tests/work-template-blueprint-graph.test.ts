import { describe, expect, it } from 'vitest';
import { WorkTypeVersionId } from '../src/ids';
import { expandBlueprint } from '../src/blueprints/expand';
import { validateBlueprintGraph } from '../src/blueprints/graph';

import { ulid, step, publication, graph, resolution } from './blueprint-fixtures';

describe('bounded qualified blueprint expansion', () => {
  it('accepts kind matched descendants and milestones only under projects', () => {
    const base = publication(9, 'task');
    const root = publication(2, 'project', [
      step('checkpoint', 'milestone'),
      step('task', 'task', { parentStepKey: 'checkpoint' }),
    ]);
    const input = graph(root, [base], [resolution(['task'], base)]);
    expect(expandBlueprint(input, []).nodes.map((node) => node.path)).toEqual([
      [],
      ['checkpoint'],
      ['task'],
    ]);
    expect(() => {
      validateBlueprintGraph(graph(publication(2, 'program', [step('bad', 'milestone')]), [], []));
    }).toThrow(/hierarchy/i);
    expect(() => {
      validateBlueprintGraph(
        graph(root, [publication(9, 'program')], [resolution(['task'], publication(9, 'program'))]),
      );
    }).toThrow(/kind/i);
  });
  it('qualifies repeated template keys without collisions', () => {
    const base = publication(9, 'task');
    const child = publication(3, 'task', [step('quote')]);
    const ref = { workTypeId: child.workTypeId, selection: { kind: 'latest' } };
    const root = publication(2, 'project', [
      step('vendor_a', 'task', { template: ref }),
      step('vendor_b', 'task', { template: ref }),
    ]);
    const input = graph(
      root,
      [child, base],
      [
        resolution(['vendor_a'], child),
        resolution(['vendor_b'], child),
        resolution(['vendor_a', 'quote'], base),
        resolution(['vendor_b', 'quote'], base),
      ],
    );
    expect(expandBlueprint(input, []).nodes.map((node) => node.path)).toContainEqual([
      'vendor_b',
      'quote',
    ]);
    expect(expandBlueprint(input, []).nodes).toHaveLength(5);
  });
  it('rejects a template identity loop across different versions', () => {
    const old = publication(2, 'task');
    const child = publication(3, 'task', [
      step('again', 'task', {
        template: {
          workTypeId: old.workTypeId,
          selection: { kind: 'pinned', workTypeVersionId: old.versionId },
        },
      }),
    ]);
    const root = {
      ...publication(2, 'task', [
        step('child', 'task', {
          template: { workTypeId: child.workTypeId, selection: { kind: 'latest' } },
        }),
      ]),
      versionId: WorkTypeVersionId.parse(ulid(500)),
    };
    expect(() =>
      expandBlueprint(
        graph(
          root,
          [child, old],
          [resolution(['child'], child), resolution(['child', 'again'], old)],
        ),
        [],
      ),
    ).toThrow(/loop/i);
  });
  it('rejects containment, dependency and date prerequisite cycles', () => {
    const base = publication(9, 'task');
    for (const steps of [
      [step('a', 'task', { parentStepKey: 'b' }), step('b', 'task', { parentStepKey: 'a' })],
      [
        step('a', 'task', {
          dates: {
            dueDate: {
              kind: 'after_completion',
              stepKeys: ['b'],
              offset: { days: 0, unit: 'calendar' },
            },
          },
        }),
        step('b', 'task', {
          dates: {
            dueDate: {
              kind: 'after_completion',
              stepKeys: ['a'],
              offset: { days: 0, unit: 'calendar' },
            },
          },
        }),
      ],
    ])
      expect(() => {
        validateBlueprintGraph(
          graph(
            publication(2, 'project', steps),
            [base],
            [resolution(['a'], base), resolution(['b'], base)],
          ),
        );
      }).toThrow(/loop|cycle/i);
    const root = publication(
      2,
      'project',
      [step('a'), step('b')],
      [
        { blockerStepKey: 'a', blockedStepKey: 'b' },
        { blockerStepKey: 'b', blockedStepKey: 'a' },
      ],
    );
    expect(() => {
      validateBlueprintGraph(
        graph(root, [base], [resolution(['a'], base), resolution(['b'], base)]),
      );
    }).toThrow(/cycle/i);
  });
  it('requires explicit optional prerequisite closure and refuses invalid choices', () => {
    const base = publication(9, 'task');
    const root = publication(
      2,
      'project',
      [step('a', 'task', { optional: { enabled: true, selectedByDefault: false } }), step('b')],
      [{ blockerStepKey: 'a', blockedStepKey: 'b' }],
    );
    const input = graph(root, [base], [resolution(['a'], base), resolution(['b'], base)]);
    expect(() => expandBlueprint(input, [])).toThrow(/prerequisite/i);
    expect(expandBlueprint(input, [{ path: ['a'], selected: true }]).nodes).toHaveLength(3);
    expect(() => expandBlueprint(input, [{ path: ['b'], selected: false }])).toThrow(/optional/i);
    expect(() => expandBlueprint(input, [{ path: ['missing'], selected: false }])).toThrow(
      /choice/i,
    );
  });
  it('counts root and milestones at 500 and rejects 501, validating optional worst case', () => {
    const base = publication(9, 'task');
    const many = Array.from({ length: 499 }, (_, index) => step(`m${index}`, 'milestone'));
    expect(expandBlueprint(graph(publication(2, 'project', many), [], []), []).nodes).toHaveLength(
      500,
    );
    const nested = publication(3, 'task', [step('extra')]);
    many[0] = step('nested', 'task', {
      template: { workTypeId: nested.workTypeId, selection: { kind: 'latest' } },
      optional: { enabled: true, selectedByDefault: false },
    });
    const input = graph(
      publication(2, 'project', many),
      [nested, base],
      [resolution(['nested'], nested), resolution(['nested', 'extra'], base)],
    );
    expect(() => {
      validateBlueprintGraph(input);
    }).toThrow(/500|limit/i);
  });
  it('does not expand an inline base blueprint but expands an explicit reference', () => {
    const base = publication(9, 'task', [step('child')]);
    const root = publication(2, 'project', [step('inline')]);
    expect(
      expandBlueprint(graph(root, [base], [resolution(['inline'], base)]), []).nodes,
    ).toHaveLength(2);
    const explicit = publication(2, 'project', [
      step('inline', 'task', {
        template: { workTypeId: base.workTypeId, selection: { kind: 'latest' } },
      }),
    ]);
    expect(
      expandBlueprint(
        graph(
          explicit,
          [base],
          [resolution(['inline'], base), resolution(['inline', 'child'], base)],
        ),
        [],
      ).nodes,
    ).toHaveLength(3);
  });
});

it('freezes latest references once per template while allowing intentional pinned versions', () => {
  const one = publication(9, 'task');
  const two = { ...one, versionId: WorkTypeVersionId.parse(ulid(600)) };
  const ref = { workTypeId: one.workTypeId, selection: { kind: 'latest' } };
  const root = publication(2, 'project', [
    step('a', 'task', { template: ref }),
    step('b', 'task', { template: ref }),
  ]);
  expect(() =>
    expandBlueprint(graph(root, [one, two], [resolution(['a'], one), resolution(['b'], two)]), []),
  ).toThrow(/latest/i);
});

it('bounds the combined containment, dependency and date graph at 2000 edges', () => {
  const base = publication(9, 'task');
  const steps = Array.from({ length: 100 }, (_, i) => step(`t${i}`));
  const dependencies = [];
  for (let i = 0; i < 100; i++)
    for (let j = i + 1; j < 100 && dependencies.length < 1950; j++)
      dependencies.push({ blockerStepKey: `t${i}`, blockedStepKey: `t${j}` });
  const root = publication(2, 'project', steps, dependencies);
  expect(() => {
    validateBlueprintGraph(
      graph(
        root,
        [base],
        steps.map((entry) => resolution([entry.key], base)),
      ),
    );
  }).toThrow(/2000|limit/i);
});

it('requires selecting an optional ancestor when explicitly selecting its optional child', () => {
  const base = publication(9, 'task');
  const optional = { enabled: true, selectedByDefault: false };
  const root = publication(2, 'project', [
    step('parent', 'task', { optional }),
    step('child', 'task', { parentStepKey: 'parent', optional }),
  ]);
  const selected = graph(
    root,
    [base],
    ['parent', 'child'].map((key) => resolution([key], base)),
  );
  expect(() => expandBlueprint(selected, [{ path: ['child'], selected: true }])).toThrow(
    /prerequisite/i,
  );
});

it('applies the creation edge cap to selected work while publication checks the optional worst case', () => {
  const base = publication(9, 'task');
  const steps = Array.from({ length: 100 }, (_, i) =>
    step(`t${i}`, 'task', { optional: { enabled: true, selectedByDefault: false } }),
  );
  const dependencies = [];
  for (let i = 0; i < 100; i++)
    for (let j = i + 1; j < 100 && dependencies.length < 1950; j++)
      dependencies.push({ blockerStepKey: `t${i}`, blockedStepKey: `t${j}` });
  const selected = graph(
    publication(2, 'project', steps, dependencies),
    [base],
    steps.map((entry) => resolution([entry.key], base)),
  );
  expect(expandBlueprint(selected, []).nodes.filter((node) => node.selected)).toHaveLength(1);
  expect(() => {
    validateBlueprintGraph(selected);
  }).toThrow(/2000|limit/i);
});
