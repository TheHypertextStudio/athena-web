import { present } from './blueprint-fixtures';
import { describe, expect, it } from 'vitest';
import { ActorId } from '@docket/identity-access/ids';
import { CycleId } from '../src/ids';
import { planBlueprint } from '../src/blueprints/rules';
import { reflowBlueprint } from '../src/blueprints/dates';
import { graph, publication, resolution, step, ulid } from './blueprint-fixtures';

import { actor, team, context, input, existing } from './blueprint-fixtures';

describe('pure blueprint relative rules and field ownership', () => {
  it.each([actor, null])(
    'reports only the chosen responsibility when an explicit override replaces an unavailable default',
    (responsibleActorId) => {
      const base = publication(9, 'task');
      const root = publication(2, 'project', [step('child', 'task', { actorRule: 'athena' })]);
      const planned = planBlueprint(
        input({
          graph: graph(root, [base], [resolution(['child'], base)]),
          context: context({
            athenaActorId: null,
            overrides: [{ path: ['child'], responsibleActorId }],
          }),
        }),
      );
      expect(planned.nodes[1]?.responsibleActorId).toBe(responsibleActorId);
      expect(planned.warnings).toEqual([]);
    },
  );
  it('keeps a checked schedule anchor override while retaining the actual run date context', () => {
    const planned = planBlueprint(
      input({
        context: context({
          runDate: '2026-10-20',
          overrides: [{ path: [], dates: { targetDate: '2026-10-22' } }],
        }),
      }),
    );
    expect(planned.nodes[0]?.dates.targetDate).toBe('2026-10-22');
  });
  it('preserves a manually cleared retained root anchor over the schedule run day', () => {
    const planned = planBlueprint(
      input({
        context: context({
          runDate: '2026-10-20',
          overrides: [{ path: [], dates: { targetDate: null } }],
        }),
      }),
    );
    expect(planned.nodes[0]?.dates.targetDate).toBeNull();
  });
  it.each(['project', 'program', 'initiative'] as const)(
    'preserves resolved %s health and summary clears over template defaults',
    (kind) => {
      const root = publication(2, kind);
      root.definition.payload = {
        targetType: kind,
        health: 'at_risk',
        summary: 'Template summary',
      };
      const planned = planBlueprint(
        input({
          graph: graph(root, [], []),
          root: {
            kind,
            fields: { name: 'Root', health: null, summary: null },
            teamId: null,
            responsibleActorId: null,
            cycleId: null,
            dates: {},
          },
        }),
      );
      expect(planned.nodes[0]?.fields).toMatchObject({ health: null, summary: null });
    },
  );
  it('preserves resolved Task summary and effort clears over template defaults', () => {
    const root = publication(2, 'task');
    root.definition.payload = {
      targetType: 'task',
      summary: 'Template summary',
      estimateMinutes: 60,
    };
    const planned = planBlueprint(
      input({
        graph: graph(root, [], []),
        root: {
          kind: 'task',
          fields: { title: 'Root', summary: null, estimateMinutes: null },
          teamId: team,
          responsibleActorId: null,
          cycleId: null,
          dates: {},
        },
      }),
    );
    expect(planned.nodes[0]?.fields).toMatchObject({ summary: null, estimateMinutes: null });
  });
  it('resolves parent actors and teams, and fails required task team instead of guessing', () => {
    expect(planBlueprint(input()).nodes[1]).toMatchObject({
      teamId: team,
      responsibleActorId: actor,
      dates: { dueDate: '2026-09-17' },
    });
    const source = input();
    expect(() =>
      planBlueprint({
        ...source,
        root: { ...source.root, teamId: null },
        context: context({ creationTeamId: null }),
      }),
    ).toThrow(/creation team/i);
  });
  it('uses Program owner context, permits null creator, and warns for inactive Athena', () => {
    const base = publication(9, 'task');
    const root = publication(2, 'program', [
      step('owner', 'task', { actorRule: 'parent_responsible' }),
      step('creator', 'task', { actorRule: 'creator' }),
      step('athena', 'task', { actorRule: 'athena' }),
    ]);
    const source = input({
      graph: graph(
        root,
        [base],
        ['owner', 'creator', 'athena'].map((key) => resolution([key], base)),
      ),
      root: {
        kind: 'program',
        fields: { name: 'Private program', visibility: 'private' },
        teamId: null,
        responsibleActorId: actor,
        cycleId: null,
        dates: {},
      },
      context: context({
        initiatingActorId: null,
        athenaActorId: ActorId.parse(ulid(50)),
        actors: [
          { id: actor, active: true },
          { id: ActorId.parse(ulid(50)), active: false },
        ],
      }),
    });
    const planned = planBlueprint(source);
    expect(planned.nodes.find((node) => node.path[0] === 'owner')?.responsibleActorId).toBe(actor);
    expect(planned.nodes.find((node) => node.path[0] === 'creator')?.responsibleActorId).toBeNull();
    expect(planned.nodes.find((node) => node.path[0] === 'athena')?.responsibleActorId).toBeNull();
    expect(planned.warnings.some((warning) => warning.code === 'athena_unavailable')).toBe(true);
  });
  it('resolves current cycle only in the selected team/window and refuses ambiguous windows', () => {
    const source = input();
    const base = publication(9, 'task');
    const root = publication(2, 'project', [step('child', 'task', { cycleRule: 'current_cycle' })]);
    const cycle = {
      id: CycleId.parse(ulid(51)),
      organizationId: source.context.organizationId,
      teamId: team,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      archived: false,
      closed: false,
    };
    const selected = {
      ...source,
      graph: graph(root, [base], [resolution(['child'], base)]),
      context: context({ cycles: [cycle] }),
    };
    expect(planBlueprint(selected).nodes[1]?.cycleId).toBe(cycle.id);
    expect(() =>
      planBlueprint({
        ...selected,
        context: context({ cycles: [cycle, { ...cycle, id: CycleId.parse(ulid(52)) }] }),
      }),
    ).toThrow(/multiple/i);
  });
  it('keeps missing anchors managed and uses Milestone and nested Task anchors', () => {
    const base = publication(9, 'task');
    const root = publication(2, 'project', [
      step('milestone', 'milestone', {
        dates: {
          targetDate: {
            kind: 'anchor',
            anchor: { kind: 'parent' },
            offset: { days: -7, unit: 'calendar' },
          },
        },
      }),
      step('parent', 'task', {
        dates: {
          dueDate: {
            kind: 'anchor',
            anchor: { kind: 'milestone', stepKey: 'milestone' },
            offset: { days: -1, unit: 'calendar' },
          },
        },
      }),
      step('nested', 'task', {
        parentStepKey: 'parent',
        dates: {
          dueDate: {
            kind: 'anchor',
            anchor: { kind: 'parent' },
            offset: { days: -1, unit: 'calendar' },
          },
        },
      }),
    ]);
    const selected = input({
      graph: graph(root, [base], [resolution(['parent'], base), resolution(['nested'], base)]),
    });
    expect(
      planBlueprint(selected).nodes.find((node) => node.path[0] === 'nested')?.dates.dueDate,
    ).toBe('2026-09-29');
    const missing = planBlueprint({ ...selected, root: { ...selected.root, dates: {} } });
    expect(missing.nodes.find((node) => node.path[0] === 'nested')).toMatchObject({
      dates: { dueDate: null },
      unresolvedReasons: { dueDate: 'missing_anchor' },
    });
  });
  it('preserves independent manual null/date fields and terminal rows during reflow', () => {
    const nodes = existing();
    const child = present(nodes[1]);
    const binding = present(child.dateBindings.dueDate);
    const mixed = {
      ...child,
      dates: { startDate: null, dueDate: '2026-09-17' },
      dateBindings: {
        startDate: { ...binding, manual: true, lastDerivedDate: null },
        dueDate: binding,
      },
    };
    const changes = reflowBlueprint({
      nodes: [present(nodes[0]), mixed],
      context: context(),
      anchorChanges: [{ path: [], field: 'targetDate', value: '2026-10-09' }],
    });
    expect(changes.map((change) => [change.field, change.value])).toEqual([
      ['dueDate', '2026-09-18'],
    ]);
    expect(
      reflowBlueprint({
        nodes: [present(nodes[0]), { ...mixed, state: 'completed' }],
        context: context(),
        anchorChanges: [{ path: [], field: 'targetDate', value: '2026-10-09' }],
      }),
    ).toEqual([]);
    expect(
      reflowBlueprint({ nodes: [present(nodes[0]), mixed], context: context(), anchorChanges: [] }),
    ).toEqual([]);
  });
});

it('delegates Milestone relative actor and team context to its containing Project', () => {
  const base = publication(9, 'task');
  const root = publication(2, 'project', [
    step('m', 'milestone', { teamRule: 'none', actorRule: 'unassigned' }),
    step('t', 'task', { parentStepKey: 'm', actorRule: 'parent_responsible' }),
  ]);
  const selected = input({
    graph: graph(root, [base], [resolution(['t'], base)]),
    context: context({ creationTeamId: null }),
  });
  expect(planBlueprint(selected).nodes.find((node) => node.path[0] === 't')).toMatchObject({
    teamId: team,
    responsibleActorId: actor,
  });
});

it('preserves an explicitly blank inline description instead of appending base prose', () => {
  const base = publication(9, 'task');
  base.definition.payload = { targetType: 'task', description: '## Base heading' };
  const root = publication(2, 'project', [
    step('child', 'task', { fields: { title: 'Child', description: '' } }),
  ]);
  expect(
    planBlueprint(input({ graph: graph(root, [base], [resolution(['child'], base)]) })).nodes[1]
      ?.fields.description,
  ).toBe('');
});

it('refuses derived Task date windows that run backwards', () => {
  const base = publication(9, 'task');
  const root = publication(2, 'project', [
    step('child', 'task', {
      dates: {
        startDate: {
          kind: 'anchor',
          anchor: { kind: 'parent' },
          offset: { days: 1, unit: 'calendar' },
        },
        dueDate: {
          kind: 'anchor',
          anchor: { kind: 'parent' },
          offset: { days: -1, unit: 'calendar' },
        },
      },
    }),
  ]);
  expect(() =>
    planBlueprint(input({ graph: graph(root, [base], [resolution(['child'], base)]) })),
  ).toThrow(/date window/i);
});

it('keeps independent accepted old/new field rules and manual null when reflowing', () => {
  const nodes = existing();
  const binding = present(present(nodes[1]).dateBindings.dueDate);
  const startRule = {
    kind: 'anchor' as const,
    anchor: { kind: 'parent' as const },
    offset: { days: -30, unit: 'calendar' as const },
  };
  const child = {
    ...present(nodes[1]),
    dates: { startDate: '2026-09-08', dueDate: '2026-09-17' },
    dateBindings: {
      startDate: { ...binding, rule: startRule, lastDerivedDate: '2026-09-08' },
      dueDate: binding,
    },
  };
  const changes = reflowBlueprint({
    nodes: [present(nodes[0]), child],
    context: context(),
    anchorChanges: [{ path: [], field: 'targetDate', value: '2026-10-09' }],
  });
  expect(changes.map((change) => [change.field, change.value])).toEqual([
    ['startDate', '2026-09-09'],
    ['dueDate', '2026-09-18'],
  ]);
});

it('reopening completion prerequisites clears only managed nonterminal successors and delivery repeats are no-ops', () => {
  const base = publication(9, 'task');
  const rule = {
    kind: 'after_completion',
    stepKeys: ['a', 'b', 'c'],
    offset: { days: 0, unit: 'calendar' },
  };
  const root = publication(2, 'project', [
    step('a'),
    step('b'),
    step('c'),
    step('report', 'task', { dates: { dueDate: rule } }),
  ]);
  const completions = ['a', 'b', 'c'].map((key) => ({
    path: [key],
    state: 'completed' as const,
    completedAt: '2026-10-09T10:00:00Z',
  }));
  const selected = input({
    graph: graph(
      root,
      [base],
      ['a', 'b', 'c', 'report'].map((key) => resolution([key], base)),
    ),
    context: context({ completions }),
  });
  const nodes = existing(planBlueprint(selected));
  const opened = context({
    completions: completions.map((fact, i) =>
      i === 0 ? { ...fact, state: 'open', completedAt: null } : fact,
    ),
  });
  expect(reflowBlueprint({ nodes, context: opened, anchorChanges: [] })).toMatchObject([
    { field: 'dueDate', value: null, unresolvedReason: 'waiting_completion' },
  ]);
  expect(reflowBlueprint({ nodes, context: context({ completions }), anchorChanges: [] })).toEqual(
    [],
  );
});

it('applies trusted schedule title overrides and avoids a second root document append', () => {
  const selected = input();
  selected.graph.root.definition.payload = { targetType: 'project', description: '## Template' };
  const planned = planBlueprint({
    ...selected,
    root: {
      ...selected.root,
      kind: 'project',
      fields: { name: 'Authored', description: '## Template\n\nAuthored body' },
      documentPrepared: true,
    },
    context: context({
      overrides: [{ path: ['child'], fields: { title: 'Schedule-specific title' } }],
    }),
  });
  expect(planned.nodes[0]?.fields.description).toBe('## Template\n\nAuthored body');
  const task = planned.nodes[1]?.fields;
  expect(task && 'title' in task ? task.title : null).toBe('Schedule-specific title');
});

it('reflows independently adopted fields against concrete retained Milestone IDs', () => {
  const nodes = existing();
  const root = present(nodes[0]);
  const child = present(nodes[1]);
  const rule = {
    kind: 'anchor' as const,
    anchor: { kind: 'milestone' as const, stepKey: 'm' },
    offset: { days: 0, unit: 'calendar' as const },
  };
  const binding = { ...present(child.dateBindings.dueDate), rule, lastDerivedDate: null };
  const early = {
    ...child,
    id: 'early',
    parentId: root.id,
    kind: 'milestone' as const,
    path: ['m'],
    dates: { targetDate: '2026-10-01' },
    dateBindings: {},
    fields: { name: 'Old milestone' },
  };
  const late = { ...early, id: 'late', dates: { targetDate: '2026-10-20' } };
  const mixed = {
    ...child,
    parentId: root.id,
    dates: { startDate: null, dueDate: null },
    dateBindings: { startDate: binding, dueDate: binding },
    dateReferences: {
      startDate: { parentId: root.id, milestoneIds: { m: 'early' }, completionIds: {} },
      dueDate: { parentId: root.id, milestoneIds: { m: 'late' }, completionIds: {} },
    },
  };
  expect(
    reflowBlueprint({
      nodes: [root, early, late, mixed],
      context: context(),
      anchorChanges: [],
    }).map((change) => [change.field, change.value]),
  ).toEqual([
    ['startDate', '2026-10-01'],
    ['dueDate', '2026-10-20'],
  ]);
});

it('uses publication status metadata below explicit step status and schedule overrides', () => {
  const base = publication(9, 'task');
  base.definition.defaultStatusKey = 'in_progress';
  const root = publication(2, 'project', [
    step('inherited'),
    step('explicit', 'task', { fields: { title: 'Explicit', state: 'backlog' } }),
  ]);
  const planned = planBlueprint(
    input({
      graph: graph(
        root,
        [base],
        ['inherited', 'explicit'].map((key) => resolution([key], base)),
      ),
    }),
  );
  const inherited = planned.nodes.find((node) => node.path[0] === 'inherited')?.fields;
  const explicit = planned.nodes.find((node) => node.path[0] === 'explicit')?.fields;
  expect(inherited && 'state' in inherited ? inherited.state : null).toBe('in_progress');
  expect(explicit && 'state' in explicit ? explicit.state : null).toBe('backlog');
});

it('treats present undefined starting fields as omitted while retaining blank prose', () => {
  const base = publication(9, 'task');
  base.definition.payload = { targetType: 'task', description: '## Base' };
  const root = publication(2, 'project', [
    step('child', 'task', { fields: { title: 'Child', description: undefined } }),
  ]);
  root.definition.payload = { targetType: 'project', description: '## Root' };
  const selected = input({ graph: graph(root, [base], [resolution(['child'], base)]) });
  const planned = planBlueprint({
    ...selected,
    root: {
      ...selected.root,
      kind: 'project',
      fields: { name: 'Authored', description: undefined },
    },
    context: context({
      overrides: [{ path: ['child'], fields: { description: undefined }, documentPrepared: true }],
    }),
  });
  expect(planned.nodes[0]?.fields.description).toBe('## Root');
  expect(planned.nodes[1]?.fields.description).toBe('## Base');
});
