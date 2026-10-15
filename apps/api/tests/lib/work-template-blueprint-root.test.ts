import { describe, expect, it } from 'vitest';
import { TeamId } from '@docket/identity-access/ids';
import { OrganizationId } from '@docket/identity-access/ids';
import { WorkTypeId, WorkTypeVersionId } from '@docket/work/ids';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { planBlueprint } from '@docket/work/blueprints';
import type { WorkCreationCommand } from '../../src/lib/work-creation/types';
import type { PreparedOrdinaryWork } from '../../src/lib/work-creation/types';
import { appProvenance, originFor } from '../../src/lib/provenance/context';
import { preparedBlueprintRoot } from '../../src/lib/work-template-blueprints/root';

const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
function prepared(insert: PreparedOrdinaryWork['insert']): PreparedOrdinaryWork {
  const scope = {
    caller: { orgId: id, actorId: id, roleId: null, capabilities: ['manage'] },
    invocation: { origin: originFor('work_create', {}, appProvenance()) },
  };
  const command: WorkCreationCommand =
    insert.kind === 'task'
      ? { ...scope, kind: 'task', body: { title: 'Prepare', teamId: TeamId.parse(id) } }
      : insert.kind === 'program'
        ? { ...scope, kind: 'program', body: { name: 'Community' } }
        : insert.kind === 'initiative'
          ? { ...scope, kind: 'initiative', body: { name: 'Fundraising' } }
          : { ...scope, kind: 'project', body: { name: 'Dinner' } };
  return {
    command,
    insert,
    labels: [],
    initiativeIds: [],
    relatedTaskIds: [],
    milestones: [],
  };
}
describe('ordinary prepared roots for blueprint planning', () => {
  it('retains an existing Initiative association as child placement context', () => {
    const input = prepared({
      kind: 'program',
      values: { organizationId: id, name: 'Community', statusId: id },
    });
    expect(preparedBlueprintRoot({ ...input, initiativeIds: [id] }).placement).toMatchObject({
      initiativeId: id,
    });
  });
  it('retains explicit health and summary clears over template defaults', () => {
    const root = preparedBlueprintRoot(
      prepared({
        kind: 'project',
        values: { organizationId: id, name: 'Dinner', health: null, summary: null, statusId: id },
      }),
    );
    const publication = {
      organizationId: OrganizationId.parse(id),
      kind: 'project' as const,
      workTypeId: WorkTypeId.parse(id),
      versionId: WorkTypeVersionId.parse(id),
      definition: WorkTemplateDefinition.parse({
        name: 'Event',
        payload: { targetType: 'project', health: 'at_risk', summary: 'Template summary' },
      }),
      stepIds: {},
    };
    const tree = planBlueprint({
      root,
      graph: { root: publication, publications: [], resolutions: [], fingerprint: 'reviewed' },
      context: {
        organizationId: OrganizationId.parse(id),
        initiatingActorId: null,
        actors: [],
        athenaActorId: null,
        creationTeamId: null,
        creationDate: '2026-10-08',
        timezone: 'UTC',
        workingWeekdays: [1, 2, 3, 4, 5],
        cycles: [],
        completions: [],
      },
      choices: [],
    });
    expect(tree.nodes[0]?.fields).toMatchObject({ health: null, summary: null });
  });

  it('preserves date-only Task anchors independently of the planning timezone', () => {
    const root = preparedBlueprintRoot(
      prepared({
        kind: 'task',
        values: {
          organizationId: id,
          title: 'Prepare',
          teamId: id,
          state: 'in_progress',
          statusId: id,
          dueDate: new Date('2026-10-08T00:00:00Z'),
        },
      }),
    );
    expect(root).toMatchObject({
      kind: 'task',
      fields: { title: 'Prepare', state: 'in_progress' },
      teamId: id,
      dates: { dueDate: '2026-10-08' },
    });
  });
  it('uses resolved coarse Project boundaries, final prose and ordinary destination references', () => {
    const root = preparedBlueprintRoot(
      prepared({
        kind: 'project',
        values: {
          organizationId: id,
          name: 'Dinner',
          description: '',
          targetDate: new Date('2026-12-31'),
          teamId: id,
          programId: id,
          leadId: id,
          status: 'planned',
          statusId: id,
        },
      }),
    );
    expect(root).toMatchObject({
      kind: 'project',
      fields: { name: 'Dinner', description: '', status: 'planned' },
      dates: { targetDate: '2026-12-31' },
      placement: { programId: id },
      responsibleActorId: id,
      documentPrepared: true,
    });
  });
  it('normalizes an explicitly cleared document without filling it from the template', () => {
    const root = preparedBlueprintRoot(
      prepared({
        kind: 'initiative',
        values: {
          organizationId: id,
          name: 'Fundraising',
          description: null,
          ownerId: id,
          statusId: id,
        },
      }),
    );
    expect(root.fields.description).toBe('');
    expect(root.documentPrepared).toBe(true);
  });
  it('keeps Programs teamless and rejects a Milestone as a generation root', () => {
    expect(
      preparedBlueprintRoot(
        prepared({
          kind: 'program',
          values: { organizationId: id, name: 'Community', statusId: id },
        }),
      ),
    ).toMatchObject({ kind: 'program', teamId: null, dates: {} });
    expect(() =>
      preparedBlueprintRoot(
        prepared({
          kind: 'milestone',
          values: { organizationId: id, projectId: id, name: 'Venue' },
        }),
      ),
    ).toThrow();
  });
});
