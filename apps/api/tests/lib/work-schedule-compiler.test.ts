import { describe, expect, it } from 'vitest';
import { ActorId, TeamId } from '@docket/identity-access/ids';
import { WorkScheduleDraft } from '@docket/work/work-schedule';
import { WorkScheduleForest } from '@docket/work/work-schedule-forest';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import {
  compileScheduleCommand,
  planScheduleBlueprint,
  scheduleDraftFingerprint,
} from '../../src/lib/recurrence/schedule-compiler';
import { requireScheduleRootBinding } from '../../src/lib/recurrence/schedule-authority';
import { CapabilityError } from '../../src/error';
import type { TemplateTransaction } from '../../src/lib/templates/persistence';
import {
  actor,
  context,
  graph,
  input,
  publication,
  resolution,
  step,
  team,
  ulid,
} from './work-schedule-fixture';

const caller = { orgId: ulid(1), actorId: actor, roleId: null, capabilities: ['manage'] };
function dinner(extra: Record<string, unknown> = {}) {
  return WorkScheduleDraft.parse({
    kind: 'schedule',
    revision: 1,
    template: { targetType: 'project', workTypeId: ulid(2), selection: { kind: 'latest' } },
    titlePattern: '{month} Dinner Q{quarter} {year}',
    timezone: 'America/Los_Angeles',
    root: { kind: 'project', fields: {}, placement: {}, dates: {}, teamId: team },
    stepOverrides: [],
    optionalChoices: [],
    ...extra,
  });
}
function compile(document = dinner()) {
  return compileScheduleCommand({
    caller,
    seriesId: ulid(3),
    ownerProgramId: ulid(4),
    runDate: '2026-10-08',
    document,
  });
}
describe('native schedule compiler', () => {
  it('preserves an authored blank child document and does not append a prepared inherited outline twice', () => {
    const baseline = input();
    const base = baseline.graph.publications[0];
    if (!base) throw new Error('Missing base publication');
    const selected = {
      ...baseline,
      graph: {
        ...baseline.graph,
        publications: [
          {
            ...base,
            definition: WorkTemplateDefinition.parse({
              ...base.definition,
              payload: { ...base.definition.payload, description: 'Published outline' },
            }),
          },
        ],
      },
    };
    for (const fields of [{ summary: null }, { summary: null, description: '' }]) {
      const command = compile(
        dinner({ stepOverrides: [{ kind: 'task', path: ['child'], fields }] }),
      ).roots[0]?.command;
      if (!command) throw new Error('Missing schedule command');
      const node = planScheduleBlueprint(command, selected).tree.nodes[1];
      expect(node?.fields).toMatchObject({
        summary: null,
        description: 'description' in fields ? '' : 'Published outline',
      });
    }
  });
  it('uses the saved civil date for the title and actual Program destination without adding a wrapper', () => {
    const compiled = compile();
    expect(compiled.roots).toHaveLength(1);
    expect(compiled.roots[0]?.command.body).toMatchObject({
      name: 'October Dinner Q4 2026',
      programId: ulid(4),
      targetDate: '2026-10-08',
    });
    expect(compile(dinner({ timezone: 'Pacific/Kiritimati' })).roots[0]?.command.body).toEqual(
      compiled.roots[0]?.command.body,
    );
  });
  it('refuses an inconsistent owning Program and a pending forest', () => {
    expect(() =>
      compile(
        dinner({
          root: { kind: 'project', fields: {}, dates: {}, placement: { programId: ulid(8) } },
        }),
      ),
    ).toThrow();
    const document = WorkScheduleForest.parse({
      kind: 'forest',
      revision: 1,
      state: 'pending_draft',
      roots: [{ key: 'one', draft: dinner() }],
      dependencies: [],
      timing: [],
    });
    expect(() =>
      compileScheduleCommand({
        caller,
        seriesId: ulid(3),
        ownerProgramId: null,
        runDate: '2026-10-08',
        document,
      }),
    ).toThrow();
  });
  it('retains exact accepted root selections instead of replacing them with latest', () => {
    const document = dinner();
    const selected = {
      key: 'root',
      kind: 'project' as const,
      workTypeId: publication(2, 'project').workTypeId,
      versionId: publication(2, 'project').versionId,
      resolvedManifest: [],
      optionalChoices: [],
      selectedPaths: [],
    };
    const compiled = compileScheduleCommand({
      caller,
      seriesId: ulid(3),
      ownerProgramId: null,
      runDate: '2026-10-08',
      document,
      acceptedRoots: [selected],
    });
    expect(compiled.roots[0]?.command.body.workTypeVersionId).toBe(selected.versionId);
    expect(compile(document).roots[0]?.command.body.workTypeVersionId).toBeUndefined();
  });
  it('fingerprints the complete normalized private draft without object insertion-order dependence', () => {
    const document = dinner();
    expect(scheduleDraftFingerprint(document)).toBe(
      scheduleDraftFingerprint({
        ...document,
        root: { ...document.root, placement: {}, fields: {} },
      }),
    );
    expect(scheduleDraftFingerprint(document)).not.toBe(
      scheduleDraftFingerprint(dinner({ titlePattern: 'Changed' })),
    );
  });
  it('applies actor/team/cycle null and private partial fields at selected exact paths', () => {
    const dana = ActorId.parse(ulid(12));
    const secondTeam = TeamId.parse(ulid(13));
    const document = dinner({
      stepOverrides: [
        {
          kind: 'task',
          path: ['child'],
          responsibleActorId: dana,
          teamId: secondTeam,
          cycleId: null,
          fields: { summary: null, description: '' },
          dates: { dueDate: null },
        },
      ],
    });
    const command = compile(document).roots[0]?.command;
    if (!command) throw new Error('Missing schedule command');
    const result = planScheduleBlueprint(command, {
      ...input(),
      context: context({
        actors: [
          { id: actor, active: true },
          { id: dana, active: true },
        ],
      }),
    });
    expect(result.tree.nodes[1]).toMatchObject({
      responsibleActorId: dana,
      teamId: secondTeam,
      cycleId: null,
      fields: { title: 'child', summary: null, description: '' },
      dates: { dueDate: null },
    });
    expect(result.tree.nodes[1]?.dateBindings.dueDate?.manual).toBe(true);
    expect(result.context.timezone).toBe('America/Los_Angeles');
  });
  it('refuses unavailable explicit actors and unknown/unselected overrides', () => {
    for (const override of [
      { kind: 'task', path: ['child'], responsibleActorId: ulid(99) },
      { kind: 'task', path: ['missing'] },
      { kind: 'project', path: ['child'] },
    ]) {
      const command = compile(dinner({ stepOverrides: [override] })).roots[0]?.command;
      if (!command) throw new Error('Missing schedule command');
      expect(() => planScheduleBlueprint(command, input())).toThrow();
    }
  });
  it('counts Milestones in the same 500 selected-work budget', () => {
    const base = publication(9, 'task');
    const milestones = [step('checkpoint', 'milestone', { fields: { name: 'Checkpoint' } })];
    const make = (count: number) => {
      const children = Array.from({ length: count }, (_, n) => step(`task_${n}`));
      return graph(
        publication(2, 'project', [...milestones, ...children]),
        [base],
        children.map((child) => resolution([child.key], base)),
      );
    };
    const command = compile().roots[0]?.command;
    if (!command) throw new Error('Missing schedule command');
    expect(planScheduleBlueprint(command, input({ graph: make(498) })).tree.nodes).toHaveLength(
      500,
    );
    expect(() => planScheduleBlueprint(command, input({ graph: make(499) }))).toThrow();
  });
  it('parsing a caller manifest or fabricated proof cannot authorize retained execution', () => {
    const command = compile().roots[0]?.command;
    if (!command) throw new Error('Missing schedule command');
    expect(() =>
      requireScheduleRootBinding({} as TemplateTransaction, {
        ...command,
        invocation: { ...command.invocation, scheduleBinding: { proof: {} } },
      }),
    ).toThrow(CapabilityError);
  });
});
