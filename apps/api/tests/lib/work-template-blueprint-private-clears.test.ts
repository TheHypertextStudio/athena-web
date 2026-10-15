import { describe, expect, it, vi } from 'vitest';
import { TeamId } from '@docket/identity-access/ids';
import { WorkTypeId, WorkTypeVersionId, BlueprintStepId } from '@docket/work/ids';
import { TaskCreate } from '@docket/work/task-model';
import { ProgramCreate } from '@docket/work/program-contract';
import { ProjectCreate } from '../../src/contracts/project';
import type { PlannedWorkNode } from '@docket/work/blueprints';
import type { OrdinaryWorkCommand, PreparedOrdinaryWork } from '../../src/lib/work-creation/types';
import type { TemplateTransaction } from '../../src/lib/templates/persistence';
import {
  allocateBlueprintPlacement,
  commandForBlueprintNode,
} from '../../src/lib/work-template-blueprints/placement';
import { prepareBlueprintEntries } from '../../src/lib/work-template-blueprints/preflight-entries';
import { appProvenance, originFor } from '../../src/lib/provenance/context';

vi.mock('../../src/lib/work-template-blueprints/context', () => ({
  validateBlueprintCreationTeams: vi.fn(),
}));
vi.mock('../../src/lib/work-creation/ordinary-prospective', () => ({
  createOrdinaryPreparationContext: vi.fn(async () => ({ proof: {} })),
  inheritOrdinaryPreparationContext: vi.fn(),
}));
vi.mock('../../src/lib/work-creation/ordinary-prepare', () => ({
  prepareOrdinaryWork: vi.fn(async (_tx: unknown, command: OrdinaryWorkCommand) =>
    publishedDefaults(command),
  ),
}));

const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
type ChildKind = 'task' | 'project' | 'program';
function source(kind: ChildKind): OrdinaryWorkCommand {
  const scope = {
    caller: { orgId: id, actorId: id, roleId: null, capabilities: ['manage'] },
    invocation: { origin: originFor('work_create', {}, appProvenance()) },
  };
  if (kind === 'task') return { ...scope, kind: 'project', body: { name: 'Parent' } };
  if (kind === 'project') return { ...scope, kind: 'program', body: { name: 'Parent' } };
  return { ...scope, kind: 'initiative', body: { name: 'Parent' } };
}
function node(
  kind: PlannedWorkNode['kind'],
  path: string[],
  summary: string | null | undefined,
): PlannedWorkNode {
  return {
    kind,
    path,
    parentPath: path.length ? [] : null,
    scopePath: [],
    step: null,
    definition: null,
    workTypeId: WorkTypeId.parse(id),
    workTypeVersionId: WorkTypeVersionId.parse(id),
    sourceWorkTypeId: WorkTypeId.parse(id),
    sourceStepId: BlueprintStepId.parse(id),
    sourceVersionId: WorkTypeVersionId.parse(id),
    selected: true,
    prerequisitePaths: [],
    fields: {
      ...(kind === 'task' ? { title: 'Child' } : { name: 'Child' }),
      ...(summary !== undefined ? { summary } : {}),
      description: '',
      ...(kind !== 'task' ? { health: null } : {}),
    },
    teamId: TeamId.parse(id),
    responsibleActorId: null,
    cycleId: null,
    dates: {},
    dateBindings: {},
    unresolvedReasons: {},
    placement: {},
  };
}
function publishedDefaults(command: OrdinaryWorkCommand): PreparedOrdinaryWork {
  const common = {
    organizationId: id,
    statusId: id,
    summary: command.body.summary ?? 'Published summary',
    description: command.body.description,
  };
  const insert: PreparedOrdinaryWork['insert'] =
    command.kind === 'task'
      ? {
          kind: 'task',
          values: {
            ...common,
            title: command.body.title,
            state: 'backlog',
            teamId: command.body.teamId,
          },
        }
      : command.kind === 'project'
        ? {
            kind: 'project',
            values: {
              ...common,
              name: command.body.name,
              health: command.body.health === undefined ? 'at_risk' : command.body.health,
            },
          }
        : command.kind === 'program'
          ? {
              kind: 'program',
              values: {
                ...common,
                name: command.body.name,
                health: command.body.health === undefined ? 'at_risk' : command.body.health,
              },
            }
          : { kind: 'initiative', values: { ...common, name: command.body.name } };
  return { command, insert, labels: [], initiativeIds: [], relatedTaskIds: [], milestones: [] };
}
async function preparedChild(kind: ChildKind, summary: string | null | undefined) {
  const selected = source(kind);
  const root = node(selected.kind, [], undefined);
  const child = node(kind, ['child'], summary);
  const allocated = allocateBlueprintPlacement(
    [root, child],
    new Map([
      ['[]', id],
      ['["child"]', id],
    ]),
  );
  const entries = await prepareBlueprintEntries({} as TemplateTransaction, {
    selected,
    root: publishedDefaults(selected),
    allocated,
    visibility: 'public',
    preparationContext: undefined,
    existing: undefined,
  });
  const entry = entries[1];
  if (entry?.kind !== 'ordinary') throw new Error('Missing prepared child');
  if (entry.prepared.insert.kind === 'milestone') throw new Error('Unexpected checkpoint child');
  return entry.prepared.insert;
}
describe('trusted nullable child overrides across ordinary DTO/defaults', () => {
  it.each<ChildKind>(['task', 'project', 'program'])(
    'accepts a %s summary clear without relaxing its public create DTO',
    (kind) => {
      const selected = source(kind);
      const rows = allocateBlueprintPlacement(
        [node(selected.kind, [], undefined), node(kind, ['child'], null)],
        new Map([
          ['[]', id],
          ['["child"]', id],
        ]),
      );
      const child = rows[1];
      if (!child) throw new Error('Missing allocated child');
      const command = commandForBlueprintNode(selected, child, 'public');
      expect(command.body.summary).toBeUndefined();
      const schema =
        kind === 'task' ? TaskCreate : kind === 'project' ? ProjectCreate : ProgramCreate;
      expect(schema.safeParse({ ...command.body, summary: null }).success).toBe(false);
    },
  );
  it.each<ChildKind>(['task', 'project', 'program'])(
    'clears inherited %s summary after ordinary defaults while preserving blank prose and health null',
    async (kind) => {
      const insert = await preparedChild(kind, null);
      expect(insert.values).toMatchObject({ summary: null, description: '' });
      if (insert.kind === 'project' || insert.kind === 'program')
        expect(insert.values.health).toBeNull();
    },
  );
  it.each<ChildKind>(['task', 'project', 'program'])(
    'distinguishes an authored %s blank summary from an omitted default',
    async (kind) => {
      expect((await preparedChild(kind, '')).values.summary).toBe('');
      expect((await preparedChild(kind, undefined)).values.summary).toBe('Published summary');
    },
  );
});
