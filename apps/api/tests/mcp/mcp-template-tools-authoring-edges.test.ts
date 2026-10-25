/** `define_template` argument refusals, no-op edits, proposals and automated draft edits. */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';

import type { Toolbox } from '../../src/agent/toolbox';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import {
  body,
  closeCatalogClients,
  connectCatalog,
  errorText,
  joinTeam,
  seedLabel,
} from './mcp-catalog-harness';
import { seedMcpUpdateOrg, type McpUpdateSeed } from './mcp-update-tool-fixtures';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;
const opened: Toolbox[] = [];

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
});

afterEach(async () => {
  await closeCatalogClients();
  while (opened.length) await opened.pop()?.close();
  resetAuthMocks();
});

/** The parts of the tool result these tests compare. */
interface TemplateResult {
  changed: number;
  revision: number;
  publicationState: string;
  changes: { id: string; matched: boolean; fields: { field: string }[] }[];
  changeSetId: string | null;
}

async function templateRow(id: string) {
  const [row] = await db.select().from(schema.template).where(eq(schema.template.id, id));
  return assertDefined(row);
}

async function seeded() {
  const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
  const client = await connectCatalog(registerTools, seed.ctx);
  const call = (args: Record<string, unknown>) =>
    client.callTool({ name: 'define_template', arguments: { orgId: seed.orgId, ...args } });
  return { seed, call };
}

/** Create one canonical private task draft and return its id and revision. */
async function canonicalDraft(call: Awaited<ReturnType<typeof seeded>>['call']) {
  const created = await call({
    action: 'draft',
    name: 'Bug triage',
    defaultStatusKey: null,
    payload: { targetType: 'task', title: 'Bug: ' },
  });
  expect(created.isError, errorText(created)).not.toBe(true);
  const result = body<TemplateResult>(created);
  return { id: assertDefined(result.changes[0]).id, revision: result.revision };
}

describe('define_template canonical authoring refusals', () => {
  it('requires a reviewed revision and preserved visibility when editing a draft', async () => {
    const { call } = await seeded();
    const draft = await canonicalDraft(call);

    const unrevised = await call({ action: 'draft', template: draft.id, name: 'Renamed' });
    expect(unrevised.isError).toBe(true);
    expect(errorText(unrevised)).toContain('expectedRevision');

    const rescoped = await call({
      action: 'draft',
      template: draft.id,
      expectedRevision: draft.revision,
      scope: 'organization',
    });
    expect(rescoped.isError).toBe(true);
    expect(errorText(rescoped)).toContain('scope');
    expect((await templateRow(draft.id)).scope).toBe('personal');
  });

  it('refuses to publish without naming an existing template', async () => {
    const { call } = await seeded();

    const result = await call({ action: 'publish', expectedRevision: 0 });

    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain('template');
  });

  it('changes only the labels of a canonical draft, keeping its unpublished payload', async () => {
    const { seed, call } = await seeded();
    const bugId = await seedLabel(db, schema, seed, { name: 'Bug' });
    const draft = await canonicalDraft(call);

    const edited = await call({
      action: 'draft',
      template: draft.id,
      expectedRevision: draft.revision,
      labels: ['bug'],
    });

    expect(edited.isError, errorText(edited)).not.toBe(true);
    expect((await templateRow(draft.id)).draftDefinition).toMatchObject({
      payload: { targetType: 'task', title: 'Bug: ', labelIds: [bugId] },
    });
  });
});

describe('define_template legacy writes', () => {
  it('reports an edit that changes nothing as matched with no receipt', async () => {
    const { call } = await seeded();
    const created = body<TemplateResult>(
      await call({ name: 'Weekly sync', payload: { targetType: 'task', title: 'Sync' } }),
    );
    const id = assertDefined(created.changes[0]).id;

    const repeated = body<TemplateResult>(await call({ template: id, name: 'Weekly sync' }));

    expect(repeated.changed).toBe(0);
    expect(repeated.changes[0]).toMatchObject({ matched: true, fields: [] });
    expect(repeated.changeSetId).toBeNull();
  });

  it('keeps a team template’s team when only its labels change', async () => {
    const { seed, call } = await seeded();
    await joinTeam(db, schema, seed, seed.teamId);
    const coreLabel = await seedLabel(db, schema, seed, { name: 'Core bug', teamId: seed.teamId });
    const created = body<TemplateResult>(
      await call({
        name: 'Core bug',
        scope: 'team',
        team: 'Core',
        payload: { targetType: 'task', title: 'Bug: ' },
      }),
    );
    const id = assertDefined(created.changes[0]).id;

    const edited = await call({ template: id, labels: ['core bug'] });

    expect(edited.isError, errorText(edited)).not.toBe(true);
    expect(await templateRow(id)).toMatchObject({
      teamId: seed.teamId,
      payload: { labelIds: [coreLabel] },
    });
  });

  it('refuses a team template that names no team', async () => {
    const { seed, call } = await seeded();

    const result = await call({
      name: 'Teamless',
      scope: 'team',
      payload: { targetType: 'task', title: 'x' },
    });

    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain('teamId');
    expect(
      await db
        .select()
        .from(schema.template)
        .where(eq(schema.template.organizationId, seed.orgId))
        .then((rows) => rows.filter((row) => row.name === 'Teamless')),
    ).toHaveLength(0);
  });
});

describe('prepareTemplateProposal', () => {
  it('refuses another workspace and lifecycle actions', async () => {
    const { prepareTemplateProposal } = await import('../../src/mcp/template-tools');
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const other = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const raw = { name: 'Event', payload: { targetType: 'project', description: 'Plan' } };
    await expect(
      prepareTemplateProposal(seed.orgId, seed.actorId, { orgId: other.orgId, ...raw }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      prepareTemplateProposal(seed.orgId, seed.actorId, {
        orgId: seed.orgId,
        action: 'archive',
        template: 'Event',
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('builds an edit proposal from the reviewed revision of an existing draft', async () => {
    const { prepareTemplateProposal } = await import('../../src/mcp/template-tools');
    const { seed, call } = await seeded();
    const draft = await canonicalDraft(call);

    const proposal = await prepareTemplateProposal(seed.orgId, seed.actorId, {
      orgId: seed.orgId,
      template: draft.id,
      expectedRevision: draft.revision,
      name: 'Bug intake',
    });
    expect(proposal.definition).toMatchObject({
      name: 'Bug intake',
      payload: { targetType: 'task', title: 'Bug: ' },
    });
    expect(proposal.input).toMatchObject({ template: draft.id, name: 'Bug intake' });

    await expect(
      prepareTemplateProposal(seed.orgId, seed.actorId, {
        orgId: seed.orgId,
        template: draft.id,
        expectedRevision: draft.revision + 1,
        name: 'Bug intake',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

/** Open a routine-autonomy Athena toolbox for the seeded human. */
async function automated(seed: McpUpdateSeed) {
  if (seed.ctx.principal.kind !== 'user') throw new Error('Human fixture required');
  const userId = seed.ctx.principal.userId;
  await db.insert(schema.hub).values({
    userId,
    preferences: { athena: { approvalMode: 'routine_autonomy' } },
  });
  const [session] = await db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: userId,
      contextOrganizationId: seed.orgId,
      trigger: 'delegation',
      status: 'running',
    })
    .returning();
  const { openToolbox } = await import('../../src/agent/toolbox');
  const toolbox = await openToolbox(
    { kind: 'athena', ownerUserId: userId },
    assertDefined(session).id,
  );
  opened.push(toolbox);
  return { toolbox, session: assertDefined(session) };
}

describe('define_template automated drafts', () => {
  it('edits its own private draft in place with a receipt and a review proposal', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const { toolbox, session } = await automated(seed);
    const created = await toolbox.callTool('define_template', {
      orgId: seed.orgId,
      name: 'Event',
      payload: { targetType: 'project', description: 'Prepare event' },
    });
    expect(created.isError, created.content).toBe(false);
    const first = JSON.parse(created.content) as TemplateResult;
    const id = assertDefined(first.changes[0]).id;

    const edited = await toolbox.callTool('define_template', {
      orgId: seed.orgId,
      template: id,
      expectedRevision: first.revision,
      name: 'Neighborhood event',
    });

    expect(edited.isError, edited.content).toBe(false);
    const second = JSON.parse(edited.content) as TemplateResult;
    expect(second.changes[0]?.id).toBe(id);
    expect(second.changeSetId).not.toBeNull();
    expect(second.revision).toBeGreaterThan(first.revision);
    expect(await templateRow(id)).toMatchObject({ ownerActorId: seed.actorId, scope: 'personal' });
    const proposals = await db
      .select()
      .from(schema.sessionTemplateProposal)
      .where(eq(schema.sessionTemplateProposal.sessionId, session.id));
    expect(proposals.map((row) => row.templateId)).toEqual([id, id]);
  });

  it('refuses an automated edit that names nothing to change', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const { toolbox } = await automated(seed);
    const created = await toolbox.callTool('define_template', {
      orgId: seed.orgId,
      name: 'Event',
      payload: { targetType: 'project', description: 'Prepare event' },
    });
    const first = JSON.parse(created.content) as TemplateResult;

    const result = await toolbox.callTool('define_template', {
      orgId: seed.orgId,
      template: assertDefined(first.changes[0]).id,
      expectedRevision: first.revision,
    });

    expect(result.isError).toBe(true);
  });
});
