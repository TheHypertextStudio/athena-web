import { describe, expect, it } from 'vitest';
import type { PlannedWorkNode } from '@docket/work/blueprints';
import { TeamId } from '@docket/identity-access/ids';
import { WorkTypeId, WorkTypeVersionId, BlueprintStepId } from '@docket/work/ids';
import { appProvenance, originFor } from '../../src/lib/provenance/context';
import type { OrdinaryWorkCommand } from '../../src/lib/work-creation/types';
import {
  allocateBlueprintPlacement,
  blueprintNodeVisibility,
  commandForBlueprintNode,
} from '../../src/lib/work-template-blueprints/placement';

const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
function node(
  kind: PlannedWorkNode['kind'],
  path: string[],
  parentPath: string[] | null,
): PlannedWorkNode {
  return {
    kind,
    path,
    parentPath,
    scopePath: [],
    step: null,
    definition: null,
    workTypeId: kind === 'milestone' ? null : WorkTypeId.parse(id),
    workTypeVersionId: kind === 'milestone' ? null : WorkTypeVersionId.parse(id),
    sourceWorkTypeId: WorkTypeId.parse(id),
    sourceStepId: BlueprintStepId.parse(id),
    sourceVersionId: WorkTypeVersionId.parse(id),
    selected: true,
    prerequisitePaths: [],
    fields:
      kind === 'task'
        ? { title: 'Prepare', description: '', estimateMinutes: null, labelIds: [] }
        : { name: 'Dinner' },
    teamId: TeamId.parse(id),
    responsibleActorId: null,
    cycleId: null,
    dates: {},
    dateBindings: {},
    unresolvedReasons: {},
    placement: {},
  };
}
function command(): OrdinaryWorkCommand {
  return {
    kind: 'project',
    body: { name: 'Dinner' },
    caller: { orgId: id, actorId: id, roleId: null, capabilities: ['manage'] },
    invocation: { origin: originFor('project_create', {}, appProvenance()) },
  };
}
describe('blueprint concrete destination mapping', () => {
  it('keeps an authored private Program and every generated descendant private', () => {
    const privateProgram = {
      ...node('program', ['community'], []),
      fields: { name: 'Community', visibility: 'private' as const },
    };
    const rows = allocateBlueprintPlacement(
      [node('initiative', [], null), privateProgram, node('project', ['event'], ['community'])],
      new Map([
        ['[]', id],
        ['["community"]', id],
        ['["event"]', id],
      ]),
    );
    const program = rows[1],
      project = rows[2];
    if (!program || !project) throw new Error('Missing fixture');
    expect(commandForBlueprintNode(command(), program, 'public')).toMatchObject({
      kind: 'program',
      body: { visibility: 'private' },
    });
    expect(blueprintNodeVisibility(project, 'public')).toBe('private');
  });
  it('uses actual parent paths when authored siblings form a physical hierarchy', () => {
    const nodes = [
      node('project', [], null),
      node('milestone', ['venue'], []),
      node('task', ['book'], ['venue']),
      node('task', ['confirm'], ['book']),
    ];
    const rows = allocateBlueprintPlacement(
      nodes,
      new Map([
        ['[]', 'project'],
        ['["venue"]', 'milestone'],
        ['["book"]', 'task'],
        ['["confirm"]', 'subtask'],
      ]),
    );
    expect(rows[2]?.placement).toMatchObject({
      projectId: 'project',
      milestoneId: 'milestone',
      parentTaskId: null,
    });
    expect(rows[3]?.placement).toMatchObject({
      projectId: 'project',
      milestoneId: 'milestone',
      parentTaskId: 'task',
    });
    expect(rows[2]?.parent?.id).toBe('milestone');
  });
  it('keeps child prose, explicit null effort, dates and template identity through ordinary validation', () => {
    const child = node('task', ['prepare'], []);
    const rows = allocateBlueprintPlacement(
      [node('project', [], null), { ...child, dates: { dueDate: '2026-10-20' } }],
      new Map([
        ['[]', id],
        ['["prepare"]', id],
      ]),
    );
    const row = rows[1];
    expect(row).toBeDefined();
    if (!row) throw new Error('Missing fixture');
    expect(commandForBlueprintNode(command(), row, 'private')).toMatchObject({
      kind: 'task',
      body: {
        title: 'Prepare',
        description: '',
        estimateMinutes: null,
        teamId: id,
        projectId: id,
        dueDate: '2026-10-20',
        workTypeId: id,
        workTypeVersionId: id,
        labels: [],
      },
      invocation: { prospectiveWorkId: id, placement: { visibility: 'private' } },
    });
  });
  it('inherits the generated Initiative and Program as real associations', () => {
    const rows = allocateBlueprintPlacement(
      [
        node('initiative', [], null),
        node('program', ['community'], []),
        node('project', ['event'], ['community']),
      ],
      new Map([
        ['[]', id],
        ['["community"]', id],
        ['["event"]', id],
      ]),
    );
    const row = rows[2];
    if (!row) throw new Error('Missing fixture');
    expect(commandForBlueprintNode(command(), row, 'public')).toMatchObject({
      kind: 'project',
      body: { programId: id, initiativeIds: [id] },
    });
  });
  it('refuses missing concrete parents rather than treating logical key prefixes as containment', () => {
    expect(() =>
      allocateBlueprintPlacement(
        [node('task', ['child'], ['missing'])],
        new Map([['["child"]', id]]),
      ),
    ).toThrow();
  });
});
