import type * as DbModule from '@docket/db';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import { createWork } from '../../src/lib/work-creation/service';
import { requireScheduleAccess } from '../../src/lib/recurrence/schedule-access';
import meAthenaUndo from '../../src/routes/me-athena-undo';
import { undoPhoneCallChange } from '../../src/routes/phone-call-summary';
import projectsRouter from '../../src/routes/projects';
import tasksRouter from '../../src/routes/tasks';
import { nativeRuntimeFixture } from '../recurrence/work-schedule-native-runtime-fixture';
import { defaultScheduleFixture } from '../lib/program-default-schedules-fixture';
import { LinkHarness, seedRestrictedMember, userContext } from '../mcp/mcp-link-fixtures';
import { appWithActor, fakeSession, getDb, one, seedUserWithHub } from '../support/routes-harness';

let schema: typeof DbModule;
let harness: LinkHarness;
beforeAll(async () => {
  schema = await getDb();
  harness = new LinkHarness((await import('../../src/mcp/tools')).registerTools);
});
afterEach(async () => harness.closeAll());
async function ownUser(orgId: string, actorId: string) {
  const userId = await seedUserWithHub(schema.db, schema, 'Undo member');
  await schema.db.update(schema.actor).set({ userId }).where(eq(schema.actor.id, actorId));
  return userId;
}
async function revoke(orgId: string, actorId: string) {
  await schema.db
    .update(schema.grant)
    .set({ capabilities: ['view'] })
    .where(
      and(
        eq(schema.grant.organizationId, orgId),
        eq(schema.grant.subjectId, actorId),
        eq(schema.grant.resourceKind, 'organization'),
      ),
    );
}
async function nativeReceipt(source = false) {
  const f = await nativeRuntimeFixture(schema, true);
  const other = f.run.roots.find((root) => root.id !== f.root.id);
  if (!other) throw new Error('Missing other root');
  const response = source
    ? await appWithActor(projectsRouter, f.orgId, ['manage'], f.humanActorId).request(
        `/${other.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targetDate: '2026-10-12' }),
        },
      )
    : await appWithActor(tasksRouter, f.orgId, ['manage'], f.humanActorId).request(
        `/${f.venue.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dueDate: '2026-10-02' }),
        },
      );
  expect(response.status).toBe(200);
  const receipt = one(
    await schema.db
      .select()
      .from(schema.changeSet)
      .where(eq(schema.changeSet.organizationId, f.orgId))
      .orderBy(desc(schema.changeSet.id))
      .limit(1),
  );
  const entries = await schema.db
    .select()
    .from(schema.changeSetEntry)
    .where(eq(schema.changeSetEntry.changeSetId, receipt.id));
  expect(entries.some((entry) => entry.entityKind === 'native_schedule_date_ownership')).toBe(true);
  return { ...f, other, receipt };
}
async function unchangedNative(f: Awaited<ReturnType<typeof nativeReceipt>>) {
  const [receipt] = await schema.db
    .select()
    .from(schema.changeSet)
    .where(eq(schema.changeSet.id, f.receipt.id));
  expect(receipt?.undoneAt).toBeNull();
  const [run] = await schema.db
    .select()
    .from(schema.processOccurrence)
    .where(eq(schema.processOccurrence.id, f.run.occurrenceId));
  expect(run?.scheduleDateOwnership?.find((entry) => entry.id === f.venue.id)?.manual).toBe(true);
}
async function programReceipt() {
  const f = await defaultScheduleFixture(schema);
  const created = await createWork(f.command);
  if (!created.changeSetId) throw new Error('Missing receipt');
  const routine = one(
    await schema.db
      .select()
      .from(schema.recurrenceSeries)
      .where(eq(schema.recurrenceSeries.ownerProgramId, created.root.id)),
  );
  return { ...f, created, routine, receiptId: created.changeSetId };
}
async function programUnchanged(f: Awaited<ReturnType<typeof programReceipt>>) {
  const [program] = await schema.db
    .select()
    .from(schema.program)
    .where(eq(schema.program.id, f.created.root.id));
  const [routine] = await schema.db
    .select()
    .from(schema.recurrenceSeries)
    .where(eq(schema.recurrenceSeries.id, f.routine.id));
  const [receipt] = await schema.db
    .select()
    .from(schema.changeSet)
    .where(eq(schema.changeSet.id, f.receiptId));
  expect(program?.archivedAt).toBeNull();
  expect(routine?.status).toBe('active');
  expect(receipt?.undoneAt).toBeNull();
}
async function mcpUndo(userId: string, orgId: string, changeSetId: string) {
  const client = await harness.connect(userContext(userId, 'undo@example.com'));
  return client.callTool({ name: 'undo', arguments: { orgId, changeSetId } });
}
describe('public undo entrypoints recheck current protected work rights', () => {
  it('denies explicit MCP undo of another member’s Program and private routine', async () => {
    const f = await programReceipt();
    const context = await seedRestrictedMember({ schema, db: schema.db }, f, ['contribute']);
    const client = await harness.connect(context);
    const result = await client.callTool({
      name: 'undo',
      arguments: { orgId: f.orgId, changeSetId: f.receiptId },
    });
    expect(result.isError).toBe(true);
    await programUnchanged(f);
  });
  it('requires current Program Manage even when its routine creator can still manage the copy', async () => {
    const f = await programReceipt();
    const userId = await ownUser(f.orgId, f.humanActorId);
    await revoke(f.orgId, f.humanActorId);
    await schema.db
      .update(schema.grant)
      .set({ capabilities: ['contribute'], cascades: false })
      .where(
        and(
          eq(schema.grant.organizationId, f.orgId),
          eq(schema.grant.subjectId, f.humanActorId),
          eq(schema.grant.resourceKind, 'organization'),
        ),
      );
    await schema.db.insert(schema.grant).values({
      organizationId: f.orgId,
      subjectKind: 'actor',
      subjectId: f.humanActorId,
      resourceKind: 'program',
      resourceId: f.created.root.id,
      capabilities: ['view'],
      effect: 'allow',
    });
    expect(
      (
        await requireScheduleAccess(
          schema.db,
          { organizationId: f.orgId, actorId: f.humanActorId, seriesId: f.routine.id },
          'manage',
        )
      ).canEdit,
    ).toBe(true);
    expect((await mcpUndo(userId, f.orgId, f.receiptId)).isError).toBe(true);
    await programUnchanged(f);
  });
  it('lets the current manager undo the installed copies through actual MCP', async () => {
    const f = await programReceipt();
    const userId = await ownUser(f.orgId, f.humanActorId);
    expect((await mcpUndo(userId, f.orgId, f.receiptId)).isError ?? false).toBe(false);
    expect(
      one(
        await schema.db
          .select()
          .from(schema.recurrenceSeries)
          .where(eq(schema.recurrenceSeries.id, f.routine.id)),
      ).status,
    ).toBe('ended');
  });
  it('allows foreground native undo without access to its private schedule', async () => {
    const f = await nativeReceipt();
    const context = await seedRestrictedMember({ schema, db: schema.db }, f, ['contribute']);
    const client = await harness.connect(context);
    const contributor = one(
      await schema.db
        .select()
        .from(schema.actor)
        .where(
          eq(
            schema.actor.userId,
            context.principal.kind === 'user' ? context.principal.userId : 'invalid',
          ),
        ),
    );
    await schema.db.insert(schema.grant).values({
      organizationId: f.orgId,
      subjectKind: 'actor',
      subjectId: contributor.id,
      resourceKind: 'task',
      resourceId: f.venue.id,
      capabilities: ['contribute'],
      effect: 'allow',
    });
    await expect(
      requireScheduleAccess(schema.db, {
        organizationId: f.orgId,
        actorId: one(
          await schema.db
            .select()
            .from(schema.actor)
            .where(
              eq(
                schema.actor.userId,
                context.principal.kind === 'user' ? context.principal.userId : 'invalid',
              ),
            ),
        ).id,
        seriesId: f.schedule.series.id,
      }),
    ).rejects.toThrow();
    expect(
      (
        await client.callTool({
          name: 'undo',
          arguments: { orgId: f.orgId, changeSetId: f.receipt.id },
        })
      ).isError ?? false,
    ).toBe(false);
    const [run] = await schema.db
      .select()
      .from(schema.processOccurrence)
      .where(eq(schema.processOccurrence.id, f.run.occurrenceId));
    expect(run?.scheduleDateOwnership?.find((entry) => entry.id === f.venue.id)?.manual).toBe(
      false,
    );
  });
  it('refuses personal Athena undo after its session owner loses generated work rights', async () => {
    const f = await nativeReceipt();
    const userId = await ownUser(f.orgId, f.humanActorId);
    const session = one(
      await schema.db
        .insert(schema.agentSession)
        .values({
          executorKind: 'athena',
          ownerUserId: userId,
          contextOrganizationId: f.orgId,
          kind: 'job',
          trigger: 'delegation',
          status: 'completed',
        })
        .returning(),
    );
    await schema.db
      .update(schema.changeSet)
      .set({ origin: { tool: 'update_task', sessionId: session.id } })
      .where(eq(schema.changeSet.id, f.receipt.id));
    await revoke(f.orgId, f.humanActorId);
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('session', fakeSession(userId));
      await next();
    });
    app.route('/', meAthenaUndo);
    app.onError(onError);
    expect((await app.request(`/${f.receipt.id}/undo`, { method: 'POST' })).status).toBe(403);
    await unchangedNative(f);
  });
  it('refuses phone undo after the call owner loses current work rights', async () => {
    const f = await nativeReceipt();
    const userId = await ownUser(f.orgId, f.humanActorId);
    const conversation = one(
      await schema.db
        .insert(schema.agentSession)
        .values({
          executorKind: 'athena',
          ownerUserId: userId,
          contextOrganizationId: f.orgId,
          kind: 'job',
          trigger: 'delegation',
          status: 'completed',
        })
        .returning(),
    );
    const session = one(
      await schema.db
        .insert(schema.voiceSession)
        .values({
          conversationId: conversation.id,
          userId,
          organizationId: f.orgId,
          channel: 'phone',
          callSid: `CA_${conversation.id}`,
          provider: 'twilio-relay',
        })
        .returning(),
    );
    await schema.db
      .update(schema.changeSet)
      .set({ origin: { tool: 'complete_task', sessionId: session.id } })
      .where(eq(schema.changeSet.id, f.receipt.id));
    await revoke(f.orgId, f.humanActorId);
    await expect(undoPhoneCallChange(userId, session.id, f.receipt.id)).rejects.toMatchObject({
      status: 403,
    });
    await unchangedNative(f);
  });
  it('does not let an owned expansion token undo another read-only affected row', async () => {
    const f = await nativeReceipt(true);
    await revoke(f.orgId, f.humanActorId);
    await schema.db.insert(schema.grant).values({
      organizationId: f.orgId,
      subjectKind: 'actor',
      subjectId: f.humanActorId,
      resourceKind: 'task',
      resourceId: f.venue.id,
      capabilities: ['contribute'],
      effect: 'allow',
    });
    const response = await appWithActor(
      tasksRouter,
      f.orgId,
      ['contribute'],
      f.humanActorId,
    ).request(`/${f.venue.id}/expand/undo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ undoToken: f.receipt.id }),
    });
    expect(response.status).toBe(403);
    expect(
      one(
        await schema.db
          .select()
          .from(schema.changeSet)
          .where(eq(schema.changeSet.id, f.receipt.id)),
      ).undoneAt,
    ).toBeNull();
  });
});
