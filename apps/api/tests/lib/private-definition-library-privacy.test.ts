import { beforeAll, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import { WorkTemplateListQuery } from '@docket/work/work-template-contract';
import { ProcessDefinitionCreate } from '../../src/contracts/recurrence';
import { createCanonicalPrivateDefinition } from '../../src/lib/recurrence/private-definition-publication';
import { loadProcessDefinitionDetail } from '../../src/lib/recurrence/process-definition';
import { listProcessDefinitions } from '../../src/lib/recurrence/process-definition-metadata';
import { listWorkTemplates, getWorkTemplate } from '../../src/lib/templates/service';
import { toWorkTemplateOut } from '../../src/lib/templates/projection';
import { loadCreationActor } from '../../src/lib/work-creation/context';
import {
  getPrivatePublicationDb,
  seedPrivatePublicationActor,
} from '../support/private-publication-fixture';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getPrivatePublicationDb();
});
it('keeps private multi-root names, titles and labels out of another workspace viewers library list and detail', async () => {
  const f = await seedPrivatePublicationActor(schema.db, schema);
  const viewer = assertDefined(
    (
      await schema.db
        .insert(schema.actor)
        .values({ organizationId: f.orgId, kind: 'human', displayName: 'Ordinary viewer' })
        .returning()
    )[0],
  );
  await schema.db.insert(schema.grant).values({
    organizationId: f.orgId,
    subjectKind: 'actor',
    subjectId: viewer.id,
    resourceKind: 'organization',
    resourceId: f.orgId,
    capabilities: ['view'],
    effect: 'allow',
    cascades: true,
  });
  const reader = await loadCreationActor(schema.db, f.orgId, viewer.id);
  const query = WorkTemplateListQuery.parse({});
  const before = await listWorkTemplates(reader, query, { seedDefaults: false });
  const label = assertDefined(
    (
      await schema.db
        .insert(schema.label)
        .values({ organizationId: f.orgId, name: 'PRIVATE-SOURCE-LABEL', color: '#6366f1' })
        .returning()
    )[0],
  );
  const created = await createCanonicalPrivateDefinition(schema.db, {
    organizationId: f.orgId,
    actorId: f.humanActorId,
    definition: ProcessDefinitionCreate.parse({
      name: 'PRIVATE-DEFINITION-NAME',
      project: { key: 'project', name: 'PRIVATE-PROJECT-TITLE', labelIds: [label.id] },
      tasks: [
        {
          key: 'one',
          title: 'PRIVATE-TASK-TITLE',
          description: 'PRIVATE-BODY',
          teamId: f.teamId,
          projectKey: 'project',
          labelIds: [label.id],
        },
      ],
    }),
  });
  expect(await listProcessDefinitions(schema.db, f.orgId, { limit: 20 }, viewer.id)).toEqual([]);
  await expect(
    loadProcessDefinitionDetail(schema.db, f.orgId, created.definitionId, viewer.id),
  ).rejects.toThrow();
  const listed = await listWorkTemplates(reader, query, { seedDefaults: false });
  const outputs = await Promise.all(
    listed.map(async (row) => toWorkTemplateOut(reader, await getWorkTemplate(reader, row.id))),
  );
  const visible = JSON.stringify(outputs);
  for (const secret of [
    'PRIVATE-DEFINITION-NAME',
    'PRIVATE-PROJECT-TITLE',
    'PRIVATE-TASK-TITLE',
    'PRIVATE-SOURCE-LABEL',
    'PRIVATE-BODY',
    label.id,
  ])
    expect(visible).not.toContain(secret);
  expect(listed.map((row) => row.id)).toEqual(before.map((row) => row.id));
});
