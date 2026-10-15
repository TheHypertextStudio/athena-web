import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import {
  createWorkTemplate,
  editWorkTemplateDraft,
  publishWorkTemplate,
} from '../../src/lib/templates/service';
import type { retainedFixture } from '../recurrence/work-template-adapter-fixture';
type Fixture = Awaited<ReturnType<typeof retainedFixture>>;
type Publication = Awaited<ReturnType<typeof publishWorkTemplate>>;
/** Publish an exact reusable parent reference for archive-impact regressions. */
export async function publication(
  f: Fixture,
  kind: 'task' | 'project' | 'program',
  name: string,
  child?: Publication,
  selection: 'pinned' | 'latest' = 'pinned',
) {
  const step = child
    ? {
        key: 'child',
        kind: child.targetType,
        parentStepKey: null,
        sort: 0,
        optional: { enabled: false, selectedByDefault: true },
        template: {
          workTypeId: child.id,
          selection:
            selection === 'pinned'
              ? { kind: 'pinned', workTypeVersionId: child.latestPublishedVersionId }
              : { kind: 'latest' },
        },
        teamRule: 'creation_team',
        actorRule: 'creator',
        fields: child.targetType === 'task' ? { title: 'Child' } : { name: 'Child' },
        dates: {},
        ...(child.targetType === 'task' ? { cycleRule: 'none' } : {}),
      }
    : null;
  const draft = await createWorkTemplate(f.caller, {
    targetType: kind,
    scope: 'personal',
    offeredTeamIds: [],
    definition: WorkTemplateDefinition.parse({
      name,
      payload: { targetType: kind, ...(kind === 'task' ? { title: name } : {}) },
      blueprint: { steps: step ? [step] : [], dependencies: [] },
    }),
  });
  return publishWorkTemplate(f.caller, draft.id, draft.draftRevision);
}
/** Append an actual immutable publication using the ordinary authoring service. */
export async function republish(
  f: Fixture,
  parent: Publication,
  definition: WorkTemplateDefinition,
) {
  const edited = await editWorkTemplateDraft(f.caller, parent.id, {
    expectedRevision: parent.draftRevision,
    definition,
  });
  return publishWorkTemplate(f.caller, parent.id, edited.draftRevision);
}
/** Replace the fixture child with an exact pinned template while preserving authored shape. */
export function replaceChild(parent: Publication, child: Publication): WorkTemplateDefinition {
  return WorkTemplateDefinition.parse({
    ...parent.draftDefinition,
    blueprint: {
      ...parent.draftDefinition.blueprint,
      steps: parent.draftDefinition.blueprint.steps.map((step) => ({
        ...step,
        template: {
          workTypeId: child.id,
          selection: { kind: 'pinned', workTypeVersionId: child.latestPublishedVersionId },
        },
      })),
    },
  });
}
