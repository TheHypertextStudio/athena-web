import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import { getDb, one, seedBaseOrg, type StatusIdLookup } from '../support/routes-harness';
import { buildAutomationRegistry, type MailApplier } from '../../src/lib/automation/handlers';
import { defaultMailApplier, runAutomationsForEvent } from '../../src/lib/automation/runtime';
import { loadEnabledRules, seedDefaultAutomationRules } from '../../src/lib/automation/rules-store';
import { assertDefined } from '@docket/test-utils';

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
  const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
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
        statusId: statusId('task', 'todo'),
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

describe('defaultMailApplier org-scoping (security)', () => {
  it('no-ops and warns rather than acting on an integration owned by a different org', async () => {
    const orgA = await seedTaskWithEmail();
    const orgB = await seedTaskWithEmail();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      defaultMailApplier({
        organizationId: orgA.orgId,
        integrationId: orgB.integrationId, // belongs to a different org than organizationId
        threadId: 'thread_xyz',
        action: { kind: 'archive' },
      }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      '[automation] mail action skipped: integration not found in org',
      { organizationId: orgA.orgId, integrationId: orgB.integrationId },
    );
    warnSpy.mockRestore();
  });

  it('proceeds without the not-found warning when the integration belongs to the firing org', async () => {
    const { orgId, integrationId } = await seedTaskWithEmail();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      defaultMailApplier({
        organizationId: orgId,
        integrationId,
        threadId: 'thread_xyz',
        action: { kind: 'archive' },
      }),
    ).resolves.toBeUndefined();

    expect(warnSpy).not.toHaveBeenCalledWith(
      '[automation] mail action skipped: integration not found in org',
      expect.anything(),
    );
    warnSpy.mockRestore();
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

  async function seedTask(
    statusId: StatusIdLookup,
    orgId: string,
    teamId: string,
    actorId: string,
  ) {
    return one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Automatable task',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          createdBy: actorId,
        })
        .returning(),
    );
  }

  it('task.setStatus transitions via the shared lib (terminal state derives completedAt)', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const t = await seedTask(statusId, orgId, teamId, humanActorId);
    await addRule(orgId, { kind: 'created', subjectType: 'task' }, [
      { type: 'task.setStatus', params: { state: 'done' } },
    ]);

    await fire(orgId, { subjectType: 'task', subjectId: t.id, actorId: humanActorId });

    const row = one(await db.select().from(schema.task).where(eq(schema.task.id, t.id)));
    expect(row.state).toBe('done');
    expect(row.completedAt).not.toBeNull();
  });

  it('the depth-1 cascade cap holds through the REAL production path: a handler-triggered emitEvent does not re-fire rules', async () => {
    // Unlike the ALS-primitive test in runtime's own test file, this exercises the actual
    // production chain: task.setStatus -> setTaskState -> the real emitEvent -> re-entrant
    // runAutomationsForEvent. A regression here (e.g. the mutation becoming fire-and-forget,
    // decoupled from the awaited automationDispatch.run scope) would let the internally-
    // emitted 'completed' event trigger a second rule pass.
    const { orgId, teamId, statusId } = await seedBaseOrg(db, schema);
    const [u] = await db
      .insert(schema.user)
      .values({ name: 'Ada', email: `cascade-${Date.now().toString()}@example.com` })
      .returning({ id: schema.user.id });
    const actorRow = one(
      await db
        .insert(schema.actor)
        .values({
          organizationId: orgId,
          kind: 'human',
          displayName: 'Ada',
          userId: assertDefined(u).id,
        })
        .returning({ id: schema.actor.id }),
    );
    const t = await seedTask(statusId, orgId, teamId, actorRow.id);

    // Rule 1 fires on the initiating 'created' event and transitions the task to a terminal
    // state — internally emitting 'completed' through the real emitEvent facade.
    await addRule(orgId, { kind: 'created', subjectType: 'task' }, [
      { type: 'task.setStatus', params: { state: 'done' } },
    ]);
    // Rule 2 would fire on that internally-emitted 'completed' event, IF the cascade cap didn't
    // suppress it.
    await addRule(orgId, { kind: 'completed', subjectType: 'task' }, [
      { type: 'notification.send', params: { to: 'actor', title: 'Task completed' } },
    ]);

    await fire(orgId, { subjectType: 'task', subjectId: t.id, actorId: actorRow.id });

    const row = one(await db.select().from(schema.task).where(eq(schema.task.id, t.id)));
    expect(row.state).toBe('done'); // rule 1 ran

    const notifications = await db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.userId, assertDefined(u).id));
    expect(notifications).toHaveLength(0); // rule 2 was suppressed by the depth-1 cap
  });

  it('task.setStatus with an unknown state key is a logged no-op, never a throw', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const t = await seedTask(statusId, orgId, teamId, humanActorId);
    await addRule(orgId, { kind: 'created', subjectType: 'task' }, [
      { type: 'task.setStatus', params: { state: 'not-a-state' } },
    ]);
    await fire(orgId, { subjectType: 'task', subjectId: t.id });
    const row = one(await db.select().from(schema.task).where(eq(schema.task.id, t.id)));
    expect(row.state).toBe('todo'); // unchanged
  });

  it('task.assign assigns an org actor and refuses a cross-tenant one', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const other = await seedBaseOrg(db, schema); // a different org's actor
    const t = await seedTask(statusId, orgId, teamId, humanActorId);

    await addRule(orgId, { kind: 'created', subjectType: 'task' }, [
      { type: 'task.assign', params: { assigneeId: other.humanActorId } }, // cross-tenant: no-op
      { type: 'task.assign', params: { assigneeId: humanActorId } }, // in-org: applies
    ]);
    await fire(orgId, { subjectType: 'task', subjectId: t.id });

    const row = one(await db.select().from(schema.task).where(eq(schema.task.id, t.id)));
    expect(row.assigneeId).toBe(humanActorId);
  });

  it('task.setPriority validates against the Priority enum', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const t = await seedTask(statusId, orgId, teamId, humanActorId);
    await addRule(orgId, { kind: 'created', subjectType: 'task' }, [
      { type: 'task.setPriority', params: { priority: 'ludicrous' } }, // invalid: no-op
      { type: 'task.setPriority', params: { priority: 'urgent' } },
    ]);
    await fire(orgId, { subjectType: 'task', subjectId: t.id });
    const row = one(await db.select().from(schema.task).where(eq(schema.task.id, t.id)));
    expect(row.priority).toBe('urgent');
  });

  it('task.applyLabel attaches an org label idempotently and refuses a cross-tenant one', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const other = await seedBaseOrg(db, schema); // a different org's label
    const t = await seedTask(statusId, orgId, teamId, humanActorId);
    const labelRow = one(
      await db
        .insert(schema.label)
        .values({ organizationId: orgId, name: 'automated', color: '#00aa55' })
        .returning({ id: schema.label.id }),
    );
    const otherOrgLabel = one(
      await db
        .insert(schema.label)
        .values({ organizationId: other.orgId, name: 'foreign', color: '#aa0055' })
        .returning({ id: schema.label.id }),
    );
    await addRule(orgId, { kind: 'created', subjectType: 'task' }, [
      { type: 'task.applyLabel', params: { labelId: otherOrgLabel.id } }, // cross-tenant: no-op
      { type: 'task.applyLabel', params: { labelId: labelRow.id } },
    ]);
    await fire(orgId, { subjectType: 'task', subjectId: t.id });
    await fire(orgId, { subjectType: 'task', subjectId: t.id }); // idempotent re-fire
    const joins = await db.select().from(schema.taskLabel).where(eq(schema.taskLabel.taskId, t.id));
    expect(joins).toHaveLength(1);
    expect(joins[0]?.labelId).toBe(labelRow.id);
  });

  it('notification.send writes an automation inbox notification to the acting user', async () => {
    const { orgId, teamId, statusId } = await seedBaseOrg(db, schema);
    const [u] = await db
      .insert(schema.user)
      .values({ name: 'Ada', email: `ada-auto-${Date.now().toString()}@example.com` })
      .returning({ id: schema.user.id });
    const actorRow = one(
      await db
        .insert(schema.actor)
        .values({
          organizationId: orgId,
          kind: 'human',
          displayName: 'Ada',
          userId: assertDefined(u).id,
        })
        .returning({ id: schema.actor.id }),
    );
    const t = await seedTask(statusId, orgId, teamId, actorRow.id);

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
      .where(eq(schema.notification.userId, assertDefined(u).id));
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
      .where(eq(schema.attachment.subjectId, assertDefined(updated.createdTaskId)));
    expect(att).toHaveLength(1);
    expect(att[0]?.kind).toBe('email');
    expect(att[0]?.url).toBe('https://mail.mock.docket.local/#all/auto-accept-thread');
  });

  it('a throwing suggestion.autoAccept does not abort a sibling rule matching the same event', async () => {
    // Regression test: acceptSuggestion throws when emailMeta.externalUrl is missing (a
    // data-integrity guard). Before the fix, that throw escaped the handler and aborted the
    // engine's rule loop entirely, silently skipping every other rule for the same event.
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const [u] = await db
      .insert(schema.user)
      .values({ name: 'Ada', email: `ada-isolation-${Date.now().toString()}@example.com` })
      .returning({ id: schema.user.id });
    const actorRow = one(
      await db
        .insert(schema.actor)
        .values({
          organizationId: orgId,
          kind: 'human',
          displayName: 'Ada',
          userId: assertDefined(u).id,
        })
        .returning({ id: schema.actor.id }),
    );
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
          externalThreadId: 'broken-meta-thread',
          title: 'Missing its externalUrl',
          emailMeta: { subject: 'No url stamped' }, // no externalUrl -> acceptSuggestion throws
        })
        .returning(),
    );

    // Ordered so the throwing rule fires first — proves it doesn't poison the loop for the rule
    // that comes after it.
    await addRule(orgId, { kind: 'created', subjectType: 'email_suggestion' }, [
      { type: 'suggestion.autoAccept', params: {} },
    ]);
    await addRule(orgId, { kind: 'created', subjectType: 'email_suggestion' }, [
      { type: 'notification.send', params: { to: 'actor', title: 'A suggestion arrived' } },
    ]);

    await expect(
      fire(orgId, {
        subjectType: 'email_suggestion',
        subjectId: suggestion.id,
        actorId: actorRow.id,
      }),
    ).resolves.toBeUndefined();

    // autoAccept failed — the suggestion is untouched, not accepted.
    const updated = one(
      await db
        .select()
        .from(schema.emailSuggestion)
        .where(eq(schema.emailSuggestion.id, suggestion.id)),
    );
    expect(updated.status).toBe('pending');

    // The sibling rule still ran despite the first rule's handler throwing internally.
    const rows = await db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.userId, assertDefined(u).id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toMatchObject({ title: 'A suggestion arrived' });
  });
});

describe('mail.* handler variety and no-op branches', () => {
  it('markRead, markUnread, and trash each derive their own MailAction kind', async () => {
    for (const type of ['mail.markRead', 'mail.markUnread', 'mail.trash']) {
      const { orgId, integrationId, taskId } = await seedTaskWithEmail();
      await db.insert(schema.automationRule).values({
        organizationId: orgId,
        name: 'test rule',
        enabled: true,
        eventMatch: { kind: 'completed', subjectType: 'task' },
        condition: { op: 'and', nodes: [] },
        actions: [{ type, params: {} }],
      });
      const recorded: RecordedMail[] = [];
      const registry = buildAutomationRegistry({
        mailApplier: async (i) => void recorded.push(i),
      });
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
        {
          organizationId: orgId,
          integrationId,
          threadId: 'thread_xyz',
          action: { kind: type.replace('mail.', '') },
        },
      ]);
    }
  });

  it('applyLabel/removeLabel derive the label from params, and no-op without one', async () => {
    const { orgId, taskId } = await seedTaskWithEmail();
    await db.insert(schema.automationRule).values({
      organizationId: orgId,
      name: 'apply without label',
      enabled: true,
      eventMatch: { kind: 'completed', subjectType: 'task' },
      condition: { op: 'and', nodes: [] },
      actions: [{ type: 'mail.applyLabel', params: {} }], // no `label` — build() returns null
    });
    const recorded: RecordedMail[] = [];
    const registry = buildAutomationRegistry({
      mailApplier: async (i) => void recorded.push(i),
    });
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

    await db.insert(schema.automationRule).values({
      organizationId: orgId,
      name: 'remove with label',
      enabled: true,
      eventMatch: { kind: 'created', subjectType: 'task' },
      condition: { op: 'and', nodes: [] },
      actions: [{ type: 'mail.removeLabel', params: { label: 'follow-up' } }],
    });
    await runAutomationsForEvent(
      {
        organizationId: orgId,
        kind: 'created',
        source: 'docket',
        subjectType: 'task',
        subjectId: taskId,
        detail: {},
        occurredAt: new Date(0),
      },
      registry,
    );
    expect(recorded).toEqual([
      expect.objectContaining({ action: { kind: 'removeLabel', label: 'follow-up' } }),
    ]);
  });

  it('no-ops when the firing event carries no subjectId at all', async () => {
    const { orgId } = await seedTaskWithEmail();
    await db.insert(schema.automationRule).values({
      organizationId: orgId,
      name: 'no subject',
      enabled: true,
      eventMatch: { kind: 'created' },
      condition: { op: 'and', nodes: [] },
      actions: [{ type: 'mail.archive', params: {} }],
    });
    const recorded: RecordedMail[] = [];
    const registry = buildAutomationRegistry({
      mailApplier: async (i) => void recorded.push(i),
    });
    await runAutomationsForEvent(
      {
        organizationId: orgId,
        kind: 'created',
        source: 'docket',
        detail: {},
        occurredAt: new Date(0),
      },
      registry,
    );
    expect(recorded).toHaveLength(0);
  });

  it('skips an email attachment row missing its integration id or external id', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const t = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Incomplete attachment',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          createdBy: humanActorId,
        })
        .returning({ id: schema.task.id }),
    );
    await db.insert(schema.attachment).values({
      organizationId: orgId,
      subjectType: 'task',
      subjectId: t.id,
      kind: 'email',
      title: 'Broken',
      sourceIntegrationId: null,
      externalId: null,
      createdBy: humanActorId,
    });
    await db.insert(schema.automationRule).values({
      organizationId: orgId,
      name: 'archive broken',
      enabled: true,
      eventMatch: { kind: 'completed', subjectType: 'task' },
      condition: { op: 'and', nodes: [] },
      actions: [{ type: 'mail.archive', params: {} }],
    });
    const recorded: RecordedMail[] = [];
    const registry = buildAutomationRegistry({
      mailApplier: async (i) => void recorded.push(i),
    });
    await runAutomationsForEvent(
      {
        organizationId: orgId,
        kind: 'completed',
        source: 'docket',
        subjectType: 'task',
        subjectId: t.id,
        detail: {},
        occurredAt: new Date(0),
      },
      registry,
    );
    expect(recorded).toHaveLength(0);
  });
});

describe('task.* handlers: invalid params and a missing task subject', () => {
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

  async function addRule(orgId: string, on: unknown, then: unknown) {
    await db.insert(schema.automationRule).values({
      organizationId: orgId,
      name: 'test rule',
      enabled: true,
      eventMatch: on,
      condition: { op: 'and', nodes: [] },
      actions: then,
    });
  }

  it('task.setStatus no-ops on invalid params (missing state)', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const t = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'T',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          createdBy: humanActorId,
        })
        .returning(),
    );
    await addRule(orgId, { kind: 'created', subjectType: 'task' }, [
      { type: 'task.setStatus', params: {} },
    ]);
    await fire(orgId, { subjectType: 'task', subjectId: t.id });
    const row = one(await db.select().from(schema.task).where(eq(schema.task.id, t.id)));
    expect(row.state).toBe('todo');
  });

  it('task.assign no-ops on invalid params and when the event names no task', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    await addRule(orgId, { kind: 'created', subjectType: 'task' }, [
      { type: 'task.assign', params: {} }, // missing assigneeId
    ]);
    await expect(
      fire(orgId, { subjectType: 'task', subjectId: 'missing' }),
    ).resolves.toBeUndefined();

    // A rule matching a non-task event: taskOf's subjectType guard short-circuits.
    const suggestion = one(
      await db
        .insert(schema.emailSuggestion)
        .values({
          organizationId: orgId,
          createdBy: humanActorId,
          integrationId: one(
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
          ).id,
          externalThreadId: 'assign-guard-thread',
          title: 'Not a task',
        })
        .returning(),
    );
    await addRule(orgId, { kind: 'created', subjectType: 'email_suggestion' }, [
      { type: 'task.assign', params: { assigneeId: humanActorId } },
    ]);
    await expect(
      fire(orgId, { subjectType: 'email_suggestion', subjectId: suggestion.id }),
    ).resolves.toBeUndefined();
  });

  it('task.setPriority no-ops when the event names no task', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    await addRule(orgId, { kind: 'created' }, [
      { type: 'task.setPriority', params: { priority: 'urgent' } },
    ]);
    await expect(
      fire(orgId, { actorId: humanActorId }), // no subjectType/subjectId at all
    ).resolves.toBeUndefined();
  });

  it('task.applyLabel no-ops on invalid params and when the event names no task', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const t = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'T',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          createdBy: humanActorId,
        })
        .returning(),
    );
    await addRule(orgId, { kind: 'created', subjectType: 'task' }, [
      { type: 'task.applyLabel', params: {} }, // missing labelId
    ]);
    await fire(orgId, { subjectType: 'task', subjectId: t.id });
    expect(
      await db.select().from(schema.taskLabel).where(eq(schema.taskLabel.taskId, t.id)),
    ).toHaveLength(0);

    await addRule(orgId, { kind: 'archived' }, [
      { type: 'task.applyLabel', params: { labelId: 'whatever' } },
    ]);
    await expect(fire(orgId, { kind: 'archived' })).resolves.toBeUndefined(); // no subject at all
  });
});

describe('notification.send: targeting, and the no-inbox/no-target no-ops', () => {
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

  async function addRule(orgId: string, on: unknown, then: unknown) {
    await db.insert(schema.automationRule).values({
      organizationId: orgId,
      name: 'test rule',
      enabled: true,
      eventMatch: on,
      condition: { op: 'and', nodes: [] },
      actions: then,
    });
  }

  it('no-ops on invalid params (missing title)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    await addRule(orgId, { kind: 'created' }, [
      { type: 'notification.send', params: { to: 'actor' } },
    ]);
    await fire(orgId, { actorId: humanActorId });
    expect(
      await db
        .select()
        .from(schema.notification)
        .where(eq(schema.notification.organizationId, orgId)),
    ).toHaveLength(0);
  });

  it('no-ops for to:"actor" when the firing event carries no actorId', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    await addRule(orgId, { kind: 'created' }, [
      { type: 'notification.send', params: { to: 'actor', title: 'Hi' } },
    ]);
    await fire(orgId, {});
    expect(
      await db
        .select()
        .from(schema.notification)
        .where(eq(schema.notification.organizationId, orgId)),
    ).toHaveLength(0);
  });

  it('no-ops for to:"actor" when the actor is an agent with no linked inbox user', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const agentActor = one(
      await db
        .insert(schema.actor)
        .values({ organizationId: orgId, kind: 'agent', displayName: 'Athena' })
        .returning({ id: schema.actor.id }),
    );
    await addRule(orgId, { kind: 'created' }, [
      { type: 'notification.send', params: { to: 'actor', title: 'Hi' } },
    ]);
    await fire(orgId, { actorId: agentActor.id });
    expect(
      await db
        .select()
        .from(schema.notification)
        .where(eq(schema.notification.organizationId, orgId)),
    ).toHaveLength(0);
  });

  it('targets the task assignee for to:"taskAssignee", and no-ops when unassigned', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const [u] = await db
      .insert(schema.user)
      .values({ name: 'Assignee', email: `assignee-${Date.now().toString()}@example.com` })
      .returning({ id: schema.user.id });
    const assigneeActor = one(
      await db
        .insert(schema.actor)
        .values({
          organizationId: orgId,
          kind: 'human',
          displayName: 'Assignee',
          userId: assertDefined(u).id,
        })
        .returning({ id: schema.actor.id }),
    );
    const assigned = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Assigned',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          createdBy: humanActorId,
          assigneeId: assigneeActor.id,
        })
        .returning({ id: schema.task.id }),
    );
    const unassigned = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Unassigned',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          createdBy: humanActorId,
        })
        .returning({ id: schema.task.id }),
    );
    await addRule(orgId, { kind: 'created', subjectType: 'task' }, [
      { type: 'notification.send', params: { to: 'taskAssignee', title: 'Assigned to you' } },
    ]);

    await fire(orgId, { subjectType: 'task', subjectId: assigned.id });
    const rows = await db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.userId, assertDefined(u).id));
    expect(rows).toHaveLength(1);

    await fire(orgId, { subjectType: 'task', subjectId: unassigned.id });
    expect(
      await db
        .select()
        .from(schema.notification)
        .where(eq(schema.notification.userId, assertDefined(u).id)),
    ).toHaveLength(1); // unchanged — no assignee to notify
  });
});

describe('suggestion.autoAccept / suggestion.dismiss no-op and fallback branches', () => {
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

  async function addRule(orgId: string, on: unknown, then: unknown) {
    await db.insert(schema.automationRule).values({
      organizationId: orgId,
      name: 'test rule',
      enabled: true,
      eventMatch: on,
      condition: { op: 'and', nodes: [] },
      actions: then,
    });
  }

  async function seedIntegration(orgId: string, createdBy: string): Promise<string> {
    return one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: orgId,
          provider: 'gmail',
          pattern: 'connector',
          roles: ['signal'],
          createdBy,
        })
        .returning({ id: schema.integration.id }),
    ).id;
  }

  it('autoAccept and dismiss both no-op when the event names no suggestion', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    await addRule(orgId, { kind: 'created' }, [{ type: 'suggestion.autoAccept', params: {} }]);
    await addRule(orgId, { kind: 'archived' }, [{ type: 'suggestion.dismiss', params: {} }]);
    await expect(fire(orgId, { actorId: humanActorId })).resolves.toBeUndefined();
    await expect(fire(orgId, { kind: 'archived', actorId: humanActorId })).resolves.toBeUndefined();
  });

  it('falls back to the suggestion’s creator when the firing event carries no actor', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegration(orgId, humanActorId);
    const suggestion = one(
      await db
        .insert(schema.emailSuggestion)
        .values({
          organizationId: orgId,
          createdBy: humanActorId,
          integrationId,
          externalThreadId: 'no-actor-thread',
          title: 'From the sweep',
          emailMeta: {
            subject: 'Sweep-created',
            externalUrl: 'https://mail.mock.docket.local/#all/no-actor-thread',
          },
        })
        .returning(),
    );
    await addRule(orgId, { kind: 'created', subjectType: 'email_suggestion' }, [
      { type: 'suggestion.autoAccept', params: {} },
    ]);
    // No actorId on the event — the handler falls back to the suggestion's own createdBy.
    await fire(orgId, { subjectType: 'email_suggestion', subjectId: suggestion.id });
    const updated = one(
      await db
        .select()
        .from(schema.emailSuggestion)
        .where(eq(schema.emailSuggestion.id, suggestion.id)),
    );
    expect(updated.status).toBe('accepted');
  });

  it('no-ops when neither the event nor a resolvable suggestion names an actor', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    await addRule(orgId, { kind: 'created', subjectType: 'email_suggestion' }, [
      { type: 'suggestion.autoAccept', params: {} },
    ]);
    // No actorId, and the subjectId names no real suggestion row — the createdBy lookup misses.
    await expect(
      fire(orgId, { subjectType: 'email_suggestion', subjectId: 'sugg_does_not_exist' }),
    ).resolves.toBeUndefined();
  });

  it('logs (does not throw) when the suggestion was already resolved', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegration(orgId, humanActorId);
    const suggestion = one(
      await db
        .insert(schema.emailSuggestion)
        .values({
          organizationId: orgId,
          createdBy: humanActorId,
          integrationId,
          externalThreadId: 'already-resolved-thread',
          title: 'Already handled',
          status: 'dismissed',
          emailMeta: { subject: 'Already handled' },
        })
        .returning(),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await addRule(orgId, { kind: 'created', subjectType: 'email_suggestion' }, [
      { type: 'suggestion.autoAccept', params: {} },
    ]);
    await expect(
      fire(orgId, {
        subjectType: 'email_suggestion',
        subjectId: suggestion.id,
        actorId: humanActorId,
      }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      '[automation] suggestion.autoAccept skipped',
      expect.objectContaining({ outcome: 'already_resolved' }),
    );
    warnSpy.mockRestore();
  });
});
