import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkTemplateChangePreview } from '@docket/work/work-template-reference';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { appWithActor, getDb, one, seedTaskAccessOrg } from '../support/routes-harness';
import { flushDeferredWork } from '../../src/lib/after-response';
import { createWorkTemplate, publishWorkTemplate } from '../../src/lib/templates/service';
import { workTemplateAssignmentRoutes } from '../../src/routes/work-template-assignment';

afterEach(flushDeferredWork);
describe('selective starting privacy', () => {
  it('restricts newly accepted children when the same action adopts private Program visibility', async () => {
    const schema = await getDb();
    const f = await seedTaskAccessOrg(schema.db, schema, 'manage');
    const caller = { orgId: f.orgId, actorId: f.humanActorId, capabilities: ['manage'] };
    const root = one(
      await schema.db
        .insert(schema.program)
        .values({
          organizationId: f.orgId,
          name: 'My program',
          visibility: 'public',
          statusId: f.statusId('program', 'active'),
        })
        .returning(),
    );
    const definition = WorkTemplateDefinition.parse({
      name: 'Private program',
      payload: { targetType: 'program', visibility: 'private' },
      blueprint: {
        steps: [
          {
            key: 'child',
            parentStepKey: null,
            kind: 'project',
            sort: 0,
            fields: { name: 'Accepted child' },
            template: null,
            teamRule: 'none',
            actorRule: 'unassigned',
            dates: {},
            optional: { enabled: false, selectedByDefault: true },
          },
        ],
        dependencies: [],
      },
    });
    const draft = await createWorkTemplate(caller, {
      targetType: 'program',
      scope: 'personal',
      offeredTeamIds: [],
      definition,
    });
    const published = await publishWorkTemplate(caller, draft.id, draft.draftRevision);
    const app = appWithActor(
      workTemplateAssignmentRoutes('program'),
      f.orgId,
      ['manage'],
      f.humanActorId,
    );
    const post = (suffix: string, body: object) =>
      app.request(`/${root.id}/template${suffix}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const response = await post('/preview', { workTypeId: published.id });
    expect(response.status).toBe(200);
    const preview = WorkTemplateChangePreview.parse(await response.json());
    expect(
      preview.changes.some((change) => change.field === 'visibility' && change.after === 'private'),
    ).toBe(true);
    const accepted = await post('', {
      workTypeId: published.id,
      previewToken: preview.previewToken,
      applyFields: ['visibility'],
      acceptChildChanges: preview.childChanges
        .filter((change) => change.kind === 'add_child')
        .map((change) => change.changeId),
    });
    expect(accepted.status).toBe(200);
    const children = await schema.db
      .select()
      .from(schema.project)
      .where(
        and(eq(schema.project.organizationId, f.orgId), eq(schema.project.programId, root.id)),
      );
    expect(children).toHaveLength(1);
    expect(children[0]?.visibility).toBe('private');
    expect(
      one(await schema.db.select().from(schema.program).where(eq(schema.program.id, root.id)))
        .visibility,
    ).toBe('private');
  });
});
