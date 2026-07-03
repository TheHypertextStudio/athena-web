import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { getDb, one, seedBaseOrg } from './harness.test';
import { buildAutomationRegistry, type MailApplier } from '../../src/lib/automation/handlers';
import { runAutomationsForEvent } from '../../src/lib/automation/runtime';
import { loadEnabledRules, seedDefaultAutomationRules } from '../../src/lib/automation/rules-store';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

interface RecordedMail {
  organizationId: string;
  integrationId: string;
  threadId: string;
  action: { kind: string };
}

/** Seed an org with a Gmail integration, a task, and an email attachment on it. */
async function seedTaskWithEmail() {
  const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
  const integration = one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'gmail',
        pattern: 'connector',
        roles: ['signal'],
        createdBy: humanActorId,
      })
      .returning({ id: schema.integration.id }),
  );
  const task = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Reply to recruiter',
        state: 'todo',
        createdBy: humanActorId,
      })
      .returning({ id: schema.task.id }),
  );
  const att = one(
    await db
      .insert(schema.attachment)
      .values({
        organizationId: orgId,
        subjectType: 'task',
        subjectId: task.id,
        kind: 'email',
        title: 'Interview',
        sourceIntegrationId: integration.id,
        externalId: 'thread_xyz',
        createdBy: humanActorId,
      })
      .returning({ id: schema.attachment.id }),
  );
  return {
    orgId,
    humanActorId,
    integrationId: integration.id,
    taskId: task.id,
    attachmentId: att.id,
  };
}

async function addRule(orgId: string, on: unknown, then: unknown, enabled = true) {
  await db.insert(schema.automationRule).values({
    organizationId: orgId,
    name: 'test rule',
    enabled,
    eventMatch: on,
    condition: { op: 'and', nodes: [] },
    actions: then,
  });
}

describe('automation engine over DB rules', () => {
  it('archives a task email attachment when a completed observation fires a matching rule', async () => {
    const { orgId, integrationId, taskId, attachmentId } = await seedTaskWithEmail();
    await addRule(orgId, { kind: 'completed', subjectType: 'task' }, [
      { type: 'mail.archive', params: {} },
    ]);

    const recorded: RecordedMail[] = [];
    const mailApplier: MailApplier = async (i) => void recorded.push(i);
    const registry = buildAutomationRegistry({ mailApplier });

    await runAutomationsForEvent(
      {
        organizationId: orgId,
        kind: 'completed',
        source: 'docket',
        subjectType: 'task',
        subjectId: taskId,
        detail: {},
        occurredAt: new Date(0),
      },
      registry,
    );

    expect(recorded).toEqual([
      { organizationId: orgId, integrationId, threadId: 'thread_xyz', action: { kind: 'archive' } },
    ]);
    // The action ledger is stamped (idempotency).
    const att = one(
      await db.select().from(schema.attachment).where(eq(schema.attachment.id, attachmentId)),
    );
    expect(att.lastEmailStateAction).toBe('mail.archive');
  });

  it('does not re-apply an action already in the ledger (idempotency)', async () => {
    const { orgId, taskId } = await seedTaskWithEmail();
    await db
      .update(schema.attachment)
      .set({ lastEmailStateAction: 'mail.archive' })
      .where(eq(schema.attachment.subjectId, taskId));
    await addRule(orgId, { kind: 'completed', subjectType: 'task' }, [
      { type: 'mail.archive', params: {} },
    ]);

    const recorded: RecordedMail[] = [];
    const registry = buildAutomationRegistry({ mailApplier: async (i) => void recorded.push(i) });
    await runAutomationsForEvent(
      {
        organizationId: orgId,
        kind: 'completed',
        source: 'docket',
        subjectType: 'task',
        subjectId: taskId,
        detail: {},
        occurredAt: new Date(0),
      },
      registry,
    );
    expect(recorded).toHaveLength(0);
  });

  it('does not fire a non-matching or disabled rule', async () => {
    const { orgId, taskId } = await seedTaskWithEmail();
    await addRule(orgId, { kind: 'created', subjectType: 'task' }, [
      { type: 'mail.archive', params: {} },
    ]); // wrong kind
    await addRule(
      orgId,
      { kind: 'completed', subjectType: 'task' },
      [{ type: 'mail.archive', params: {} }],
      false,
    ); // disabled

    const recorded: RecordedMail[] = [];
    const registry = buildAutomationRegistry({ mailApplier: async (i) => void recorded.push(i) });
    await runAutomationsForEvent(
      {
        organizationId: orgId,
        kind: 'completed',
        source: 'docket',
        subjectType: 'task',
        subjectId: taskId,
        detail: {},
        occurredAt: new Date(0),
      },
      registry,
    );
    expect(recorded).toHaveLength(0);
  });

  it('seedDefaultAutomationRules is idempotent and loadEnabledRules returns engine rules', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    expect(await seedDefaultAutomationRules(orgId, humanActorId)).toBeGreaterThan(0);
    expect(await seedDefaultAutomationRules(orgId, humanActorId)).toBe(0); // second call no-ops
    const rules = await loadEnabledRules(orgId);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules[0]).toHaveProperty('on');
    expect(rules[0]).toHaveProperty('then');
  });
});

describe('generic action handlers (M5)', () => {
  /** Run one event through the real registry with a recording mail applier. */
  async function fire(
    orgId: string,
    event: Partial<Parameters<typeof runAutomationsForEvent>[0]>,
  ): Promise<void> {
    const registry = buildAutomationRegistry({ mailApplier: async () => undefined });
    await runAutomationsForEvent(
      {
        organizationId: orgId,
        kind: 'created',
        source: 'docket',
        detail: {},
        occurredAt: new Date(0),
        ...event,
      },
      registry,
    );
  }

  async function seedTask(orgId: string, teamId: string, actorId: string) {
    return one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Automatable task',
          state: 'todo',
          createdBy: actorId,
        })
        .returning(),
    );
  }

  it('task.setStatus transitions via the shared lib (terminal state derives completedAt)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const t = await seedTask(orgId, teamId, humanActorId);
    await addRule(orgId, { kind: 'created', subjectType: 'task' }, [
      { type: 'task.setStatus', params: { state: 'done' } },
    ]);

    await fire(orgId, { subjectType: 'task', subjectId: t.id, actorId: humanActorId });

    const row = one(await db.select().from(schema.task).where(eq(schema.task.id, t.id)));
    expect(row.state).toBe('done');
    expect(row.completedAt).not.toBeNull();
  });

  it('task.setStatus with an unknown state key is a logged no-op, never a throw', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const t = await seedTask(orgId, teamId, humanActorId);
    await addRule(orgId, { kind: 'created', subjectType: 'task' }, [
      { type: 'task.setStatus', params: { state: 'not-a-state' } },
    ]);
    await fire(orgId, { subjectType: 'task', subjectId: t.id });
    const row = one(await db.select().from(schema.task).where(eq(schema.task.id, t.id)));
    expect(row.state).toBe('todo'); // unchanged
  });

  it('task.assign assigns an org actor and refuses a cross-tenant one', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const other = await seedBaseOrg(db, schema); // a different org's actor
    const t = await seedTask(orgId, teamId, humanActorId);

    await addRule(orgId, { kind: 'created', subjectType: 'task' }, [
      { type: 'task.assign', params: { assigneeId: other.humanActorId } }, // cross-tenant: no-op
      { type: 'task.assign', params: { assigneeId: humanActorId } }, // in-org: applies
    ]);
    await fire(orgId, { subjectType: 'task', subjectId: t.id });

    const row = one(await db.select().from(schema.task).where(eq(schema.task.id, t.id)));
    expect(row.assigneeId).toBe(humanActorId);
  });

  it('task.setPriority validates against the Priority enum', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const t = await seedTask(orgId, teamId, humanActorId);
    await addRule(orgId, { kind: 'created', subjectType: 'task' }, [
      { type: 'task.setPriority', params: { priority: 'ludicrous' } }, // invalid: no-op
      { type: 'task.setPriority', params: { priority: 'urgent' } },
    ]);
    await fire(orgId, { subjectType: 'task', subjectId: t.id });
    const row = one(await db.select().from(schema.task).where(eq(schema.task.id, t.id)));
    expect(row.priority).toBe('urgent');
  });

  it('task.applyLabel attaches an org label idempotently', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const t = await seedTask(orgId, teamId, humanActorId);
    const labelRow = one(
      await db
        .insert(schema.label)
        .values({ organizationId: orgId, name: 'automated', color: '#00aa55' })
        .returning({ id: schema.label.id }),
    );
    await addRule(orgId, { kind: 'created', subjectType: 'task' }, [
      { type: 'task.applyLabel', params: { labelId: labelRow.id } },
    ]);
    await fire(orgId, { subjectType: 'task', subjectId: t.id });
    await fire(orgId, { subjectType: 'task', subjectId: t.id }); // idempotent re-fire
    const joins = await db.select().from(schema.taskLabel).where(eq(schema.taskLabel.taskId, t.id));
    expect(joins).toHaveLength(1);
    expect(joins[0]?.labelId).toBe(labelRow.id);
  });

  it('notification.send writes an automation inbox notification to the acting user', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const [u] = await db
      .insert(schema.user)
      .values({ name: 'Ada', email: `ada-auto-${Date.now().toString()}@example.com` })
      .returning({ id: schema.user.id });
    const actorRow = one(
      await db
        .insert(schema.actor)
        .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId: u!.id })
        .returning({ id: schema.actor.id }),
    );
    const t = await seedTask(orgId, teamId, actorRow.id);

    await addRule(orgId, { kind: 'completed', subjectType: 'task' }, [
      {
        type: 'notification.send',
        params: { to: 'actor', title: 'A watched task completed', summary: 'Automation ran.' },
      },
    ]);
    await fire(orgId, {
      kind: 'completed',
      subjectType: 'task',
      subjectId: t.id,
      actorId: actorRow.id,
    });

    const rows = await db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.userId, u!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('automation');
    expect(rows[0]?.body).toMatchObject({ title: 'A watched task completed' });
  });

  it('suggestion.autoAccept materializes a pending suggestion through the shared accept lib', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const integ = one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: orgId,
          provider: 'gmail',
          pattern: 'connector',
          roles: ['signal'],
          createdBy: humanActorId,
        })
        .returning({ id: schema.integration.id }),
    );
    const suggestion = one(
      await db
        .insert(schema.emailSuggestion)
        .values({
          organizationId: orgId,
          createdBy: humanActorId,
          integrationId: integ.id,
          externalThreadId: 'auto-accept-thread',
          title: 'Reply to the vendor',
          emailMeta: {
            subject: 'Vendor question',
            externalUrl: 'https://mail.mock.docket.local/#all/auto-accept-thread',
          },
        })
        .returning(),
    );

    await addRule(orgId, { kind: 'created', subjectType: 'email_suggestion' }, [
      { type: 'suggestion.autoAccept', params: {} },
    ]);
    await fire(orgId, {
      subjectType: 'email_suggestion',
      subjectId: suggestion.id,
      actorId: humanActorId,
    });

    const updated = one(
      await db
        .select()
        .from(schema.emailSuggestion)
        .where(eq(schema.emailSuggestion.id, suggestion.id)),
    );
    expect(updated.status).toBe('accepted');
    expect(updated.createdTaskId).not.toBeNull();

    const att = await db
      .select()
      .from(schema.attachment)
      .where(eq(schema.attachment.subjectId, updated.createdTaskId!));
    expect(att).toHaveLength(1);
    expect(att[0]?.kind).toBe('email');
    expect(att[0]?.url).toBe('https://mail.mock.docket.local/#all/auto-accept-thread');
  });
});
