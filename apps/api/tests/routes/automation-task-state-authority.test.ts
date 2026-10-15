import { beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type * as DbModule from '@docket/db';
import { getDb, one, seedTask, seedTaskAccessOrg } from '../support/routes-harness';
import { reflowFixture } from '../lib/work-template-blueprint-reflow-fixture';
import { runAutomationsForEvent } from '../../src/lib/automation/runtime';
import { runAutomations } from '../../src/lib/automation/engine';
import { loadEnabledRules } from '../../src/lib/automation/rules-store';
import { buildAutomationRegistry } from '../../src/lib/automation/handlers';
import { bindAutomationActionExecution } from '../../src/lib/automation/execution-proof';
import { setTaskState } from '../../src/lib/task-state';
import type { AutomationEvent } from '../../src/lib/automation/event';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
function firingEvent(orgId: string, taskId: string, actorId?: string): AutomationEvent {
  return {
    organizationId: orgId,
    kind: 'status_change',
    source: 'docket',
    subjectType: 'task',
    subjectId: taskId,
    detail: {},
    occurredAt: new Date('2026-11-20T12:00:00Z'),
    ...(actorId ? { actorId } : {}),
  };
}
async function stateRule(orgId: string, createdBy: string | null, isSeed = false) {
  return one(
    await schema.db
      .insert(schema.automationRule)
      .values({
        organizationId: orgId,
        name: 'Complete observed Task',
        createdBy,
        isSeed,
        eventMatch: { kind: 'status_change', subjectType: 'task' },
        condition: { op: 'and', nodes: [] },
        actions: [{ type: 'task.setStatus', params: { state: 'done' } }],
      })
      .returning(),
  );
}
async function ordinaryTask() {
  const f = await seedTaskAccessOrg(schema.db, schema, 'manage');
  const row = await seedTask(schema.db, schema, f.statusId, {
    organizationId: f.orgId,
    teamId: f.teamId,
    title: 'Observed',
    state: 'todo',
    createdBy: f.humanActorId,
  });
  return { ...f, row };
}
async function taskState(id: string) {
  return one(await schema.db.select().from(schema.task).where(eq(schema.task.id, id)));
}
describe('checked persisted rule authority for task state', () => {
  it('uses the real rule author for atomic completion reflow while retaining null event attribution', async () => {
    const f = await reflowFixture(schema);
    const prepare = f.byPath.get('prepare');
    const finish = f.byPath.get('finish');
    if (prepare?.kind !== 'task' || finish?.kind !== 'task') throw new Error('Missing tasks');
    await stateRule(f.orgId, f.humanActorId);
    await runAutomationsForEvent(firingEvent(f.orgId, prepare.id));
    expect((await taskState(prepare.id)).state).toBe('done');
    expect((await taskState(finish.id)).dueDate).not.toBeNull();
    const events = await schema.db
      .select()
      .from(schema.event)
      .where(eq(schema.event.docketEntityId, prepare.id));
    expect(events.filter((event) => event.kind === 'completed')).toEqual(
      expect.arrayContaining([expect.objectContaining({ createdBy: null })]),
    );
  });
  it.each([false, true])(
    'refuses an unregistered noauthor state rule even if isSeed=%s',
    async (isSeed) => {
      const f = await ordinaryTask();
      await stateRule(f.orgId, null, isSeed);
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        await runAutomationsForEvent(firingEvent(f.orgId, f.row.id));
      } finally {
        warning.mockRestore();
      }
      expect((await taskState(f.row.id)).state).toBe('todo');
    },
  );
  it('refuses a loaded action after its persisted rule is disabled', async () => {
    const f = await ordinaryTask();
    const rule = await stateRule(f.orgId, f.humanActorId);
    const loaded = await loadEnabledRules(f.orgId);
    await schema.db
      .update(schema.automationRule)
      .set({ enabled: false })
      .where(eq(schema.automationRule.id, rule.id));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await runAutomations(
        firingEvent(f.orgId, f.row.id),
        loaded,
        buildAutomationRegistry({ mailApplier: async () => undefined }),
      );
    } finally {
      warning.mockRestore();
    }
    expect((await taskState(f.row.id)).state).toBe('todo');
  });
  it.each(['actions', 'condition', 'archive'] as const)(
    'rejects a changed persisted %s after load',
    async (change) => {
      const f = await ordinaryTask();
      const rule = await stateRule(f.orgId, f.humanActorId);
      const loaded = await loadEnabledRules(f.orgId);
      const patch =
        change === 'actions'
          ? { actions: [{ type: 'task.setStatus', params: { state: 'todo' } }] }
          : change === 'condition'
            ? { condition: { op: 'eq', path: 'kind', value: 'never' } }
            : { archivedAt: new Date() };
      await schema.db
        .update(schema.automationRule)
        .set(patch)
        .where(eq(schema.automationRule.id, rule.id));
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        await runAutomations(
          firingEvent(f.orgId, f.row.id),
          loaded,
          buildAutomationRegistry({ mailApplier: async () => undefined }),
        );
      } finally {
        warning.mockRestore();
      }
      expect((await taskState(f.row.id)).state).toBe('todo');
    },
  );
  it.each(['inactive', 'revoked'] as const)(
    'uses actual live author authority when %s despite a valid event actor',
    async (change) => {
      const f = await ordinaryTask();
      const [other] = await schema.db
        .insert(schema.actor)
        .values({ organizationId: f.orgId, kind: 'human', displayName: 'Rule author' })
        .returning();
      if (!other) throw new Error('Missing author');
      await schema.db.insert(schema.grant).values({
        organizationId: f.orgId,
        subjectKind: 'actor',
        subjectId: other.id,
        resourceKind: 'organization',
        resourceId: f.orgId,
        capabilities: ['contribute'],
        effect: 'allow',
        cascades: true,
      });
      await stateRule(f.orgId, other.id);
      if (change === 'inactive')
        await schema.db
          .update(schema.actor)
          .set({ status: 'suspended' })
          .where(eq(schema.actor.id, other.id));
      else
        await schema.db
          .delete(schema.grant)
          .where(
            and(eq(schema.grant.organizationId, f.orgId), eq(schema.grant.subjectId, other.id)),
          );
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        await runAutomationsForEvent(firingEvent(f.orgId, f.row.id, f.humanActorId));
      } finally {
        warning.mockRestore();
      }
      expect((await taskState(f.row.id)).state).toBe('todo');
    },
  );
  it('rejects cloned action proof and a real proof applied to a different task or tenant', async () => {
    const f = await ordinaryTask(),
      other = await ordinaryTask();
    await stateRule(f.orgId, f.humanActorId);
    const [rule] = await loadEnabledRules(f.orgId);
    const action = rule?.then[0];
    if (!rule?.execution || !action) throw new Error('Missing execution');
    const proof = bindAutomationActionExecution(
      rule.execution,
      firingEvent(f.orgId, f.row.id),
      0,
      action,
    );
    const input = { organizationId: f.orgId, taskId: f.row.id, state: 'done', actorId: null };
    await expect(
      setTaskState({ ...input, automationExecution: { ...proof } }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      setTaskState({
        ...input,
        organizationId: other.orgId,
        taskId: other.row.id,
        automationExecution: proof,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await taskState(f.row.id)).state).toBe('todo');
    expect((await taskState(other.row.id)).state).toBe('todo');
  });
});
