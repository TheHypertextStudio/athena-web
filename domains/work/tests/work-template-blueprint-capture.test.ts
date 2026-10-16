import { ActorId, OrganizationId, TeamId } from '@docket/identity-access/ids';
import { CycleId } from '../src/ids';
import { actor, team, ulid, present } from './blueprint-fixtures';
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

describe('portable capture rules and authorized source boundaries', () => {
  const otherActor = ActorId.parse(ulid(71));
  const athena = ActorId.parse(ulid(72));
  const otherTeam = TeamId.parse(ulid(73));

  it.each([
    { responsible: null, parent: actor, expected: 'unassigned' },
    { responsible: actor, parent: otherActor, expected: 'creator' },
    { responsible: athena, parent: actor, expected: 'athena' },
    { responsible: otherActor, parent: actor, expected: 'unassigned' },
  ])(
    'captures responsibility as $expected rather than a literal actor',
    ({ responsible, parent, expected }) => {
      const nodes = existing();
      const captured = captureBlueprint({
        name: 'Portable responsibility',
        root: { ...present(nodes[0]), responsibleActorId: parent },
        nodes: [{ ...present(nodes[1]), responsibleActorId: responsible }],
        dependencies: [],
        context: context({ athenaActorId: athena }),
        complete: true,
      });
      expect(captured.definition.blueprint.steps[0]?.actorRule).toBe(expected);
      expect(captured.warnings.some((warning) => warning.code === 'capture_actor')).toBe(
        responsible === otherActor,
      );
      expect(JSON.stringify(captured.definition)).not.toContain(otherActor);
      expect(JSON.stringify(captured.definition)).not.toContain(athena);
    },
  );

  it.each([
    { childTeam: team, parentTeam: otherTeam, expected: 'creation_team', warning: false },
    { childTeam: otherTeam, parentTeam: team, expected: 'none', warning: true },
    { childTeam: null, parentTeam: team, expected: 'none', warning: false },
  ])(
    'captures team rule $expected without publishing a source team',
    ({ childTeam, parentTeam, expected, warning }) => {
      const nodes = existing();
      const captured = captureBlueprint({
        name: 'Portable team',
        root: { ...present(nodes[0]), teamId: parentTeam },
        nodes: [{ ...present(nodes[1]), teamId: childTeam }],
        dependencies: [],
        context: context(),
        complete: true,
      });
      expect(captured.definition.blueprint.steps[0]?.teamRule).toBe(expected);
      expect(captured.warnings.some((entry) => entry.code === 'capture_team')).toBe(warning);
      expect(JSON.stringify(captured.definition)).not.toContain(otherTeam);
    },
  );

  it('captures an inherited Task cycle without retaining its concrete cycle identity', () => {
    const nodes = existing();
    const cycleId = CycleId.parse(ulid(74));
    const root = {
      ...present(nodes[0]),
      kind: 'task' as const,
      fields: { title: 'Parent' },
      dates: { dueDate: '2026-10-08' },
      cycleId,
    };
    const captured = captureBlueprint({
      name: 'Nested Task',
      root,
      nodes: [{ ...present(nodes[1]), parentId: root.id, cycleId }],
      dependencies: [],
      context: context(),
      complete: true,
    });
    expect(captured.definition.blueprint.steps[0]).toMatchObject({
      parentStepKey: null,
      cycleRule: 'parent_cycle',
    });
    expect(JSON.stringify(captured.definition)).not.toContain(cycleId);
  });

  it('uses the frozen run day to capture a valid current cycle', () => {
    const nodes = existing();
    const cycle = {
      id: CycleId.parse(ulid(75)),
      organizationId: context().organizationId,
      teamId: team,
      startDate: '2026-10-14',
      endDate: '2026-10-16',
      archived: false,
      closed: false,
    };
    const captured = captureBlueprint({
      name: 'Current cycle',
      root: present(nodes[0]),
      nodes: [{ ...present(nodes[1]), cycleId: cycle.id }],
      dependencies: [],
      context: context({ runDate: '2026-10-15', cycles: [cycle] }),
      complete: true,
    });
    expect(captured.definition.blueprint.steps[0]).toMatchObject({
      kind: 'task',
      cycleRule: 'current_cycle',
    });
    expect(captured.warnings).toEqual([]);
  });

  it.each([
    { id: CycleId.parse(ulid(76)) },
    { organizationId: OrganizationId.parse(ulid(77)) },
    { teamId: otherTeam },
    { archived: true },
    { closed: true },
    { startDate: '2026-10-09' },
    { endDate: '2026-10-07' },
  ])('drops an unavailable cycle and provides a review warning: %j', (change) => {
    const nodes = existing();
    const cycle = {
      id: CycleId.parse(ulid(75)),
      organizationId: context().organizationId,
      teamId: team,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      archived: false,
      closed: false,
    };
    const captured = captureBlueprint({
      name: 'Unavailable cycle',
      root: present(nodes[0]),
      nodes: [{ ...present(nodes[1]), cycleId: cycle.id }],
      dependencies: [],
      context: context({ cycles: [{ ...cycle, ...change }] }),
      complete: true,
    });
    expect(captured.definition.blueprint.steps[0]).toMatchObject({
      kind: 'task',
      cycleRule: 'none',
    });
    expect(captured.warnings).toMatchObject([{ code: 'capture_cycle', count: 1 }]);
  });

  it('captures undated Project work below a Program and omits empty source dates', () => {
    const nodes = existing();
    const root = {
      ...present(nodes[0]),
      kind: 'program' as const,
      fields: { name: 'Program' },
      dates: {},
      workTypeId: null,
      workTypeVersionId: null,
    };
    const child = {
      ...present(nodes[1]),
      kind: 'project' as const,
      fields: { name: 'Project' },
      dates: { startDate: null, targetDate: '2026-10-10' },
    };
    const captured = captureBlueprint({
      name: 'Program copy',
      root,
      nodes: [root, child],
      dependencies: [],
      context: context(),
      complete: true,
    });
    expect(captured.origin).toBeNull();
    expect(captured.definition.blueprint.steps).toHaveLength(1);
    expect(captured.definition.blueprint.steps[0]).toMatchObject({
      kind: 'project',
      dates: {
        targetDate: {
          kind: 'anchor',
          anchor: { kind: 'parent' },
          offset: { days: 2, unit: 'calendar' },
        },
      },
    });
    expect(captured.definition.blueprint.steps[0]).not.toHaveProperty('cycleRule');
    expect(captured.definition.blueprint.steps[0]?.dates).not.toHaveProperty('startDate');
  });

  it('deduplicates sibling edges and warns for self and inaccessible dependency endpoints', () => {
    const nodes = existing();
    const root = present(nodes[0]);
    const a = { ...present(nodes[1]), id: 'a', path: ['a'], parentId: root.id };
    const b = { ...a, id: 'b', path: ['b'] };
    const captured = captureBlueprint({
      name: 'Dependency copy',
      root,
      nodes: [a, b],
      context: context(),
      complete: true,
      dependencies: [
        { blockerId: 'a', blockedId: 'b' },
        { blockerId: 'a', blockedId: 'b' },
        { blockerId: 'a', blockedId: 'a' },
        { blockerId: 'outside', blockedId: 'b' },
        { blockerId: 'outside', blockedId: 'elsewhere' },
      ],
    });
    expect(captured.definition.blueprint.dependencies).toEqual([
      { blockerStepKey: 'step_1', blockedStepKey: 'step_2' },
    ]);
    expect(captured.warnings).toMatchObject([{ code: 'capture_dependency', count: 3 }]);
  });

  it('refuses duplicate rows and missing authorized parents rather than inventing containment', () => {
    const nodes = existing();
    const source = {
      name: 'Authorized copy',
      root: present(nodes[0]),
      nodes: [present(nodes[1])],
      dependencies: [],
      context: context(),
      complete: true,
    };
    expect(() =>
      captureBlueprint({ ...source, nodes: [present(nodes[1]), present(nodes[1])] }),
    ).toThrow(/duplicate source nodes/i);
    expect(() =>
      captureBlueprint({
        ...source,
        nodes: [{ ...present(nodes[1]), parentId: 'inaccessible-parent' }],
      }),
    ).toThrow(/authorized parent/i);
  });
});
