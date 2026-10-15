import { present } from './blueprint-fixtures';
import { describe, expect, it } from 'vitest';
import { captureBlueprint } from '../src/blueprints/capture';
import {
  context,
  existing,
  graph,
  input,
  publication,
  resolution,
  step,
} from './blueprint-fixtures';
import { planBlueprint } from '../src/blueprints/rules';

describe('independent inline capture', () => {
  it('normalizes cleared concrete fields without publishing invalid reusable nulls', () => {
    const nodes = existing();
    const root = { ...present(nodes[0]), fields: { name: 'Root', health: null, summary: null } };
    const child = {
      ...present(nodes[1]),
      fields: { title: 'Child', summary: null, estimateMinutes: null },
    };
    const captured = captureBlueprint({
      name: 'Cleared copy',
      root,
      nodes: [child],
      dependencies: [],
      context: context(),
      complete: true,
    });
    expect(captured.definition.payload).toEqual({
      targetType: 'project',
      name: 'Root',
      summary: '',
    });
    expect(captured.definition.blueprint.steps[0]?.fields).toEqual({
      title: 'Child',
      summary: '',
      estimateMinutes: null,
    });
    expect(root.fields).toEqual({ name: 'Root', health: null, summary: null });
  });
  it('captures edited and manual work as inline snapshots without literal source references', () => {
    const nodes = existing();
    const child = {
      ...present(nodes[1]),
      fields: { title: 'Edited current title', description: '## Keep this heading' },
      sourceStepId: null,
      dates: { dueDate: '2026-10-08' },
    };
    const source = {
      name: 'Independent copy',
      root: present(nodes[0]),
      nodes: [child],
      dependencies: [],
      context: context(),
      complete: true,
    };
    const before = JSON.stringify(source);
    const captured = captureBlueprint(source);
    expect(captured.definition.blueprint.steps[0]).toMatchObject({
      template: null,
      fields: child.fields,
      dates: {
        dueDate: {
          kind: 'anchor',
          anchor: { kind: 'parent' },
          offset: { days: 0, unit: 'calendar' },
        },
      },
    });
    expect(JSON.stringify(captured.definition)).not.toContain('existing-');
    expect(JSON.stringify(source)).toBe(before);
    expect(captured.origin).toEqual({
      workTypeId: present(nodes[0]).workTypeId,
      workTypeVersionId: present(nodes[0]).workTypeVersionId,
    });
  });
  it('warns instead of retaining absolute dates when the parent has no anchor', () => {
    const nodes = existing();
    const captured = captureBlueprint({
      name: 'No anchor',
      root: { ...present(nodes[0]), dates: {} },
      nodes: [present(nodes[1])],
      dependencies: [],
      context: context(),
      complete: true,
    });
    expect(captured.definition.blueprint.steps[0]?.dates).toEqual({});
    expect(captured.warnings.some((warning) => warning.code === 'missing_anchor')).toBe(true);
    expect(JSON.stringify(captured.definition)).not.toContain('2026-');
  });
  it('retains only captured sibling Task dependencies and refuses incomplete or oversized captures', () => {
    const base = publication(9, 'task');
    const root = publication(2, 'project', [
      step('a'),
      step('b'),
      step('nested', 'task', { parentStepKey: 'a' }),
    ]);
    const tree = planBlueprint(
      input({
        graph: graph(
          root,
          [base],
          ['a', 'b', 'nested'].map((key) => resolution([key], base)),
        ),
      }),
    );
    const nodes = existing(tree);
    const source = {
      name: 'Edges',
      root: present(nodes[0]),
      nodes: nodes.slice(1),
      dependencies: [
        { blockerPath: ['a'], blockedPath: ['b'] },
        { blockerPath: ['a'], blockedPath: ['nested'] },
        { blockerPath: ['a'], blockedPath: ['outside'] },
      ],
      context: context(),
      complete: true,
    };
    const captured = captureBlueprint(source);
    expect(captured.definition.blueprint.dependencies).toHaveLength(1);
    expect(captured.warnings.some((warning) => warning.code === 'capture_dependency')).toBe(true);
    expect(() => captureBlueprint({ ...source, complete: false })).toThrow(/incomplete/i);
    expect(() =>
      captureBlueprint({
        ...source,
        nodes: Array.from({ length: 500 }, (_, i) => ({
          ...present(nodes[1]),
          id: `child-${i}`,
          path: [`c${i}`],
        })),
      }),
    ).toThrow(/499|limit/i);
  });
});

it('refuses a source containment cycle rather than publishing a disconnected capture', () => {
  const nodes = existing();
  const a = { ...present(nodes[1]), id: 'a', path: ['a'], parentPath: ['b'] };
  const b = { ...present(nodes[1]), id: 'b', path: ['b'], parentPath: ['a'] };
  expect(() =>
    captureBlueprint({
      name: 'Cycle',
      root: present(nodes[0]),
      nodes: [a, b],
      dependencies: [],
      context: context(),
      complete: true,
    }),
  ).toThrow(/cycle|incomplete/i);
});

it('captures concrete old and new origin families independently even when logical paths repeat', () => {
  const nodes = existing();
  const root = present(nodes[0]);
  const a = {
    ...present(nodes[1]),
    id: 'a',
    parentId: root.id,
    path: ['same'],
    fields: { title: 'Old current task' },
  };
  const b = { ...a, id: 'b', fields: { title: 'New current task' } };
  const captured = captureBlueprint({
    name: 'Both families',
    root,
    nodes: [a, b],
    dependencies: [{ blockerId: 'a', blockedId: 'b' }],
    context: context(),
    complete: true,
  });
  expect(captured.definition.blueprint.steps.map((step) => step.fields)).toEqual([
    a.fields,
    b.fields,
  ]);
  expect(captured.definition.blueprint.dependencies).toEqual([
    { blockerStepKey: 'step_1', blockedStepKey: 'step_2' },
  ]);
});
