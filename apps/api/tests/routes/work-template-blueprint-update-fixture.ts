import type * as DbModule from '@docket/db';
import { TaskCreate } from '@docket/work/task-model';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { WorkTemplateChangePreview } from '@docket/work/work-template-reference';
import { and, eq } from 'drizzle-orm';
import { expect } from 'vitest';
import { appWithActor, getDb, one, seedTaskAccessOrg } from '../support/routes-harness';
import { createWork } from '../../src/lib/work-creation/service';
import { appProvenance } from '../../src/lib/provenance/context';
import {
  createWorkTemplate,
  editWorkTemplateDraft,
  publishWorkTemplate,
} from '../../src/lib/templates/service';
import { workTemplateAssignmentRoutes } from '../../src/routes/work-template-assignment';

/** Load shared integration schema after Vitest's migrated database setup. */
export async function updateSchema(): Promise<typeof DbModule> {
  return getDb();
}
const headers = { 'content-type': 'application/json' };
/** Construct a small immutable Task blueprint for selective-update parity. */
export function definition(keys = ['prep'], offset = -1) {
  return WorkTemplateDefinition.parse({
    name: 'Report',
    payload: { targetType: 'task', title: 'Reusable title', description: '## Reusable outline' },
    blueprint: {
      steps: keys.map((key, sort) => ({
        key,
        kind: 'task',
        parentStepKey: null,
        sort,
        fields: { title: key, description: `## ${key}` },
        template: null,
        teamRule: 'parent_team',
        actorRule: 'unassigned',
        cycleRule: 'none',
        dates: {
          dueDate: {
            kind: 'anchor',
            anchor: { kind: 'parent' },
            offset: { days: offset, unit: 'calendar' },
          },
        },
        optional: { enabled: false, selectedByDefault: true },
      })),
      dependencies: [],
    },
  });
}
/** Create actual published work through the shared creation path. */
export async function fixture(initialDefinition = definition()) {
  const schema = await updateSchema();
  const base = await seedTaskAccessOrg(schema.db, schema, 'manage');
  const caller = {
    orgId: base.orgId,
    actorId: base.humanActorId,
    roleId: null,
    capabilities: ['manage'],
  };
  const draft = await createWorkTemplate(caller, {
    targetType: 'task',
    scope: 'personal',
    offeredTeamIds: [],
    definition: initialDefinition,
  });
  const published = await publishWorkTemplate(caller, draft.id, draft.draftRevision);
  const created = await createWork({
    caller,
    kind: 'task',
    body: TaskCreate.parse({
      title: 'My report',
      description: '## Authored notes',
      teamId: base.teamId,
      dueDate: '2027-02-10',
      workTypeId: published.id,
      workTypeVersionId: published.latestPublishedVersionId,
    }),
    invocation: { origin: { ...appProvenance(), v: 2, tool: 'task_create' } },
  });
  const child = one(
    await schema.db
      .select()
      .from(schema.task)
      .where(and(eq(schema.task.parentTaskId, created.root.id), eq(schema.task.title, 'prep'))),
  );
  const app = appWithActor(
    workTemplateAssignmentRoutes('task'),
    base.orgId,
    ['manage'],
    base.humanActorId,
  );
  return { ...base, caller, published, root: created.root, child, app, schema };
}
/** Authorized fixture and concrete created root/child rows. */
export type Fixture = Awaited<ReturnType<typeof fixture>>;
/** Append the reviewed replacement publication without modifying existing work. */
export async function newer(
  f: Fixture,
  keys = ['prep', 'review', 'send'],
  offset = -3,
  customDefinition?: WorkTemplateDefinition,
) {
  const draft = await editWorkTemplateDraft(f.caller, f.published.id, {
    expectedRevision: f.published.draftRevision,
    definition: customDefinition ?? definition(keys, offset),
  });
  return publishWorkTemplate(f.caller, draft.id, draft.draftRevision);
}
/** Invoke the same production assignment router with a real actor. */
export async function request(f: Fixture, action: string, body: object) {
  return f.app.request(`/${f.root.id}/template${action}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}
/** Read and validate a bounded update/change preview. */
export async function review(f: Fixture, mode: 'change' | 'update' = 'update') {
  const response = await request(f, '/preview', { workTypeId: f.published.id, mode });
  expect(response.status).toBe(200);
  return WorkTemplateChangePreview.parse(await response.json());
}
/** Read all concrete Task rows in this isolated fixture workspace. */
export async function rows(f: Fixture) {
  const { schema } = f;
  return schema.db.select().from(schema.task).where(eq(schema.task.organizationId, f.orgId));
}
