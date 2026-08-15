/**
 * `@docket/api` — the closed voice tool surface: what Athena can do mid-call.
 *
 * @remarks
 * Every tool here acts against the real database, so these tests seed a real workspace and assert
 * on real rows, not on call logs. The "refuse rather than guess" cases (ambiguous completion, no
 * workspace) matter as much as the happy paths: a phone call cannot show a diff to confirm against.
 */
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type { DocketVoiceToolRunner as DocketVoiceToolRunnerClass } from '../../src/routes/voice-tools';
import type { VoiceSessionContext } from '../../src/routes/voice-engine';
import {
  addMember,
  getDb,
  seedBaseOrg,
  seedOrg,
  seedTaskAccessOrg,
  seedUserWithHub,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let DocketVoiceToolRunner!: typeof DocketVoiceToolRunnerClass;
let workspaceHasTeam!: (organizationId: string) => Promise<boolean>;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  ({ DocketVoiceToolRunner, workspaceHasTeam } = await import('../../src/routes/voice-tools'));
});

async function ctxFor(orgId: string | null, userId: string, actorId: string | null = null) {
  return {
    voiceSessionId: 'voice_1',
    conversationId: 'conv_1',
    userId,
    organizationId: orgId,
    channel: 'phone',
    initiatorActorId: actorId,
  } satisfies VoiceSessionContext;
}

describe('DocketVoiceToolRunner', () => {
  it('exposes the three closed tool definitions verbatim', () => {
    const runner = new DocketVoiceToolRunner();
    expect(runner.definitions.map((d) => d.name)).toEqual([
      'create_task',
      'list_open_tasks',
      'complete_task',
    ]);
  });

  it('reports an unknown tool name as a model error, not a system error', async () => {
    const runner = new DocketVoiceToolRunner();
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'VoiceUnknownTool');
    const outcome = await runner.run(
      await ctxFor(orgId, userId, humanActorId),
      'delete_everything',
      {},
    );
    expect(outcome).toEqual({
      ok: false,
      summary: 'I do not have a way to do that over voice yet.',
    });
  });

  describe('create_task', () => {
    it('creates a task titled from the spoken words, with notes attached', async () => {
      const runner = new DocketVoiceToolRunner();
      const { orgId, humanActorId } = await seedTaskAccessOrg(db, schema);
      const userId = await seedUserWithHub(db, schema, 'VoiceCreate');

      const outcome = await runner.run(await ctxFor(orgId, userId, humanActorId), 'create_task', {
        title: 'Call the plumber',
        notes: 'Kitchen sink is leaking',
      });
      expect(outcome.ok).toBe(true);
      expect(outcome.summary).toContain('Call the plumber');

      const [row] = await db
        .select()
        .from(schema.task)
        .where(eq(schema.task.organizationId, orgId));
      expect(row).toMatchObject({
        title: 'Call the plumber',
        description: 'Kitchen sink is leaking',
        createdBy: humanActorId,
      });
    });

    it('refuses without a title', async () => {
      const runner = new DocketVoiceToolRunner();
      const { orgId, humanActorId } = await seedBaseOrg(db, schema);
      const userId = await seedUserWithHub(db, schema, 'VoiceCreateNoTitle');
      const outcome = await runner.run(
        await ctxFor(orgId, userId, humanActorId),
        'create_task',
        {},
      );
      expect(outcome).toEqual({ ok: false, summary: 'I need a name for that task.' });
    });

    it('refuses when the session carries no workspace', async () => {
      const runner = new DocketVoiceToolRunner();
      const userId = await seedUserWithHub(db, schema, 'VoiceCreateNoOrg');
      const outcome = await runner.run(await ctxFor(null, userId, null), 'create_task', {
        title: 'Anything',
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.summary).toContain('workspace');
    });

    it('refuses to create work when the session lacks an authoritative actor', async () => {
      const runner = new DocketVoiceToolRunner();
      const { orgId } = await seedBaseOrg(db, schema);
      const userId = await seedUserWithHub(db, schema, 'VoiceCreateResolveActor');

      const outcome = await runner.run(await ctxFor(orgId, userId, null), 'create_task', {
        title: 'Resolved via actor lookup',
      });
      expect(outcome.ok).toBe(false);
      const rows = await db
        .select({ id: schema.task.id })
        .from(schema.task)
        .where(eq(schema.task.title, 'Resolved via actor lookup'));
      expect(rows).toHaveLength(0);
    });

    it('refuses when the workspace has no team to land the task in', async () => {
      const runner = new DocketVoiceToolRunner();
      const orgId = await seedOrgWithoutTeam();
      const userId = await seedUserWithHub(db, schema, 'VoiceCreateNoTeam');
      const actorId = await addMember(db, schema, orgId, userId);
      const outcome = await runner.run(await ctxFor(orgId, userId, actorId), 'create_task', {
        title: 'Nowhere to land',
      });
      expect(outcome).toEqual({
        ok: false,
        summary: 'That workspace has no team to file work into yet, so I can’t add it there.',
      });
    });

    it('requires contribute on the selected landing team, not a non-cascading org grant', async () => {
      const runner = new DocketVoiceToolRunner();
      const { orgId, humanActorId } = await seedBaseOrg(db, schema);
      const userId = await seedUserWithHub(db, schema, 'VoiceCreateOrgOnly');
      await db.insert(schema.grant).values({
        organizationId: orgId,
        subjectKind: 'actor',
        subjectId: humanActorId,
        resourceKind: 'organization',
        resourceId: orgId,
        capabilities: ['contribute'],
        effect: 'allow',
        cascades: false,
      });

      const outcome = await runner.run(await ctxFor(orgId, userId, humanActorId), 'create_task', {
        title: 'Should not be created',
      });
      expect(outcome.ok).toBe(false);
      const rows = await db
        .select({ id: schema.task.id })
        .from(schema.task)
        .where(eq(schema.task.title, 'Should not be created'));
      expect(rows).toHaveLength(0);
    });
  });

  describe('list_open_tasks', () => {
    it('reports nothing open when there are no open tasks', async () => {
      const runner = new DocketVoiceToolRunner();
      const { orgId, humanActorId } = await seedBaseOrg(db, schema);
      const userId = await seedUserWithHub(db, schema, 'VoiceListEmpty');
      const outcome = await runner.run(
        await ctxFor(orgId, userId, humanActorId),
        'list_open_tasks',
        {},
      );
      expect(outcome).toEqual({ ok: true, summary: 'Nothing open right now.' });
    });

    it('reads back at most five open tasks, excluding completed/canceled/archived ones', async () => {
      const runner = new DocketVoiceToolRunner();
      const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
      const userId = await seedUserWithHub(db, schema, 'VoiceListSome');
      for (let i = 0; i < 7; i += 1) {
        await db.insert(schema.task).values({
          organizationId: orgId,
          title: `Open ${String(i)}`,
          teamId,
          state: 'backlog',
        });
      }
      await db.insert(schema.task).values({
        organizationId: orgId,
        title: 'Already done',
        teamId,
        state: 'done',
        completedAt: new Date(),
      });

      const outcome = await runner.run(
        await ctxFor(orgId, userId, humanActorId),
        'list_open_tasks',
        {},
      );
      expect(outcome.ok).toBe(true);
      expect(outcome.summary).toMatch(/^5 open:/);
      expect(outcome.summary).not.toContain('Already done');
    });

    it('does not speak private task titles until a current direct grant makes them visible', async () => {
      const runner = new DocketVoiceToolRunner();
      const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
      const userId = await seedUserWithHub(db, schema, 'VoicePrivateList');
      const [privateTask] = await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Board compensation draft',
          teamId,
          state: 'backlog',
          visibility: 'private',
        })
        .returning({ id: schema.task.id });

      const ctx = await ctxFor(orgId, userId, humanActorId);
      expect(await runner.run(ctx, 'list_open_tasks', {})).toEqual({
        ok: true,
        summary: 'Nothing open right now.',
      });
      const hiddenComplete = await runner.run(ctx, 'complete_task', { title: 'compensation' });
      expect(hiddenComplete.ok).toBe(false);
      const [stillOpen] = await db
        .select({ completedAt: schema.task.completedAt })
        .from(schema.task)
        .where(eq(schema.task.id, privateTask!.id));
      expect(stillOpen?.completedAt).toBeNull();

      await db.insert(schema.grant).values({
        organizationId: orgId,
        subjectKind: 'actor',
        subjectId: humanActorId,
        resourceKind: 'task',
        resourceId: privateTask!.id,
        capabilities: ['contribute'],
        effect: 'allow',
        cascades: false,
      });

      expect(await runner.run(ctx, 'list_open_tasks', {})).toEqual({
        ok: true,
        summary: '1 open: Board compensation draft.',
      });
      expect(await runner.run(ctx, 'complete_task', { title: 'compensation' })).toEqual({
        ok: true,
        summary: 'Closed “Board compensation draft”.',
      });
    });

    it('lets an active member hear public work but not complete it without contribute', async () => {
      const runner = new DocketVoiceToolRunner();
      const userId = await seedUserWithHub(db, schema, 'VoicePublicMember');
      const orgId = await seedOrg(db, schema);
      const [team] = await db
        .insert(schema.team)
        .values({
          organizationId: orgId,
          name: 'Core',
          key: `P${Math.random().toString(36).slice(2, 6)}`,
        })
        .returning({ id: schema.team.id });
      const actorId = await addMember(db, schema, orgId, userId, 'member');
      const [publicTask] = await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Publish notes',
          teamId: team!.id,
          state: 'backlog',
        })
        .returning({ id: schema.task.id });

      const ctx = await ctxFor(orgId, userId, actorId);
      expect((await runner.run(ctx, 'list_open_tasks', {})).summary).toContain('Publish notes');
      const outcome = await runner.run(ctx, 'complete_task', { title: 'publish' });
      expect(outcome.ok).toBe(false);
      const [stillOpen] = await db
        .select({ completedAt: schema.task.completedAt })
        .from(schema.task)
        .where(eq(schema.task.id, publicTask!.id));
      expect(stillOpen?.completedAt).toBeNull();
    });

    it('refuses without a workspace', async () => {
      const runner = new DocketVoiceToolRunner();
      const userId = await seedUserWithHub(db, schema, 'VoiceListNoOrg');
      const outcome = await runner.run(await ctxFor(null, userId, null), 'list_open_tasks', {});
      expect(outcome).toEqual({ ok: false, summary: 'I need to know which workspace to look in.' });
    });
  });

  describe('complete_task', () => {
    it('closes the one open task matching the spoken title', async () => {
      const runner = new DocketVoiceToolRunner();
      const { orgId, teamId, humanActorId } = await seedTaskAccessOrg(db, schema);
      const userId = await seedUserWithHub(db, schema, 'VoiceComplete');
      const [row] = await db
        .insert(schema.task)
        .values({ organizationId: orgId, title: 'Water the plants', teamId, state: 'backlog' })
        .returning({ id: schema.task.id });

      const outcome = await runner.run(await ctxFor(orgId, userId, humanActorId), 'complete_task', {
        title: 'water',
      });
      expect(outcome).toEqual({ ok: true, summary: 'Closed “Water the plants”.' });
      const [after] = await db.select().from(schema.task).where(eq(schema.task.id, row!.id));
      expect(after?.completedAt).not.toBeNull();
    });

    it('refuses without naming a task', async () => {
      const runner = new DocketVoiceToolRunner();
      const { orgId, humanActorId } = await seedBaseOrg(db, schema);
      const userId = await seedUserWithHub(db, schema, 'VoiceCompleteNoTitle');
      const outcome = await runner.run(
        await ctxFor(orgId, userId, humanActorId),
        'complete_task',
        {},
      );
      expect(outcome).toEqual({ ok: false, summary: 'Which one should I close?' });
    });

    it('refuses without a workspace', async () => {
      const runner = new DocketVoiceToolRunner();
      const userId = await seedUserWithHub(db, schema, 'VoiceCompleteNoOrg');
      const outcome = await runner.run(await ctxFor(null, userId, null), 'complete_task', {
        title: 'anything',
      });
      expect(outcome).toEqual({ ok: false, summary: 'I need to know which workspace to look in.' });
    });

    it('reports nothing found when no open task matches', async () => {
      const runner = new DocketVoiceToolRunner();
      const { orgId, humanActorId } = await seedBaseOrg(db, schema);
      const userId = await seedUserWithHub(db, schema, 'VoiceCompleteNoMatch');
      const outcome = await runner.run(await ctxFor(orgId, userId, humanActorId), 'complete_task', {
        title: 'does not exist',
      });
      expect(outcome).toEqual({ ok: false, summary: 'I don’t see an open “does not exist”.' });
    });

    it('refuses to guess when more than one open task matches', async () => {
      const runner = new DocketVoiceToolRunner();
      const { orgId, teamId, humanActorId } = await seedTaskAccessOrg(db, schema);
      const userId = await seedUserWithHub(db, schema, 'VoiceCompleteAmbiguous');
      await db.insert(schema.task).values([
        { organizationId: orgId, title: 'Email the team', teamId, state: 'backlog' },
        { organizationId: orgId, title: 'Email the client', teamId, state: 'backlog' },
      ]);
      const outcome = await runner.run(await ctxFor(orgId, userId, humanActorId), 'complete_task', {
        title: 'email',
      });
      expect(outcome).toEqual({ ok: false, summary: 'More than one matches “email”. Which one?' });
    });
  });
});

describe('workspaceHasTeam', () => {
  it('is true once a team exists and false for a fresh workspace', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    expect(await workspaceHasTeam(orgId)).toBe(true);
    expect(await workspaceHasTeam(await seedOrgWithoutTeam())).toBe(false);
  });
});

/** Seed a bare organization with no team, for the "nowhere to land" paths. */
async function seedOrgWithoutTeam(): Promise<string> {
  const slug = `org-noteam-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  return org!.id;
}
