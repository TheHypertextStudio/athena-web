import { describe, expect, it } from 'vitest';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { BlueprintStep } from '@docket/work/work-template-blueprint';
import type { TemplateRow } from '../../src/lib/templates/model';
import { prepareTemplateRestoration } from '../../src/lib/templates/restoration';

const previous = WorkTemplateDefinition.parse({
  name: 'Published preparation',
  payload: { targetType: 'project', description: 'Prior public body' },
});
const reviewed = WorkTemplateDefinition.parse({
  ...previous,
  payload: { targetType: 'project', description: 'Reviewed new body' },
  blueprint: {
    steps: [
      BlueprintStep.parse({
        key: 'new_step',
        kind: 'task',
        parentStepKey: null,
        sort: 0,
        fields: { title: 'New pending child' },
        template: null,
        teamRule: 'parent_team',
        actorRule: 'unassigned',
        cycleRule: 'none',
        dates: {},
        optional: { enabled: false, selectedByDefault: true },
      }),
    ],
    dependencies: [],
  },
});

const current: TemplateRow = {
  id: 'template',
  organizationId: 'workspace',
  targetType: 'project',
  createdBy: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  archivedAt: null,
  name: reviewed.name,
  description: reviewed.description,
  payload: reviewed.payload,
  scope: 'organization',
  ownerActorId: null,
  teamId: null,
  originWorkTypeId: null,
  originWorkTypeVersionId: null,
  isBase: false,
  isSeed: false,
  publicationState: 'published',
  icon: null,
  draftRevision: 4,
  draftDefinition: reviewed,
  latestPublishedVersionId: 'new-publication',
};

describe('template publication restoration', () => {
  it('restores the exact prior public blueprint while retaining its separately reviewed pending draft', () => {
    const before = {
      ...current,
      name: previous.name,
      description: previous.description,
      payload: previous.payload,
      draftDefinition: reviewed,
      latestPublishedVersionId: 'prior-publication',
    };
    const result = prepareTemplateRestoration(current, before, previous);
    expect(result?.definition).toEqual(previous);
    expect(result?.definition.blueprint.steps).toEqual([]);
    expect(result?.priorDraft).toEqual(reviewed);
    expect(result?.retainedVersionId).toBe('prior-publication');
  });
});
