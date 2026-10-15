/** Composed template authoring through the real MCP catalog and canonical service. */
import type * as DbModule from '@docket/db';
import { WorkTemplateCreate } from '@docket/work/work-template-contract';
import type { Blueprint, BlueprintStep } from '@docket/work/work-template-blueprint';
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { getMigratedDb } from '../support/db';
import { resetAuthMocks } from '../support/auth-mock';
import { body, closeCatalogClients, connectCatalog, errorText } from './mcp-catalog-harness';
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

interface TemplateResult {
  changed: number;
  revision: number;
  publicationState: 'draft' | 'published' | 'archived';
  workTypeVersionId: string | null;
  changes: { id: string }[];
  changeSetId: string | null;
}

/** A literal child definition with ordinary reusable starting fields. */
function taskStep(key: string): Extract<BlueprintStep, { kind: 'task' }> {
  return {
    key,
    kind: 'task',
    parentStepKey: null,
    sort: 0,
    fields: { title: key, description: '## Acceptance Criteria\n- [ ] Prepare the event' },
    optional: { enabled: false, selectedByDefault: true },
    template: null,
    teamRule: 'parent_team',
    actorRule: 'unassigned',
    cycleRule: 'none',
    dates: {},
  };
}
const includedWork: Blueprint = {
  steps: [
    taskStep('prepare'),
    {
      ...taskStep('invite'),
      sort: 1,
      dates: {
        dueDate: {
          kind: 'anchor',
          anchor: { kind: 'parent' },
          offset: { days: -2, unit: 'working' },
        },
      },
    },
  ],
  dependencies: [{ blockerStepKey: 'prepare', blockedStepKey: 'invite' }],
};
const emptyWork: Blueprint = { steps: [], dependencies: [] };

/** Seed a real caller and connect the complete catalog. */
async function fixture() {
  const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
  return { ...seed, client: await connectCatalog(registerTools, seed.ctx) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Save a canonical baseline to isolate each MCP edit from MCP create behavior. */
async function canonicalDraft(f: Fixture, blueprint: Blueprint = includedWork) {
  const { createWorkTemplate } = await import('../../src/lib/templates/service');
  return createWorkTemplate(
    { orgId: f.orgId, actorId: f.actorId },
    WorkTemplateCreate.parse({
      targetType: 'project',
      definition: {
        name: 'Event preparation',
        payload: { targetType: 'project', description: '## Overview\nPrepare the event.' },
        blueprint,
      },
    }),
  );
}

/** Read the persisted definition without relying on the MCP report. */
async function saved(id: string) {
  const [row] = await schema.db.select().from(schema.template).where(eq(schema.template.id, id));
  if (!row) throw new Error('Expected the template to exist.');
  return row;
}

/** Read immutable publications to prove refused operations did not append one. */
async function versions(id: string) {
  return schema.db
    .select()
    .from(schema.workTypeVersion)
    .where(eq(schema.workTypeVersion.workTypeId, id))
    .orderBy(asc(schema.workTypeVersion.number));
}

/** Execute a successful authoring operation and read its validated result. */
async function define(f: Fixture, args: Record<string, unknown>): Promise<TemplateResult> {
  const result = await f.client.callTool({
    name: 'define_template',
    arguments: { orgId: f.orgId, ...args },
  });
  expect(result.isError, errorText(result)).not.toBe(true);
  return body<TemplateResult>(result);
}

describe('MCP blueprint authoring', () => {
  it('keeps composed work private until its reviewed revision is explicitly published', async () => {
    const f = await fixture();
    const created = await define(f, {
      action: 'draft',
      name: 'Event preparation',
      payload: { targetType: 'project', description: '## Overview\nPrepare the event.' },
      blueprint: includedWork,
    });
    const id = created.changes[0]?.id ?? '';
    expect(created).toMatchObject({ publicationState: 'draft', workTypeVersionId: null });
    expect(await saved(id)).toMatchObject({ scope: 'personal', publicationState: 'draft' });
    expect((await saved(id)).draftDefinition.blueprint).toEqual(includedWork);
    expect(await versions(id)).toHaveLength(0);
    const listed = await f.client.callTool({
      name: 'list_templates',
      arguments: { orgId: f.orgId, targetType: 'project' },
    });
    expect(listed.isError, errorText(listed)).not.toBe(true);
    const discovered = body<{
      templates: { id: string; draftDefinition?: { blueprint: Blueprint } }[];
    }>(listed).templates.find((template) => template.id === id);
    expect(discovered?.draftDefinition?.blueprint).toEqual(includedWork);
    const reopened = await define(f, {
      action: 'draft',
      template: id,
      expectedRevision: created.revision,
      name: 'Event delivery',
    });
    const published = await define(f, {
      action: 'publish',
      template: id,
      expectedRevision: reopened.revision,
    });
    expect(published.publicationState).toBe('published');
    expect((await versions(id))[0]?.definition.blueprint).toEqual(includedWork);
    const projected = await schema.db
      .select()
      .from(schema.blueprintStep)
      .where(eq(schema.blueprintStep.versionId, published.workTypeVersionId ?? ''));
    expect(projected.map((step) => step.key).sort()).toEqual(['invite', 'prepare']);
  });

  it('saves a blueprint-only edit without replacing the last publication', async () => {
    const f = await fixture();
    const draft = await canonicalDraft(f);
    const first = await define(f, {
      action: 'publish',
      template: draft.id,
      expectedRevision: draft.draftRevision,
    });
    const revised: Blueprint = { steps: [taskStep('invite')], dependencies: [] };
    const edited = await define(f, {
      action: 'draft',
      template: draft.id,
      expectedRevision: first.revision,
      blueprint: revised,
    });
    expect(edited.changed).toBe(1);
    expect(edited.changeSetId).not.toBeNull();
    expect((await saved(draft.id)).draftDefinition.blueprint).toEqual(revised);
    expect((await versions(draft.id))[0]?.definition.blueprint).toEqual(includedWork);
    await define(f, {
      action: 'publish',
      template: draft.id,
      expectedRevision: edited.revision,
    });
    expect((await versions(draft.id)).map((version) => version.definition.blueprint)).toEqual([
      includedWork,
      revised,
    ]);
  });

  it('preserves omitted child work and clears only an explicitly empty blueprint', async () => {
    const f = await fixture();
    const draft = await canonicalDraft(f);
    const renamed = await define(f, {
      action: 'draft',
      template: draft.id,
      expectedRevision: draft.draftRevision,
      description: 'Use for public events',
    });
    expect((await saved(draft.id)).draftDefinition.blueprint).toEqual(includedWork);
    await define(f, {
      action: 'draft',
      template: draft.id,
      expectedRevision: renamed.revision,
      blueprint: emptyWork,
    });
    expect((await saved(draft.id)).draftDefinition.blueprint).toEqual(emptyWork);
  });

  it('refuses legacy blueprint creation instead of silently publishing without children', async () => {
    const f = await fixture();
    const result = await f.client.callTool({
      name: 'define_template',
      arguments: {
        orgId: f.orgId,
        name: 'Unreviewed composition',
        scope: 'organization',
        payload: { targetType: 'project' },
        blueprint: includedWork,
      },
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain('action');
    const rows = await schema.db
      .select()
      .from(schema.template)
      .where(eq(schema.template.organizationId, f.orgId));
    expect(rows.some((row) => row.name === 'Unreviewed composition')).toBe(false);
  });

  it.each(['publish', 'archive'] as const)(
    'refuses blueprint fields on %s without changing the draft or publications',
    async (action) => {
      const f = await fixture();
      const draft = await canonicalDraft(f);
      const before = await saved(draft.id);
      const result = await f.client.callTool({
        name: 'define_template',
        arguments: {
          orgId: f.orgId,
          action,
          template: draft.id,
          expectedRevision: draft.draftRevision,
          blueprint: emptyWork,
        },
      });
      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain('action');
      expect(await saved(draft.id)).toEqual(before);
      expect(await versions(draft.id)).toHaveLength(0);
    },
  );

  it('checks a blueprint-only edit against the reviewed revision', async () => {
    const f = await fixture();
    const draft = await canonicalDraft(f);
    await define(f, {
      action: 'draft',
      template: draft.id,
      expectedRevision: draft.draftRevision,
      name: 'Revised event',
    });
    const before = await saved(draft.id);
    const result = await f.client.callTool({
      name: 'define_template',
      arguments: {
        orgId: f.orgId,
        action: 'draft',
        template: draft.id,
        expectedRevision: draft.draftRevision,
        blueprint: emptyWork,
      },
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain('conflict');
    expect(await saved(draft.id)).toEqual(before);
  });

  it('enforces the current authoring policy for blueprint-only edits', async () => {
    const f = await fixture();
    const draft = await canonicalDraft(f);
    await schema.db
      .update(schema.organization)
      .set({ workTemplateAuthoring: 'admins' })
      .where(eq(schema.organization.id, f.orgId));
    const before = await saved(draft.id);
    const result = await f.client.callTool({
      name: 'define_template',
      arguments: {
        orgId: f.orgId,
        action: 'draft',
        template: draft.id,
        expectedRevision: draft.draftRevision,
        blueprint: emptyWork,
      },
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain('forbidden');
    expect(await saved(draft.id)).toEqual(before);
    expect(await versions(draft.id)).toHaveLength(0);
  });

  it('refuses an unpublished child without leaking its body or publishing the parent', async () => {
    const f = await fixture();
    const { createWorkTemplate } = await import('../../src/lib/templates/service');
    const child = await createWorkTemplate(
      { orgId: f.orgId, actorId: f.actorId },
      WorkTemplateCreate.parse({
        targetType: 'task',
        definition: {
          name: 'Private vendor negotiation',
          payload: { targetType: 'task', description: 'Confidential vendor terms' },
        },
      }),
    );
    const created = await define(f, {
      action: 'draft',
      name: 'Event with private child',
      payload: { targetType: 'project' },
      blueprint: {
        steps: [
          {
            ...taskStep('prepare'),
            template: { workTypeId: child.id, selection: { kind: 'latest' } },
          },
        ],
        dependencies: [],
      },
    });
    const id = created.changes[0]?.id ?? '';
    const before = await saved(id);
    const result = await f.client.callTool({
      name: 'define_template',
      arguments: {
        orgId: f.orgId,
        action: 'publish',
        template: id,
        expectedRevision: created.revision,
      },
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain('not_found');
    expect(errorText(result)).not.toContain('Confidential vendor terms');
    expect(errorText(result)).not.toContain('Private vendor negotiation');
    expect(await saved(id)).toEqual(before);
    expect(await versions(id)).toHaveLength(0);
    expect(await versions(child.id)).toHaveLength(0);
  });

  it.each([
    ['missing_parent', 'blueprint_loop'],
    ['invalid_hierarchy', 'blueprint_invalid'],
  ] as const)(
    'uses canonical publication validation for %s and rolls back publication',
    async (invalidGraph, errorCode) => {
      const f = await fixture();
      const child: BlueprintStep =
        invalidGraph === 'missing_parent'
          ? { ...taskStep('prepare'), parentStepKey: 'missing' }
          : {
              key: 'project',
              kind: 'project',
              parentStepKey: null,
              sort: 0,
              fields: { name: 'Nested project' },
              optional: { enabled: false, selectedByDefault: true },
              template: null,
              teamRule: 'parent_team',
              actorRule: 'unassigned',
              dates: {},
            };
      const created = await define(f, {
        action: 'draft',
        name: 'Invalid structure',
        payload: { targetType: 'project' },
        blueprint: { steps: [child], dependencies: [] },
      });
      const id = created.changes[0]?.id ?? '';
      const before = await saved(id);
      const result = await f.client.callTool({
        name: 'define_template',
        arguments: {
          orgId: f.orgId,
          action: 'publish',
          template: id,
          expectedRevision: created.revision,
        },
      });
      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain(errorCode);
      expect(await saved(id)).toEqual(before);
      expect(await versions(id)).toHaveLength(0);
    },
  );
});
