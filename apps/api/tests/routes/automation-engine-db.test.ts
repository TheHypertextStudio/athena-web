import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { getDb, one, seedBaseOrg } from './harness.test';
import { buildAutomationRegistry, type MailApplier } from '../../src/lib/automation/handlers';
import { runAutomationsForObservation } from '../../src/lib/automation/runtime';
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

    await runAutomationsForObservation(
      {
        organizationId: orgId,
        kind: 'completed',
        subjectType: 'task',
        subjectId: taskId,
        payload: {},
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
    await runAutomationsForObservation(
      {
        organizationId: orgId,
        kind: 'completed',
        subjectType: 'task',
        subjectId: taskId,
        payload: {},
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
    await runAutomationsForObservation(
      {
        organizationId: orgId,
        kind: 'completed',
        subjectType: 'task',
        subjectId: taskId,
        payload: {},
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
