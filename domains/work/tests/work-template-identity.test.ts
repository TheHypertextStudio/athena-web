import { describe, expect, it } from 'vitest';

import {
  WorkTemplateCreate,
  WorkTemplateDraftUpdate,
  WorkTemplatePublish,
} from '../src/contracts/work-template';
import { WorkTemplateSelection } from '../src/contracts/work-template-reference';
import { TaskCreate } from '../src/contracts/task';
import { InitiativeCreate } from '../src/contracts/initiative';
import { ProgramCreate } from '../src/contracts/program';

const templateId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const versionId = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const teamId = '01ARZ3NDEKTSV4RRFFQ69G5FAX';

describe('work-template draft and publication boundaries', () => {
  it.each(['initiative', 'program', 'project', 'task'] as const)(
    'starts a %s definition as a personal draft without implicitly sharing it',
    (targetType) => {
      const created = WorkTemplateCreate.parse({
        targetType,
        definition: { name: 'Event', payload: { targetType } },
      });
      expect(created.scope).toBe('personal');
      expect(created.offeredTeamIds).toEqual([]);
      expect(created.definition.payload.targetType).toBe(targetType);
    },
  );

  it('rejects a starting draft for a different work kind', () => {
    expect(
      WorkTemplateCreate.safeParse({
        targetType: 'project',
        definition: { name: 'Event', payload: { targetType: 'task' } },
      }).success,
    ).toBe(false);
  });

  it('requires an explicit team for a team-visible unpublished draft', () => {
    const input = {
      targetType: 'project',
      scope: 'team',
      definition: { name: 'Event', payload: { targetType: 'project' } },
    };
    expect(WorkTemplateCreate.safeParse(input).success).toBe(false);
    expect(WorkTemplateCreate.parse({ ...input, teamId }).teamId).toBe(teamId);
  });

  it('does not accept a client-supplied base or published state', () => {
    const input = {
      targetType: 'project',
      definition: { name: 'Event', payload: { targetType: 'project' } },
    };
    expect(WorkTemplateCreate.safeParse({ ...input, isBase: true }).success).toBe(false);
    expect(WorkTemplateCreate.safeParse({ ...input, status: 'published' }).success).toBe(false);
  });

  it('requires a revision for publication and refuses revision-only draft edits', () => {
    expect(WorkTemplatePublish.safeParse({}).success).toBe(false);
    expect(WorkTemplatePublish.safeParse({ expectedRevision: -1 }).success).toBe(false);
    expect(WorkTemplatePublish.parse({ expectedRevision: 0 }).expectedRevision).toBe(0);
    expect(WorkTemplateDraftUpdate.safeParse({ expectedRevision: 2 }).success).toBe(false);
  });

  it('refuses repeated team-offering identities', () => {
    expect(
      WorkTemplateCreate.safeParse({
        targetType: 'project',
        definition: { name: 'Event', payload: { targetType: 'project' } },
        offeredTeamIds: [teamId, teamId],
      }).success,
    ).toBe(false);
  });
});

describe('work-template creation selection', () => {
  it.each([
    ['task', TaskCreate, { title: 'Prepare', teamId }],
    ['initiative', InitiativeCreate, { name: 'Community' }],
    ['program', ProgramCreate, { name: 'Dinners' }],
  ] as const)(
    'retains a published identity in the %s creation contract',
    (_kind, schema, fields) => {
      expect(
        schema.parse({ ...fields, workTypeId: templateId, workTypeVersionId: versionId }),
      ).toMatchObject({ workTypeId: templateId, workTypeVersionId: versionId });
      expect(schema.safeParse({ ...fields, workTypeVersionId: versionId }).success).toBe(false);
    },
  );
  it('allows omitted selection for the base and an explicit published template', () => {
    expect(WorkTemplateSelection.parse({})).toEqual({});
    expect(WorkTemplateSelection.parse({ workTypeId: templateId })).toEqual({
      workTypeId: templateId,
    });
    expect(
      WorkTemplateSelection.parse({ workTypeId: templateId, workTypeVersionId: versionId }),
    ).toEqual({ workTypeId: templateId, workTypeVersionId: versionId });
  });

  it('rejects a version without its template and malformed identities', () => {
    expect(WorkTemplateSelection.safeParse({ workTypeVersionId: versionId }).success).toBe(false);
    expect(WorkTemplateSelection.safeParse({ workTypeId: 'Event' }).success).toBe(false);
  });
});
