/**
 * `@docket/api` — applying a Notion edit back onto an existing two-way entity.
 *
 * @remarks
 * `applyPulledValues` is deliberately narrower than the full projection catalog
 * (`loadEntityRows`): person fields, `docketUrl`, and `task.state` are excluded on purpose — see
 * the function's own doc comment for why. These tests pin that boundary as much as the fields that
 * ARE applied, so a future change cannot silently widen or narrow it without a test noticing.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { MirrorValue } from '@docket/connections/notion/mirror-values';

import type {
  adoptEntity as AdoptEntity,
  applyPulledValues as ApplyPulledValues,
} from '../../src/routes/notion-mirror-entities';
import type { IntegrationRow } from '../../src/routes/integration-provider';
import { getDb, seedBaseOrg } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let applyPulledValues!: typeof ApplyPulledValues;
let adoptEntity!: typeof AdoptEntity;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  ({ applyPulledValues, adoptEntity } = await import('../../src/routes/notion-mirror-entities'));
});

/** Insert a Notion integration row for `resolveImportTeam` to read `config.teamId` off. */
async function seedNotionIntegration(
  orgId: string,
  config: Record<string, unknown> = {},
): Promise<IntegrationRow> {
  const [row] = await db
    .insert(schema.integration)
    .values({ organizationId: orgId, provider: 'notion', pattern: 'connector', config })
    .returning();
  if (!row) throw new Error('seedNotionIntegration failed to create an integration row');
  return row;
}

const text = (value: string | null): MirrorValue => ({ kind: 'text', value });
const num = (value: number | null): MirrorValue => ({ kind: 'number', value });
const date = (value: string | null): MirrorValue => ({ kind: 'date', value });
const option = (value: string | null): MirrorValue => ({ kind: 'option', value });

describe('applyPulledValues — task', () => {
  it('applies title, description, dates, estimate, and priority', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const [row] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Old title',
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    const taskId = assertDefined(row).id;

    const applied = await applyPulledValues(orgId, humanActorId, 'task', taskId, {
      title: text('New title, from Notion'),
      description: text('Notion wrote this'),
      dueDate: date('2026-09-01'),
      startDate: date('2026-08-15'),
      estimateMinutes: num(90),
      priority: option('high'),
    });
    expect(applied).toBe(true);

    const [updated] = await db.select().from(schema.task).where(eq(schema.task.id, taskId));
    expect(updated).toMatchObject({
      title: 'New title, from Notion',
      description: 'Notion wrote this',
      estimateMinutes: 90,
      priority: 'high',
    });
    expect(assertDefined(updated).dueDate?.toISOString().slice(0, 10)).toBe('2026-09-01');
    expect(assertDefined(updated).startDate?.toISOString().slice(0, 10)).toBe('2026-08-15');
  });

  it('substitutes "Untitled" for an emptied title rather than violating the not-blank column', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const [row] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Had a title',
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });

    await applyPulledValues(orgId, humanActorId, 'task', assertDefined(row).id, {
      title: text(null),
    });

    const [updated] = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, assertDefined(row).id));
    expect(assertDefined(updated).title).toBe('Untitled');
  });

  it('ignores an unrecognized priority option rather than writing an invalid enum value', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const [row] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Keep my priority',
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
        priority: 'medium',
      })
      .returning({ id: schema.task.id });

    // A Notion workspace can rename or invent select options freely; "Someday" is not one of
    // Docket's five priority values.
    await applyPulledValues(orgId, humanActorId, 'task', assertDefined(row).id, {
      priority: option('Someday'),
    });

    const [updated] = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, assertDefined(row).id));
    expect(assertDefined(updated).priority).toBe('medium');
  });

  it('leaves state, assignee, and every other unpulled field untouched', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const [row] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Assigned already',
        state: 'in_progress',
        statusId: statusId('task', 'in_progress'),
        assigneeId: humanActorId,
      })
      .returning({ id: schema.task.id });

    // A field this reader has no opinion on when Notion did not report one (assignee is
    // name-based and ambiguous to reverse; state was simply not in this pull) must survive.
    await applyPulledValues(orgId, humanActorId, 'task', assertDefined(row).id, {
      description: text('unrelated edit'),
    });

    const [updated] = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, assertDefined(row).id));
    expect(assertDefined(updated).state).toBe('in_progress');
    expect(assertDefined(updated).assigneeId).toBe(humanActorId);
  });

  it('returns false and touches nothing for an archived task', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const [row] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Archived',
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
        archivedAt: new Date(),
      })
      .returning({ id: schema.task.id });

    const applied = await applyPulledValues(orgId, humanActorId, 'task', assertDefined(row).id, {
      title: text('Revived?'),
    });
    expect(applied).toBe(false);

    const [unchanged] = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, assertDefined(row).id));
    expect(assertDefined(unchanged).title).toBe('Archived');
  });

  it('is a no-op when the values object carries nothing this entity applies', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const [row] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Unaffected',
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });

    // Only assignee/docketUrl reported — neither is applied by this function.
    const applied = await applyPulledValues(orgId, humanActorId, 'task', assertDefined(row).id, {
      assignee: text('Someone'),
      docketUrl: { kind: 'url', value: '/orgs/x/tasks/y' },
    });
    expect(applied).toBe(true);

    const [unchanged] = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, assertDefined(row).id));
    expect(assertDefined(unchanged).title).toBe('Unaffected');
  });

  it('transitions to a recognized state via the shared setTaskState path', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    // seedBaseOrg's team carries no explicit workflow, so its default states apply — 'backlog'
    // (unstarted) is the open key setTaskState/resolveStateTransition will accept.
    const [row] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'To be started',
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });

    const applied = await applyPulledValues(orgId, humanActorId, 'task', assertDefined(row).id, {
      title: text('To be started'),
      state: option('backlog'),
    });
    expect(applied).toBe(true);

    const [updated] = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, assertDefined(row).id));
    expect(assertDefined(updated).state).toBe('backlog');
  });

  it('ignores an unrecognized state name rather than throwing the whole pull', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const [row] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Keep my state',
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });

    // A team's workflow does not contain an arbitrary Notion-authored name.
    const applied = await applyPulledValues(orgId, humanActorId, 'task', assertDefined(row).id, {
      state: option('Definitely Not A Real State'),
    });
    expect(applied).toBe(true);

    const [updated] = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, assertDefined(row).id));
    expect(assertDefined(updated).state).toBe('backlog');
  });
});

describe('applyPulledValues — project', () => {
  it('applies name, summary, dates, status, and health', async () => {
    const { orgId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const [row] = await db
      .insert(schema.project)
      .values({
        organizationId: orgId,
        name: 'Old name',
        status: 'planned',
        statusId: statusId('project', 'planned'),
      })
      .returning({ id: schema.project.id });
    const projectId = assertDefined(row).id;

    const applied = await applyPulledValues(orgId, humanActorId, 'project', projectId, {
      name: text('Renamed in Notion'),
      summary: text('New summary'),
      targetDate: date('2026-12-01'),
      startDate: date('2026-10-01'),
      status: option('active'),
      health: option('at_risk'),
    });
    expect(applied).toBe(true);

    const [updated] = await db
      .select()
      .from(schema.project)
      .where(eq(schema.project.id, projectId));
    expect(updated).toMatchObject({
      name: 'Renamed in Notion',
      summary: 'New summary',
      status: 'active',
      health: 'at_risk',
    });
    expect(assertDefined(updated).targetDate?.toISOString().slice(0, 10)).toBe('2026-12-01');
  });

  it('ignores an unrecognized status/health option', async () => {
    const { orgId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const [row] = await db
      .insert(schema.project)
      .values({
        organizationId: orgId,
        name: 'Keep my status',
        status: 'active',
        statusId: statusId('project', 'active'),
      })
      .returning({ id: schema.project.id });

    await applyPulledValues(orgId, humanActorId, 'project', assertDefined(row).id, {
      status: option('Not a real status'),
      health: option('Not a real health'),
    });

    const [updated] = await db
      .select()
      .from(schema.project)
      .where(eq(schema.project.id, assertDefined(row).id));
    expect(assertDefined(updated).status).toBe('active');
    expect(assertDefined(updated).health).toBeNull();
  });
});

describe('applyPulledValues — every other entity', () => {
  it('is a documented no-op for push-only entities, never reached by a real pull', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const applied = await applyPulledValues(orgId, humanActorId, 'initiative', 'nonexistent', {
      name: text('x'),
    });
    expect(applied).toBe(false);
  });
});

describe('adoptEntity — task', () => {
  it('lands in the org’s earliest-created team when no config.teamId is set', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationRow = await seedNotionIntegration(orgId);

    const entityId = await adoptEntity(orgId, humanActorId, integrationRow, 'task', {
      title: text('Made in Notion'),
      description: text('Row created directly in the workspace'),
      dueDate: date('2026-09-10'),
      estimateMinutes: num(30),
      priority: option('urgent'),
    });
    expect(entityId).toBeDefined();

    const [created] = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, assertDefined(entityId)));
    expect(created).toMatchObject({
      organizationId: orgId,
      teamId,
      title: 'Made in Notion',
      description: 'Row created directly in the workspace',
      estimateMinutes: 30,
      priority: 'urgent',
      source: 'native',
      createdBy: humanActorId,
    });
    expect(assertDefined(created).dueDate?.toISOString().slice(0, 10)).toBe('2026-09-10');
    // The team's own open-type state, not anything read from Notion — see adoptTask's doc comment.
    expect(assertDefined(created).state).toBeTruthy();
  });

  it('honors config.teamId over the earliest-created team', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const [namedTeam] = await db
      .insert(schema.team)
      .values({ organizationId: orgId, name: 'Design', key: 'DSN' })
      .returning({ id: schema.team.id });
    const integrationRow = await seedNotionIntegration(orgId, {
      teamId: assertDefined(namedTeam).id,
    });

    const entityId = await adoptEntity(orgId, humanActorId, integrationRow, 'task', {
      title: text('Configured landing team'),
    });

    const [created] = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, assertDefined(entityId)));
    expect(assertDefined(created).teamId).toBe(assertDefined(namedTeam).id);
  });

  it('falls back to "Untitled" for a titleless adopted task', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationRow = await seedNotionIntegration(orgId);

    const entityId = await adoptEntity(orgId, humanActorId, integrationRow, 'task', {});

    const [created] = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, assertDefined(entityId)));
    expect(assertDefined(created).title).toBe('Untitled');
  });

  it('ignores an unrecognized priority option and keeps the column default', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationRow = await seedNotionIntegration(orgId);

    const entityId = await adoptEntity(orgId, humanActorId, integrationRow, 'task', {
      title: text('x'),
      priority: option('Someday'),
    });

    const [created] = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, assertDefined(entityId)));
    expect(assertDefined(created).priority).toBe('none');
  });
});

describe('adoptEntity — project', () => {
  it('creates a project in the resolved landing team', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationRow = await seedNotionIntegration(orgId);

    const entityId = await adoptEntity(orgId, humanActorId, integrationRow, 'project', {
      name: text('Made in Notion'),
      summary: text('A project someone started in the workspace'),
      targetDate: date('2026-11-01'),
      status: option('active'),
      health: option('on_track'),
    });
    expect(entityId).toBeDefined();

    const [created] = await db
      .select()
      .from(schema.project)
      .where(eq(schema.project.id, assertDefined(entityId)));
    expect(created).toMatchObject({
      organizationId: orgId,
      teamId,
      name: 'Made in Notion',
      summary: 'A project someone started in the workspace',
      status: 'active',
      health: 'on_track',
    });
  });
});

describe('adoptEntity — every other entity', () => {
  it('is a documented no-op for push-only entities, never reached by a real adopt', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationRow = await seedNotionIntegration(orgId);
    const entityId = await adoptEntity(orgId, humanActorId, integrationRow, 'initiative', {
      name: text('x'),
    });
    expect(entityId).toBeUndefined();
  });
});
