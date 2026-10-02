/** Both confirmation entry points enforce template and label boundaries. */
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertDefined } from '@docket/test-utils';
import { LabelId } from '@docket/work/ids';
import type { commitOwnedPlan as CommitOwnedPlan } from '../../src/lib/plan-draft/commit';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { getMigratedDb } from '../support/db';
import { resetAuthMocks } from '../support/auth-mock';
import {
  body,
  closeCatalogClients,
  connectCatalog,
  seedLabel,
  seedSecondTeam,
  joinTeam,
} from './mcp-catalog-harness';
import { seedMcpUpdateOrg } from './mcp-update-tool-fixtures';
import { appProvenance, runWithProvenance } from '../../src/lib/provenance/context';

let schema!: typeof DbModule;
let registerTools!: typeof RegisterTools;
let commitOwnedPlan!: typeof CommitOwnedPlan;
type Seed = Awaited<ReturnType<typeof seedMcpUpdateOrg>>;
beforeAll(async () => {
  schema = await getMigratedDb();
  registerTools = (await import('../../src/mcp/tools')).registerTools;
  commitOwnedPlan = (await import('../../src/lib/plan-draft/commit')).commitOwnedPlan;
});
afterEach(async () => {
  await closeCatalogClients();
  resetAuthMocks();
});

/** The seed always represents the human owner of its plans. */
function owner(seed: Seed): string {
  if (seed.ctx.principal.kind === 'user') return seed.ctx.principal.userId;
  throw new Error('Expected a human seed');
}

/** Run human confirmation under the same app provenance as the REST entry point. */
function confirm(seed: Seed, planId: string): ReturnType<typeof commitOwnedPlan> {
  return runWithProvenance(appProvenance(), () => commitOwnedPlan(owner(seed), planId, ['t']));
}

/** Prepare a task under the ancestors human confirmation must create with it. */
async function taskPlan(
  seed: Seed,
  templateId: string,
  options: { apply?: boolean; teamId?: string; labelIds?: string[] } = {},
): Promise<string> {
  const client = await connectCatalog(registerTools, seed.ctx);
  const started = body<{ planId: string }>(
    await client.callTool({ name: 'plan_start', arguments: { orgId: seed.orgId } }),
  );
  const ops: Record<string, unknown>[] = [
    {
      op: 'upsert_node',
      node: { ref: 'i', kind: 'initiative', fields: { title: 'Boundary strategy' } },
    },
    {
      op: 'upsert_node',
      node: { ref: 'p', kind: 'project', parentRef: 'i', fields: { title: 'Boundary project' } },
    },
    {
      op: 'upsert_node',
      node: {
        ref: 't',
        kind: 'task',
        parentRef: 'p',
        templateId,
        fields: {
          title: 'Boundary task',
          description: 'Authored content',
          ...(options.teamId ? { teamId: options.teamId } : {}),
        },
      },
    },
  ];
  if (options.apply) ops.push({ op: 'apply_template', ref: 't', templateId });
  if (options.labelIds)
    ops.push({ op: 'set_fields', ref: 't', fields: { labelIds: options.labelIds } });
  const drafted = await client.callTool({
    name: 'plan_draft',
    arguments: { planId: started.planId, revision: 0, ops },
  });
  expect(drafted.isError).not.toBe(true);
  return started.planId;
}

/** Construct references the human commit path must refuse even when authored fields are present. */
async function invalidReference(
  seed: Seed,
  reason: string,
): Promise<{ templateId: string; teamId?: string }> {
  const source =
    reason === 'foreign' ? await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']) : seed;
  const targetType = reason === 'kind' ? 'project' : 'task';
  if (reason === 'team') await joinTeam(schema.db, schema, seed, seed.teamId);
  const [saved] = await schema.db
    .insert(schema.template)
    .values({
      organizationId: source.orgId,
      ownerActorId: reason === 'private' ? seed.sarahId : source.actorId,
      name: 'Unavailable outline',
      targetType,
      payload: { targetType },
      scope: reason === 'team' ? 'team' : 'personal',
      ...(reason === 'team' ? { teamId: seed.teamId } : {}),
    })
    .returning();
  const templateId = assertDefined(saved).id;
  if (reason === 'deleted')
    await schema.db.delete(schema.template).where(eq(schema.template.id, templateId));
  return {
    templateId,
    ...(reason === 'team' ? { teamId: await seedSecondTeam(schema.db, schema, seed) } : {}),
  };
}

describe('shared plan template boundaries', () => {
  it.each(['foreign', 'private', 'kind', 'team', 'deleted'])(
    'human confirmation rejects a %s template reference',
    async (reason) => {
      const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
      const reference = await invalidReference(seed, reason);
      const planId = await taskPlan(seed, reference.templateId, reference);
      await expect(confirm(seed, planId)).rejects.toMatchObject({
        code: reason === 'kind' || reason === 'team' ? 'validation_error' : 'not_found',
      });
      expect(
        await schema.db
          .select()
          .from(schema.task)
          .where(eq(schema.task.organizationId, seed.orgId)),
      ).toHaveLength(0);
    },
  );

  it.each(['before', 'after', 'after-template-edit'])(
    'confirmation drops inherited labels deleted %s template application',
    async (when) => {
      const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
      const live = await seedLabel(schema.db, schema, seed, { name: 'Live' });
      const removed = await seedLabel(schema.db, schema, seed, { name: 'Removed' });
      const [saved] = await schema.db
        .insert(schema.template)
        .values({
          organizationId: seed.orgId,
          ownerActorId: seed.actorId,
          name: 'Stale labels',
          targetType: 'task',
          scope: 'personal',
          payload: { targetType: 'task', labelIds: [LabelId.parse(live), LabelId.parse(removed)] },
        })
        .returning();
      if (when === 'before')
        await schema.db.delete(schema.label).where(eq(schema.label.id, removed));
      const planId = await taskPlan(seed, assertDefined(saved).id, { apply: true });
      if (when === 'after-template-edit')
        await schema.db
          .update(schema.template)
          .set({ payload: { targetType: 'task', labelIds: [LabelId.parse(live)] } })
          .where(eq(schema.template.id, assertDefined(saved).id));
      if (when !== 'before')
        await schema.db.delete(schema.label).where(eq(schema.label.id, removed));
      const result = await confirm(seed, planId);
      const taskId = assertDefined(result.placed.find((entry) => entry.kind === 'task')).id;
      const labels = await schema.db
        .select()
        .from(schema.taskLabel)
        .where(eq(schema.taskLabel.taskId, taskId));
      expect(labels.map((label) => label.labelId)).toEqual([live]);
    },
  );

  it.each(['different', 'equal'])(
    'refuses explicit unavailable labels %s to template defaults',
    async (selection) => {
      const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
      const live = await seedLabel(schema.db, schema, seed, { name: 'Live' });
      const removed = await seedLabel(schema.db, schema, seed, { name: 'Removed' });
      const [saved] = await schema.db
        .insert(schema.template)
        .values({
          organizationId: seed.orgId,
          ownerActorId: seed.actorId,
          name: 'Explicit labels',
          targetType: 'task',
          scope: 'personal',
          payload: {
            targetType: 'task',
            labelIds: selection === 'equal' ? [LabelId.parse(removed)] : [LabelId.parse(live)],
          },
        })
        .returning();
      await schema.db.delete(schema.label).where(eq(schema.label.id, removed));
      const planId = await taskPlan(seed, assertDefined(saved).id, {
        apply: true,
        labelIds: [removed],
      });
      await expect(confirm(seed, planId)).rejects.toMatchObject({ code: 'not_found' });
    },
  );
});
