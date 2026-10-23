/** Published work-template identities through the MCP creation boundary. */
import type * as DbModule from '@docket/db';
import { WorkTemplateCreate, WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { getMigratedDb } from '../support/db';
import { resetAuthMocks } from '../support/auth-mock';
import { body, closeCatalogClients, connectCatalog } from './mcp-catalog-harness';
import { seedMcpUpdateOrg } from './mcp-update-tool-fixtures';

let schema!: typeof DbModule;
let registerTools!: typeof RegisterTools;
beforeAll(async () => {
  schema = await getMigratedDb();
  registerTools = (await import('../../src/mcp/tools')).registerTools;
});
afterEach(async () => {
  await closeCatalogClients();
  resetAuthMocks();
});

/** Publish a template through the canonical service. */
async function published(
  seed: Awaited<ReturnType<typeof seedMcpUpdateOrg>>,
  kind: 'task' | 'project' | 'initiative' | 'program',
) {
  const { createWorkTemplate } = await import('../../src/lib/templates/service');
  return createWorkTemplate(
    { orgId: seed.orgId, actorId: seed.actorId },
    WorkTemplateCreate.parse({
      targetType: kind,
      scope: 'organization',
      definition: {
        name: `Event ${kind}`,
        payload: { targetType: kind, description: '## Original outline' },
      },
    }),
    { publish: true },
  );
}

describe('MCP published template identity', () => {
  it.each(['task', 'project', 'initiative', 'program'] as const)(
    'pins the selected %s publication and preserves it after republishing',
    async (kind) => {
      const seed = await seedMcpUpdateOrg(
        schema.db,
        schema,
        kind === 'program' ? ['view', 'manage'] : ['view', 'contribute'],
      );
      const first = await published(seed, kind);
      const { editWorkTemplateDraft, publishWorkTemplate } =
        await import('../../src/lib/templates/service');
      const actor = { orgId: seed.orgId, actorId: seed.actorId };
      const edited = await editWorkTemplateDraft(actor, first.id, {
        expectedRevision: first.draftRevision,
        definition: WorkTemplateDefinition.parse({
          name: `Revised ${kind}`,
          description: null,
          icon: null,
          defaultStatusKey: null,
          payload: { targetType: kind, description: '## New outline' },
        }),
      });
      await publishWorkTemplate(actor, first.id, edited.draftRevision);
      const client = await connectCatalog(registerTools, seed.ctx);
      const result = await client.callTool({
        name: 'organize',
        arguments: {
          orgId: seed.orgId,
          items: [
            {
              ref: 'work',
              kind,
              title: `Pinned ${kind}`,
              workTypeId: first.id,
              workTypeVersionId: first.latestPublishedVersionId,
            },
          ],
        },
      });
      expect(result.isError).not.toBe(true);
      const created = body<{
        placed: { id: string; workTypeId: string; workTypeVersionId: string }[];
      }>(result).placed[0];
      expect(created).toMatchObject({
        workTypeId: first.id,
        workTypeVersionId: first.latestPublishedVersionId,
      });
      const [saved] = await schema.db
        .select()
        .from(schema[kind])
        .where(eq(schema[kind].id, created?.id ?? ''));
      expect(saved).toMatchObject({
        workTypeId: first.id,
        workTypeVersionId: first.latestPublishedVersionId,
        description: '## Original outline',
      });
    },
  );

  it('copies a published capture body and rejects a version without its identity', async () => {
    const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    const saved = await published(seed, 'task');
    const client = await connectCatalog(registerTools, seed.ctx);
    const result = await client.callTool({
      name: 'capture',
      arguments: {
        orgId: seed.orgId,
        text: 'Invite guests',
        workTypeId: saved.id,
        workTypeVersionId: saved.latestPublishedVersionId,
      },
    });
    expect(result.isError).not.toBe(true);
    const id = body<{ items: { id: string }[] }>(result).items[0]?.id ?? '';
    const [row] = await schema.db.select().from(schema.task).where(eq(schema.task.id, id));
    expect(row).toMatchObject({
      workTypeId: saved.id,
      workTypeVersionId: saved.latestPublishedVersionId,
      description: '## Original outline',
    });
    const refused = await client.callTool({
      name: 'capture',
      arguments: {
        orgId: seed.orgId,
        text: 'Refuse this',
        workTypeVersionId: saved.latestPublishedVersionId,
      },
    });
    expect(refused.isError).toBe(true);
  });

  it.each(['retained', 'explicit'] as const)(
    'pins a %s plan publication through confirmation',
    async (selection) => {
      const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
      const saved = await published(seed, 'initiative');
      const client = await connectCatalog(registerTools, seed.ctx);
      const started = body<{ planId: string }>(
        await client.callTool({ name: 'plan_start', arguments: { orgId: seed.orgId } }),
      );
      const drafted = await client.callTool({
        name: 'plan_draft',
        arguments: {
          planId: started.planId,
          revision: 0,
          ops: [
            {
              op: 'upsert_node',
              node: { ref: 'i', kind: 'initiative', fields: { title: 'Pinned plan' } },
            },
            { op: 'apply_template', ref: 'i', templateId: saved.id },
          ],
        },
      });
      expect(drafted.isError, JSON.stringify(drafted)).not.toBe(true);
      const { editWorkTemplateDraft, publishWorkTemplate } =
        await import('../../src/lib/templates/service');
      const actor = { orgId: seed.orgId, actorId: seed.actorId };
      const edited = await editWorkTemplateDraft(actor, saved.id, {
        expectedRevision: saved.draftRevision,
        definition: WorkTemplateDefinition.parse({
          name: 'Later initiative',
          description: null,
          icon: null,
          defaultStatusKey: null,
          payload: { targetType: 'initiative', description: '## Later outline' },
        }),
      });
      await publishWorkTemplate(actor, saved.id, edited.draftRevision);
      if (selection === 'explicit') {
        const applied = await client.callTool({
          name: 'plan_draft',
          arguments: {
            planId: started.planId,
            revision: 1,
            ops: [
              {
                op: 'apply_template',
                ref: 'i',
                templateId: saved.id,
                workTypeVersionId: saved.latestPublishedVersionId,
              },
            ],
          },
        });
        expect(applied.isError, JSON.stringify(applied)).not.toBe(true);
      }
      const committed = await client.callTool({
        name: 'plan_commit',
        arguments: { planId: started.planId, refs: ['i'] },
      });
      expect(committed.isError, JSON.stringify(committed)).not.toBe(true);
      const id = body<{ placed: { id: string }[] }>(committed).placed[0]?.id ?? '';
      const [row] = await schema.db
        .select()
        .from(schema.initiative)
        .where(eq(schema.initiative.id, id));
      expect(row).toMatchObject({
        workTypeId: saved.id,
        workTypeVersionId: saved.latestPublishedVersionId,
        description: '## Original outline',
      });
    },
  );

  it('keeps legacy private drafts on the base and rejects hidden identities without exposing content', async () => {
    const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    const { createWorkTemplate } = await import('../../src/lib/templates/service');
    const draft = await createWorkTemplate(
      { orgId: seed.orgId, actorId: seed.actorId },
      WorkTemplateCreate.parse({
        targetType: 'project',
        definition: {
          name: 'Private outline',
          payload: { targetType: 'project', description: '## Private details' },
        },
      }),
    );
    const [hidden] = await schema.db
      .insert(schema.template)
      .values({
        organizationId: seed.orgId,
        ownerActorId: seed.sarahId,
        scope: 'personal',
        targetType: 'project',
        name: 'Secret outline',
        payload: { targetType: 'project', description: '## Secret details' },
      })
      .returning();
    const client = await connectCatalog(registerTools, seed.ctx);
    const created = await client.callTool({
      name: 'organize',
      arguments: {
        orgId: seed.orgId,
        items: [{ ref: 'p', kind: 'project', title: 'Legacy project', template: draft.id }],
      },
    });
    expect(created.isError).not.toBe(true);
    const id = body<{ placed: { id: string }[] }>(created).placed[0]?.id ?? '';
    const [row] = await schema.db.select().from(schema.project).where(eq(schema.project.id, id));
    const [base] = await schema.db
      .select()
      .from(schema.template)
      .where(eq(schema.template.id, row?.workTypeId ?? ''));
    expect(base?.isBase).toBe(true);
    expect(row?.description).toBe('## Private details');
    for (const workTypeId of [draft.id, hidden?.id ?? '']) {
      const refused = await client.callTool({
        name: 'organize',
        arguments: {
          orgId: seed.orgId,
          items: [{ ref: 'p', kind: 'project', title: 'Must not create', workTypeId }],
        },
      });
      expect(refused.isError).toBe(true);
      expect(JSON.stringify(refused)).not.toContain('Secret');
    }
  });

  it.each(['top', 'task'] as const)(
    'retains a repeating task publication selected through %s through its next occurrence',
    async (location) => {
      const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
      const saved = await published(seed, 'task');
      const client = await connectCatalog(registerTools, seed.ctx);
      const result = await client.callTool({
        name: 'repeat_task',
        arguments: {
          orgId: seed.orgId,
          ...(location === 'top' ? { workTypeId: saved.id } : {}),
          recurringTask: {
            task: {
              teamId: seed.teamId,
              title: 'Pinned review',
              ...(location === 'task' ? { workTypeId: saved.id } : {}),
            },
            schedule: { kind: 'after_completion', interval: 1, unit: 'week' },
          },
        },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const firstId = body<{ firstTask: { id: string } }>(result).firstTask.id;
      const [first] = await schema.db.select().from(schema.task).where(eq(schema.task.id, firstId));
      expect(first).toMatchObject({
        workTypeId: saved.id,
        workTypeVersionId: saved.latestPublishedVersionId,
      });
      const { editWorkTemplateDraft, publishWorkTemplate } =
        await import('../../src/lib/templates/service');
      const actor = { orgId: seed.orgId, actorId: seed.actorId };
      const edited = await editWorkTemplateDraft(actor, saved.id, {
        expectedRevision: saved.draftRevision,
        definition: WorkTemplateDefinition.parse({
          name: 'New review',
          description: null,
          icon: null,
          defaultStatusKey: null,
          payload: { targetType: 'task', description: '## Later outline' },
        }),
      });
      await publishWorkTemplate(actor, saved.id, edited.draftRevision);
      await schema.db
        .update(schema.task)
        .set({ state: 'done', statusId: seed.statusId('task', 'done'), completedAt: new Date() })
        .where(eq(schema.task.id, firstId));
      const { advanceCompletedProcessTask } = await import('../../src/lib/recurrence/advance');
      const advanced = await advanceCompletedProcessTask(schema.db, {
        organizationId: seed.orgId,
        actorId: seed.actorId,
        completedTaskId: firstId,
        completedOn: new Date().toISOString().slice(0, 10),
      });
      expect(advanced.nextOccurrenceId).toEqual(expect.any(String));
      const rows = await schema.db
        .select()
        .from(schema.task)
        .where(
          and(eq(schema.task.organizationId, seed.orgId), eq(schema.task.title, 'Pinned review')),
        );
      expect(rows).toHaveLength(2);
      expect(
        rows.every(
          (row) =>
            row.workTypeId === saved.id &&
            row.workTypeVersionId === saved.latestPublishedVersionId &&
            row.description === '## Original outline',
        ),
      ).toBe(true);
    },
  );

  it('authors a draft, publishes its reviewed revision, edits without publishing, and archives', async () => {
    const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    const client = await connectCatalog(registerTools, seed.ctx);
    const created = await client.callTool({
      name: 'define_template',
      arguments: {
        orgId: seed.orgId,
        action: 'draft',
        name: 'Event brief',
        scope: 'organization',
        payload: { targetType: 'project', description: '## Goal' },
      },
    });
    expect(created.isError).not.toBe(true);
    const result = body<{
      changes: { id: string }[];
      revision: number;
      publicationState: string;
      workTypeVersionId: string | null;
    }>(created);
    const id = result.changes[0]?.id ?? '';
    expect(result).toMatchObject({
      revision: 0,
      publicationState: 'draft',
      workTypeVersionId: null,
    });
    const publication = await client.callTool({
      name: 'define_template',
      arguments: {
        orgId: seed.orgId,
        template: id,
        action: 'publish',
        expectedRevision: result.revision,
      },
    });
    expect(publication.isError).not.toBe(true);
    const publishedResult = body<{ workTypeVersionId: string; revision: number }>(publication);
    const versionId = publishedResult.workTypeVersionId;
    const edited = await client.callTool({
      name: 'define_template',
      arguments: {
        orgId: seed.orgId,
        template: id,
        action: 'draft',
        expectedRevision: publishedResult.revision,
        payload: { targetType: 'project', description: '## Changed' },
      },
    });
    expect(edited.isError).not.toBe(true);
    const [saved] = await schema.db
      .select()
      .from(schema.template)
      .where(eq(schema.template.id, id));
    expect(saved).toMatchObject({
      latestPublishedVersionId: versionId,
      payload: { description: '## Goal' },
      draftDefinition: { payload: { description: '## Changed' } },
    });
    const catalog = body<{
      templates: {
        id: string;
        revision: number;
        payload: { description: string };
        draftDefinition?: { payload: { description: string } };
      }[];
    }>(
      await client.callTool({
        name: 'list_templates',
        arguments: { orgId: seed.orgId, targetType: 'project' },
      }),
    );
    expect(catalog.templates.find((entry) => entry.id === id)).toMatchObject({
      revision: saved?.draftRevision,
      payload: { description: '## Goal' },
      draftDefinition: { payload: { description: '## Changed' } },
    });
    await schema.db
      .update(schema.organization)
      .set({ workTemplateAuthoring: 'admins' })
      .where(eq(schema.organization.id, seed.orgId));
    const restricted = await client.callTool({
      name: 'list_templates',
      arguments: { orgId: seed.orgId, targetType: 'project' },
    });
    expect(restricted.isError).not.toBe(true);
    expect(JSON.stringify(restricted)).not.toContain('## Changed');
    await schema.db
      .update(schema.organization)
      .set({ workTemplateAuthoring: 'contributors' })
      .where(eq(schema.organization.id, seed.orgId));
    const stale = await client.callTool({
      name: 'define_template',
      arguments: {
        orgId: seed.orgId,
        template: id,
        action: 'publish',
        expectedRevision: result.revision,
      },
    });
    expect(stale.isError).toBe(true);
    const archived = await client.callTool({
      name: 'define_template',
      arguments: { orgId: seed.orgId, template: id, action: 'archive' },
    });
    expect(archived.isError).not.toBe(true);
    expect(body<{ publicationState: string }>(archived).publicationState).toBe('archived');
    const undone = await client.callTool({
      name: 'undo',
      arguments: {
        orgId: seed.orgId,
        changeSetId: body<{ changeSetId: string }>(archived).changeSetId,
      },
    });
    expect(undone.isError).not.toBe(true);
    const [restored] = await schema.db
      .select()
      .from(schema.template)
      .where(eq(schema.template.id, id));
    expect(restored).toMatchObject({
      publicationState: 'published',
      archivedAt: null,
      latestPublishedVersionId: versionId,
    });
  });

  it('discovers the four bases and current publication metadata', async () => {
    const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    const saved = await published(seed, 'project');
    const client = await connectCatalog(registerTools, seed.ctx);
    const result = body<{
      templates: {
        id: string;
        isBase: boolean;
        publicationState: string;
        workTypeVersionId: string | null;
      }[];
    }>(await client.callTool({ name: 'list_templates', arguments: { orgId: seed.orgId } }));
    expect(result.templates.filter((row) => row.isBase)).toHaveLength(4);
    expect(result.templates.find((row) => row.id === saved.id)).toMatchObject({
      publicationState: 'published',
      workTypeVersionId: saved.latestPublishedVersionId,
    });
  });
});
