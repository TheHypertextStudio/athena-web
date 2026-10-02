/** Template-backed creation through the public MCP protocol. */
import type * as DbModule from '@docket/db';
import { eq, and } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertDefined } from '@docket/test-utils';
import { LabelId } from '@docket/work/ids';
import type { TemplateDraft } from '@docket/work/template-contract';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { getMigratedDb } from '../support/db';
import { resetAuthMocks } from '../support/auth-mock';
import {
  body,
  closeCatalogClients,
  connectCatalog,
  seedLabel,
  joinTeam,
  seedSecondTeam,
} from './mcp-catalog-harness';
import { seedMcpUpdateOrg } from './mcp-update-tool-fixtures';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;
beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
});
afterEach(async () => {
  await closeCatalogClients();
  resetAuthMocks();
});
type Seed = Awaited<ReturnType<typeof seedMcpUpdateOrg>>;
/** Save a literal draft with an optional visibility boundary. */
async function saveTemplate(
  seed: Seed,
  payload: TemplateDraft,
  extra: Partial<typeof schema.template.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.template)
    .values({
      organizationId: seed.orgId,
      ownerActorId: seed.actorId,
      name: 'Event',
      targetType: payload.targetType,
      payload,
      scope: 'personal',
      ...extra,
    })
    .returning();
  if (!row) throw new Error('Template seed failed');
  return row.id;
}
interface Created {
  placed: { id: string; kind: string; description: string | null; created: boolean }[];
  changeSetId: string;
}

describe('template-backed work creation', () => {
  it('returns choices and writes nothing until each relevant item has a template decision', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const templateId = await saveTemplate(seed, {
      targetType: 'project',
      description: '## Venue\n\n## Guests\n',
    });
    const client = await connectCatalog(registerTools, seed.ctx);
    const result = await client.callTool({
      name: 'organize',
      arguments: {
        orgId: seed.orgId,
        items: [
          { ref: 'p', kind: 'project', title: 'October launch' },
          { ref: 't', kind: 'task', title: 'Invite guests', parent: 'p' },
        ],
      },
    });
    expect(result.isError).toBe(true);
    expect(body(result)).toMatchObject({
      code: 'template_selection_required',
      choices: [
        {
          ref: 'p',
          templates: [{ id: templateId, payload: { description: '## Venue\n\n## Guests\n' } }],
        },
      ],
    });
    expect(
      await db
        .select()
        .from(schema.project)
        .where(
          and(
            eq(schema.project.organizationId, seed.orgId),
            eq(schema.project.name, 'October launch'),
          ),
        ),
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.task).where(eq(schema.task.title, 'Invite guests')),
    ).toHaveLength(0);
    const override = await client.callTool({
      name: 'organize',
      arguments: {
        orgId: seed.orgId,
        items: [
          {
            ref: 'p',
            kind: 'project',
            title: 'October launch',
            withoutTemplateReason: 'The user requested a freeform note.',
            description: 'Keep this short.',
          },
        ],
      },
    });
    expect(override.isError).not.toBe(true);
  });

  it.each(['task', 'project', 'initiative', 'program'] as const)(
    'copies the literal %s body and returns it for further editing',
    async (kind) => {
      const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
      const markdown = '## Outcome\n\n- Fill this in.  \n\n## Evidence\n';
      const templateId = await saveTemplate(seed, { targetType: kind, description: markdown });
      const client = await connectCatalog(registerTools, seed.ctx);
      const args = {
        orgId: seed.orgId,
        items: [{ ref: 'work', kind, title: `New ${kind}`, template: templateId }],
      };
      const result = await client.callTool({ name: 'organize', arguments: args });
      expect(result.isError).not.toBe(true);
      const created = body<Created>(result);
      expect(created.placed[0]?.description).toBe(markdown);
      const id = assertDefined(created.placed[0]).id;
      const changed = await client.callTool({
        name: 'update',
        arguments: {
          orgId: seed.orgId,
          entity: kind,
          scope: { ids: [id] },
          set: { description: markdown.replace('Fill this in.', 'Host 30 guests.') },
        },
      });
      expect(changed.isError).not.toBe(true);
      const again = body<Created>(await client.callTool({ name: 'organize', arguments: args }));
      expect(again.placed[0]).toMatchObject({ created: false });
      const [saved] = await db
        .select()
        .from(schema[kind])
        .where(eq(schema[kind].id, assertDefined(id)));
      expect(saved?.description).toBe(markdown.replace('Fill this in.', 'Host 30 guests.'));
    },
  );

  it('applies container defaults beneath manual properties that a template does not define', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const projectTemplate = await saveTemplate(seed, {
      targetType: 'project',
      description: '## Goal',
      summary: 'Ship the event.',
      health: 'at_risk',
      status: 'planned',
    });
    const initiativeTemplate = await saveTemplate(seed, {
      targetType: 'initiative',
      description: '## Why',
      priority: 'high',
      updateCadence: 'weekly',
    });
    const programTemplate = await saveTemplate(seed, {
      targetType: 'program',
      description: '## Routine',
      visibility: 'private',
      health: 'on_track',
    });
    const client = await connectCatalog(registerTools, seed.ctx);
    const result = body<Created>(
      await client.callTool({
        name: 'organize',
        arguments: {
          orgId: seed.orgId,
          items: [
            {
              ref: 'p',
              kind: 'project',
              title: 'Launch',
              template: projectTemplate,
              targetDate: '2026-10-30',
              lead: seed.actorId,
              priority: 'urgent',
              description: '',
            },
            {
              ref: 'i',
              kind: 'initiative',
              title: 'Events strategy',
              template: initiativeTemplate,
              owner: seed.actorId,
            },
            {
              ref: 'o',
              kind: 'program',
              title: 'Events operation',
              template: programTemplate,
              health: 'off_track',
            },
          ],
        },
      }),
    );
    const ids = new Map(result.placed.map((p) => [p.kind, p.id]));
    const [project] = await db
      .select()
      .from(schema.project)
      .where(eq(schema.project.id, assertDefined(ids.get('project'))));
    expect(project).toMatchObject({
      summary: 'Ship the event.',
      health: 'at_risk',
      priority: 'urgent',
      description: '',
      leadId: seed.actorId,
    });
    expect(project?.targetDate?.toISOString()).toContain('2026-10-30');
    const [initiative] = await db
      .select()
      .from(schema.initiative)
      .where(eq(schema.initiative.id, assertDefined(ids.get('initiative'))));
    expect(initiative).toMatchObject({
      priority: 'high',
      updateCadence: 'weekly',
      ownerId: seed.actorId,
    });
    const [program] = await db
      .select()
      .from(schema.program)
      .where(eq(schema.program.id, assertDefined(ids.get('program'))));
    expect(program).toMatchObject({ health: 'off_track', visibility: 'private' });
  });

  it('applies task labels and priority, drops deleted defaults, and accepts empty overrides', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const labelId = await seedLabel(db, schema, seed, { name: 'Event' });
    const gone = await seedLabel(db, schema, seed, { name: 'Deleted' });
    const templateId = await saveTemplate(seed, {
      targetType: 'task',
      description: '## Steps',
      priority: 'high',
      labelIds: [LabelId.parse(labelId), LabelId.parse(gone)],
    });
    await db.delete(schema.label).where(eq(schema.label.id, gone));
    const client = await connectCatalog(registerTools, seed.ctx);
    const created = body<Created>(
      await client.callTool({
        name: 'organize',
        arguments: {
          orgId: seed.orgId,
          items: [
            {
              ref: 'default',
              kind: 'task',
              title: 'Invite guests',
              template: templateId,
              dueDate: '2026-10-20',
            },
            {
              ref: 'manual',
              kind: 'task',
              title: 'Manual task',
              template: templateId,
              priority: 'none',
              labelIds: [],
              description: '',
            },
          ],
        },
      }),
    );
    const [first, second] = created.placed;
    expect(
      await db
        .select()
        .from(schema.taskLabel)
        .where(eq(schema.taskLabel.taskId, assertDefined(first).id)),
    ).toMatchObject([{ labelId }]);
    expect(
      await db
        .select()
        .from(schema.taskLabel)
        .where(eq(schema.taskLabel.taskId, assertDefined(second).id)),
    ).toHaveLength(0);
    const [row] = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, assertDefined(second).id));
    expect(row).toMatchObject({ priority: 'none', description: '', templateId });
    expect(
      (
        await client.callTool({
          name: 'undo',
          arguments: { orgId: seed.orgId, changeSetId: created.changeSetId },
        })
      ).isError,
    ).not.toBe(true);
  });

  it('does not reveal private templates or allow a template for the wrong kind or team', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    await saveTemplate(
      seed,
      { targetType: 'project', description: 'Secret body' },
      { ownerActorId: seed.sarahId },
    );
    const otherTeam = await seedSecondTeam(db, schema, seed);
    await joinTeam(db, schema, seed, otherTeam);
    const wrongTeam = await saveTemplate(
      seed,
      { targetType: 'task' },
      { scope: 'team', teamId: otherTeam },
    );
    const client = await connectCatalog(registerTools, seed.ctx);
    const plain = await client.callTool({
      name: 'organize',
      arguments: {
        orgId: seed.orgId,
        items: [{ ref: 'p', kind: 'project', title: 'Public project' }],
      },
    });
    expect(plain.isError).not.toBe(true);
    for (const kind of ['task', 'project']) {
      const result = await client.callTool({
        name: 'organize',
        arguments: {
          orgId: seed.orgId,
          items: [{ ref: 'work', kind, title: 'Invalid template target', template: wrongTeam }],
        },
      });
      expect(result.isError).toBe(true);
    }
  });

  it('refuses inaccessible selections and conflicting decisions before writing', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const hidden = await saveTemplate(
      seed,
      { targetType: 'project', description: 'Private body' },
      { ownerActorId: seed.sarahId },
    );
    const client = await connectCatalog(registerTools, seed.ctx);
    for (const choice of [
      { template: hidden },
      { template: hidden, withoutTemplateReason: 'Freeform' },
    ]) {
      const result = await client.callTool({
        name: 'organize',
        arguments: {
          orgId: seed.orgId,
          items: [{ ref: 'p', kind: 'project', title: 'Should not exist', ...choice }],
        },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain('Private body');
    }
    expect(
      await db.select().from(schema.project).where(eq(schema.project.name, 'Should not exist')),
    ).toHaveLength(0);
  });

  it('rolls back the entire tree when a saved container status no longer exists', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const templateId = await saveTemplate(seed, {
      targetType: 'project',
      status: 'removed-status',
      description: '## Goal',
    });
    const client = await connectCatalog(registerTools, seed.ctx);
    const result = await client.callTool({
      name: 'organize',
      arguments: {
        orgId: seed.orgId,
        items: [
          { ref: 'i', kind: 'initiative', title: 'Rollback initiative' },
          {
            ref: 'p',
            kind: 'project',
            title: 'Rollback project',
            parent: 'i',
            template: templateId,
          },
        ],
      },
    });
    expect(result.isError).toBe(true);
    expect(
      await db
        .select()
        .from(schema.initiative)
        .where(eq(schema.initiative.name, 'Rollback initiative')),
    ).toHaveLength(0);
    const override = await client.callTool({
      name: 'organize',
      arguments: {
        orgId: seed.orgId,
        items: [
          {
            ref: 'p',
            kind: 'project',
            title: 'Manual status',
            template: templateId,
            status: 'planned',
          },
        ],
      },
    });
    expect(override.isError).not.toBe(true);
  });

  it('requires a repeating-task decision without creating a process or recurrence series', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    await saveTemplate(seed, { targetType: 'task', description: '## Review' });
    const client = await connectCatalog(registerTools, seed.ctx);
    const recurringTask = {
      task: { teamId: seed.teamId, title: 'Weekly review' },
      schedule: { kind: 'after_completion', interval: 1, unit: 'week' },
    };
    const result = await client.callTool({
      name: 'repeat_task',
      arguments: { orgId: seed.orgId, recurringTask },
    });
    expect(result.isError).toBe(true);
    expect(body(result)).toMatchObject({ code: 'template_selection_required' });
    expect(
      await db.select().from(schema.task).where(eq(schema.task.title, 'Weekly review')),
    ).toHaveLength(0);
    const override = await client.callTool({
      name: 'repeat_task',
      arguments: {
        orgId: seed.orgId,
        recurringTask,
        withoutTemplateReason: 'The user requested a title-only routine.',
      },
    });
    expect(override.isError).not.toBe(true);
  });

  it('requires a capture decision and can create a populated task from its title', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const labelId = await seedLabel(db, schema, seed, { name: 'Follow-up' });
    const templateId = await saveTemplate(seed, {
      targetType: 'task',
      description: '## Decisions\n\n## Owners',
      priority: 'high',
      labelIds: [LabelId.parse(labelId)],
    });
    const client = await connectCatalog(registerTools, seed.ctx);
    expect(
      (
        await client.callTool({
          name: 'capture',
          arguments: { orgId: seed.orgId, text: 'Meeting follow-up' },
        })
      ).isError,
    ).toBe(true);
    const created = body<{ items: { id: string; description: string }[] }>(
      await client.callTool({
        name: 'capture',
        arguments: { orgId: seed.orgId, text: 'Meeting follow-up', template: templateId },
      }),
    );
    expect(created.items[0]?.description).toBe('## Decisions\n\n## Owners');
    const firstId = assertDefined(created.items[0]).id;
    expect(
      await db.select().from(schema.taskLabel).where(eq(schema.taskLabel.taskId, firstId)),
    ).toMatchObject([{ labelId }]);
    const manual = body<{ items: { description: string }[] }>(
      await client.callTool({
        name: 'capture',
        arguments: {
          orgId: seed.orgId,
          text: 'Short note',
          template: templateId,
          description: '',
          priority: 'none',
          labelIds: [],
        },
      }),
    );
    expect(manual.items[0]?.description).toBe('');
  });
});
