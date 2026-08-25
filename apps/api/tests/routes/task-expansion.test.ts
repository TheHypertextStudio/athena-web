import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

import type * as DbModule from '@docket/db';
import type { TaskExpansionInput, TaskExpansionSynthesizer } from '@docket/athena/task-expansion';
import { LabelId } from '@docket/types';

import type tasksRouter from '../../src/routes/tasks';
import * as container from '../../src/container';
import { appWithActor, getDb, seedTaskAccessOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let tasks!: typeof tasksRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  tasks = (await import('../../src/routes/tasks')).default;
});

afterEach(() => vi.restoreAllMocks());

function injectExpander(expander: TaskExpansionSynthesizer): void {
  const current = container.getContainer();
  vi.spyOn(container, 'getContainer').mockReturnValue({ ...current, taskExpander: expander });
}

async function createTask(
  app: ReturnType<typeof appWithActor>,
  teamId: string,
  description: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const response = await app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Investigate checkout errors', teamId, description, ...extra }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

describe('task expansion (POST /:id/expand)', () => {
  it('gives the synthesizer only resolved direct task resources and drops invented URLs', async () => {
    const { orgId, teamId, humanActorId } = await seedTaskAccessOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const taskId = await createTask(app, teamId, 'The payment request must be checked.');
    await db.insert(schema.attachment).values({
      organizationId: orgId,
      subjectType: 'task',
      subjectId: taskId,
      kind: 'url',
      title: 'Payment runbook',
      url: 'https://docs.example.test/payments',
      createdBy: humanActorId,
    });
    let received: TaskExpansionInput | undefined;
    injectExpander({
      async expandTask(input) {
        received = input;
        return {
          description:
            'The payment request must be checked. [Runbook](https://docs.example.test/payments) [Invented](https://attacker.example/private)',
          patch: {},
          subtasks: [],
          dependencies: [],
          relatedTaskIds: [],
          resourceUrls: ['https://docs.example.test/payments', 'https://attacker.example/private'],
        };
      },
    });

    const response = await app.request(`/${taskId}/expand`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(200);
    expect(received?.resources).toEqual(
      expect.arrayContaining([
        { title: 'Payment runbook', url: 'https://docs.example.test/payments' },
      ]),
    );
    const body = (await response.json()) as { task: { description: string | null } };
    expect(body.task.description).toContain('https://docs.example.test/payments');
    expect(body.task.description).not.toContain('https://attacker.example/private');
  });

  it('applies a task template priority and labels when the task has no explicit values', async () => {
    const { orgId, teamId, humanActorId } = await seedTaskAccessOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const [label] = await db
      .insert(schema.label)
      .values({ organizationId: orgId, name: 'Incident', color: 'red' })
      .returning({ id: schema.label.id });
    if (!label) throw new Error('task expansion test label was not created');
    const [template] = await db
      .insert(schema.template)
      .values({
        organizationId: orgId,
        targetType: 'task',
        name: 'Incident',
        scope: 'organization',
        ownerActorId: humanActorId,
        payload: {
          targetType: 'task',
          description: '## Incident',
          priority: 'high',
          labelIds: [LabelId.parse(label.id)],
        },
        createdBy: humanActorId,
      })
      .returning({ id: schema.template.id });
    if (!template) throw new Error('task expansion test template was not created');
    const taskId = await createTask(app, teamId, 'The payment request must be checked.', {
      templateId: template.id,
    });
    injectExpander({
      async expandTask(input) {
        return {
          description: input.description ?? '',
          patch: {},
          subtasks: [],
          dependencies: [],
          relatedTaskIds: [],
          resourceUrls: [],
        };
      },
    });

    const response = await app.request(`/${taskId}/expand`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      task: { priority: string; labels: { id: string }[] };
    };
    expect(body.task.priority).toBe('high');
    expect(body.task.labels.map((candidate) => candidate.id)).toEqual([label.id]);
  });

  it('refuses expansion before sending an inaccessible personal template to the synthesizer', async () => {
    const { orgId, teamId, humanActorId } = await seedTaskAccessOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const [owner] = await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Grace' })
      .returning({ id: schema.actor.id });
    if (!owner) throw new Error('private-template owner was not created');
    const [template] = await db
      .insert(schema.template)
      .values({
        organizationId: orgId,
        targetType: 'task',
        name: 'Private incident process',
        scope: 'personal',
        ownerActorId: owner.id,
        payload: { targetType: 'task', description: '## Internal incident procedure' },
        createdBy: owner.id,
      })
      .returning({ id: schema.template.id });
    if (!template) throw new Error('private template was not created');
    const taskId = await createTask(app, teamId, 'The payment request must be checked.');
    await db.update(schema.task).set({ templateId: template.id }).where(eq(schema.task.id, taskId));
    const expandTask = vi.fn<TaskExpansionSynthesizer['expandTask']>();
    injectExpander({ expandTask });

    const response = await app.request(`/${taskId}/expand`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(404);
    expect(expandTask).not.toHaveBeenCalled();
  });

  it('rejects stale expansion input instead of overwriting a newer description', async () => {
    const { orgId, teamId, humanActorId } = await seedTaskAccessOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const taskId = await createTask(app, teamId, 'The payment request must be checked.');
    injectExpander({
      async expandTask(input) {
        await db
          .update(schema.task)
          .set({ description: 'A person changed this while expansion was running.' })
          .where(eq(schema.task.id, input.taskId));
        return {
          description: `${input.description ?? ''}\n\n## Next steps`,
          patch: {},
          subtasks: [],
          dependencies: [],
          relatedTaskIds: [],
          resourceUrls: [],
        };
      },
    });

    const response = await app.request(`/${taskId}/expand`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(409);
    expect(
      ((await (await app.request(`/${taskId}`)).json()) as { description: string }).description,
    ).toBe('A person changed this while expansion was running.');
  });

  it('rejects stale expansion labels instead of replacing a person’s new label', async () => {
    const { orgId, teamId, humanActorId } = await seedTaskAccessOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const [personLabel, inferredLabel] = await db
      .insert(schema.label)
      .values([
        { organizationId: orgId, name: 'Customer report', color: 'blue' },
        { organizationId: orgId, name: 'Incident', color: 'red' },
      ])
      .returning({ id: schema.label.id });
    if (!personLabel || !inferredLabel) throw new Error('label-race labels were not created');
    const taskId = await createTask(app, teamId, 'The payment request must be checked.');
    injectExpander({
      async expandTask(input) {
        await db.insert(schema.taskLabel).values({
          organizationId: orgId,
          taskId: input.taskId,
          labelId: personLabel.id,
        });
        return {
          description: input.description ?? '',
          patch: { labelIds: [inferredLabel.id] },
          subtasks: [],
          dependencies: [],
          relatedTaskIds: [],
          resourceUrls: [],
        };
      },
    });

    const response = await app.request(`/${taskId}/expand`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(409);
    expect(
      ((await (await app.request(`/${taskId}`)).json()) as { labels: { id: string }[] }).labels.map(
        (label) => label.id,
      ),
    ).toEqual([personLabel.id]);
  });

  it('persists, records, and undoes an allowed inferred label when no label already exists', async () => {
    const { orgId, teamId, humanActorId } = await seedTaskAccessOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const [label] = await db
      .insert(schema.label)
      .values({ organizationId: orgId, name: 'Incident', color: 'red' })
      .returning({ id: schema.label.id });
    if (!label) throw new Error('task expansion inferred-label test label was not created');
    const taskId = await createTask(app, teamId, 'The payment request must be checked.');
    injectExpander({
      async expandTask(input) {
        return {
          description: `${input.description ?? ''}\n\nThe incident needs a complete record.`,
          patch: { labelIds: [label.id] },
          subtasks: [],
          dependencies: [],
          relatedTaskIds: [],
          resourceUrls: [],
        };
      },
    });

    const expanded = await app.request(`/${taskId}/expand`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(expanded.status).toBe(200);
    const expandedBody = (await expanded.json()) as {
      undoToken: string;
      task: { labels: { id: string }[] };
    };
    expect(expandedBody.task.labels.map((candidate) => candidate.id)).toEqual([label.id]);

    const activity = await app.request(`/${taskId}/activity`);
    expect(activity.status).toBe(200);
    expect(
      (
        (await activity.json()) as {
          items: { change: { field: string; from: string | null; to: string | null } | null }[];
        }
      ).items,
    ).toContainEqual(
      expect.objectContaining({
        change: expect.objectContaining({ field: 'labels', from: null, to: 'Incident' }),
      }),
    );

    const undone = await app.request(`/${taskId}/expand/undo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ undoToken: expandedBody.undoToken }),
    });
    expect(undone.status).toBe(200);
    expect(((await undone.json()) as { task: { labels: unknown[] } }).task.labels).toEqual([]);

    const undoActivity = await app.request(`/${taskId}/activity`);
    expect(
      (
        (await undoActivity.json()) as {
          items: { change: { field: string; from: string | null; to: string | null } | null }[];
        }
      ).items,
    ).toContainEqual(
      expect.objectContaining({
        change: expect.objectContaining({ field: 'labels', from: 'Incident', to: null }),
      }),
    );
  });

  it('undoes a related-task-only expansion whose description did not change', async () => {
    const { orgId, teamId, humanActorId } = await seedTaskAccessOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const taskId = await createTask(app, teamId, 'The payment request must be checked.');
    const relatedTaskId = await createTask(app, teamId, 'Review the reconciliation logs.');
    injectExpander({
      async expandTask(input) {
        return {
          description: input.description ?? '',
          patch: {},
          subtasks: [],
          dependencies: [],
          relatedTaskIds: [relatedTaskId],
          resourceUrls: [],
        };
      },
    });

    const expanded = await app.request(`/${taskId}/expand`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(expanded.status).toBe(200);
    const { undoToken } = (await expanded.json()) as { undoToken: string };
    expect(undoToken).toEqual(expect.any(String));

    const undone = await app.request(`/${taskId}/expand/undo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ undoToken }),
    });
    expect(undone.status).toBe(200);
    expect(
      ((await undone.json()) as { task: { relatedTasks: unknown[] } }).task.relatedTasks,
    ).toEqual([]);
  });

  it('requires assign access for an inferred assignee', async () => {
    const { orgId, teamId, humanActorId } = await seedTaskAccessOrg(db, schema);
    await db
      .update(schema.grant)
      .set({ capabilities: ['contribute', 'assign'] })
      .where(
        and(
          eq(schema.grant.organizationId, orgId),
          eq(schema.grant.subjectKind, 'actor'),
          eq(schema.grant.subjectId, humanActorId),
          eq(schema.grant.resourceKind, 'organization'),
          eq(schema.grant.resourceId, orgId),
        ),
      );
    const app = appWithActor(tasks, orgId, ['contribute', 'assign'], humanActorId);
    const taskId = await createTask(app, teamId, 'The payment request must be checked.');
    injectExpander({
      async expandTask(input) {
        return {
          description: input.description ?? '',
          patch: { assigneeId: humanActorId },
          subtasks: [],
          dependencies: [],
          relatedTaskIds: [],
          resourceUrls: [],
        };
      },
    });
    await db
      .update(schema.grant)
      .set({ capabilities: ['contribute'] })
      .where(
        and(
          eq(schema.grant.organizationId, orgId),
          eq(schema.grant.subjectKind, 'actor'),
          eq(schema.grant.subjectId, humanActorId),
          eq(schema.grant.resourceKind, 'organization'),
          eq(schema.grant.resourceId, orgId),
        ),
      );

    const response = await app.request(`/${taskId}/expand`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(403);
    expect(
      ((await (await app.request(`/${taskId}`)).json()) as { assigneeId: string | null })
        .assigneeId,
    ).toBeNull();
  });

  it('rejects a stale team before creating expansion children', async () => {
    const { orgId, teamId, humanActorId } = await seedTaskAccessOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const [otherTeam] = await db
      .insert(schema.team)
      .values({ organizationId: orgId, name: 'Platform', key: `PLAT-${crypto.randomUUID()}` })
      .returning({ id: schema.team.id });
    if (!otherTeam) throw new Error('stale-team test team was not created');
    const taskId = await createTask(
      app,
      teamId,
      'Confirm the gateway response before checking the payment request.',
    );
    injectExpander({
      async expandTask(input) {
        await db
          .update(schema.task)
          .set({ teamId: otherTeam.id })
          .where(eq(schema.task.id, input.taskId));
        return {
          description: input.description ?? '',
          patch: {},
          subtasks: [
            {
              title: 'Confirm the gateway response',
              evidence: 'Confirm the gateway response before checking the payment request.',
            },
          ],
          dependencies: [],
          relatedTaskIds: [],
          resourceUrls: [],
        };
      },
    });

    const response = await app.request(`/${taskId}/expand`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(409);
    expect(
      ((await (await app.request(`/${taskId}`)).json()) as { subtasks: unknown[] }).subtasks,
    ).toEqual([]);
  });

  it('refuses undo without reversing anything after an expansion child changed', async () => {
    const { orgId, teamId, humanActorId } = await seedTaskAccessOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const taskId = await createTask(
      app,
      teamId,
      'Confirm the gateway response before checking the payment request.',
    );
    injectExpander({
      async expandTask() {
        return {
          description: 'The payment request must be checked.\n\n## Next steps',
          patch: {},
          subtasks: [
            {
              title: 'Confirm the gateway response',
              evidence: 'Confirm the gateway response before checking the payment request.',
            },
          ],
          dependencies: [],
          relatedTaskIds: [],
          resourceUrls: [],
        };
      },
    });

    const expanded = await app.request(`/${taskId}/expand`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const expandedBody = (await expanded.json()) as {
      undoToken: string;
      task: { description: string; subtasks: { id: string }[] };
    };
    const childId = expandedBody.task.subtasks[0]?.id;
    if (!childId) throw new Error('expansion child was not created');
    expect(expanded.status).toBe(200);

    const changed = await app.request(`/${childId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ priority: 'high' }),
    });
    expect(changed.status).toBe(200);

    const undone = await app.request(`/${taskId}/expand/undo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ undoToken: expandedBody.undoToken }),
    });
    expect(undone.status).toBe(409);
    const current = await app.request(`/${taskId}`);
    expect(
      ((await current.json()) as { description: string; subtasks: { id: string }[] }).description,
    ).toContain('## Next steps');
    expect((await app.request(`/${childId}`)).status).toBe(200);
  });

  it('refuses undo without reversing the description after its related edge changed', async () => {
    const { orgId, teamId, humanActorId } = await seedTaskAccessOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const taskId = await createTask(app, teamId, 'The payment request must be checked.');
    const relatedTaskId = await createTask(app, teamId, 'Review the reconciliation logs.');
    injectExpander({
      async expandTask() {
        return {
          description: 'The payment request must be checked.\n\n## Next steps',
          patch: {},
          subtasks: [],
          dependencies: [],
          relatedTaskIds: [relatedTaskId],
          resourceUrls: [],
        };
      },
    });

    const expanded = await app.request(`/${taskId}/expand`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const expandedBody = (await expanded.json()) as { undoToken: string };
    expect(expanded.status).toBe(200);
    await db
      .delete(schema.taskRelatedTask)
      .where(
        and(
          eq(schema.taskRelatedTask.organizationId, orgId),
          eq(schema.taskRelatedTask.taskId, taskId),
          eq(schema.taskRelatedTask.relatedTaskId, relatedTaskId),
        ),
      );

    const undone = await app.request(`/${taskId}/expand/undo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ undoToken: expandedBody.undoToken }),
    });
    expect(undone.status).toBe(409);
    expect(
      ((await (await app.request(`/${taskId}`)).json()) as { description: string }).description,
    ).toContain('## Next steps');
  });

  it('reopens an auto-completed parent for an expansion child and completes it again on undo', async () => {
    const { orgId, teamId, humanActorId } = await seedTaskAccessOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const parentId = await createTask(
      app,
      teamId,
      'Confirm the gateway response before checking the payment request.',
    );
    const completedChildId = await createTask(app, teamId, 'Record the existing fix.', {
      parentTaskId: parentId,
    });
    const finished = await app.request(`/${completedChildId}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });
    expect(finished.status).toBe(200);
    expect(
      ((await (await app.request(`/${parentId}`)).json()) as { autoCompletedBySubtasks: boolean })
        .autoCompletedBySubtasks,
    ).toBe(true);

    injectExpander({
      async expandTask() {
        return {
          description: 'The payment request must be checked.\n\n## Next steps',
          patch: {},
          subtasks: [
            {
              title: 'Confirm the gateway response',
              evidence: 'Confirm the gateway response before checking the payment request.',
            },
          ],
          dependencies: [],
          relatedTaskIds: [],
          resourceUrls: [],
        };
      },
    });
    const expanded = await app.request(`/${parentId}/expand`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const expandedBody = (await expanded.json()) as { undoToken: string };
    expect(expanded.status).toBe(200);
    expect(
      ((await (await app.request(`/${parentId}`)).json()) as { completedAt: string | null })
        .completedAt,
    ).toBeNull();

    const undone = await app.request(`/${parentId}/expand/undo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ undoToken: expandedBody.undoToken }),
    });
    expect(undone.status).toBe(200);
    expect(
      (
        (await (await app.request(`/${parentId}`)).json()) as {
          completedAt: string | null;
          autoCompletedBySubtasks: boolean;
        }
      ).completedAt,
    ).not.toBeNull();
  });

  it('drops an injected dependency that does not touch the expanded task', async () => {
    const { orgId, teamId, humanActorId } = await seedTaskAccessOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const taskId = await createTask(app, teamId, 'The payment request must be checked.');
    const firstTaskId = await createTask(app, teamId, 'Review the gateway logs.');
    const secondTaskId = await createTask(app, teamId, 'Deploy the correction.');
    injectExpander({
      async expandTask() {
        return {
          description: 'The payment request must be checked.\n\n## Next steps',
          patch: {},
          subtasks: [],
          dependencies: [{ blockingTaskId: firstTaskId, blockedTaskId: secondTaskId } as never],
          relatedTaskIds: [],
          resourceUrls: [],
        };
      },
    });

    const response = await app.request(`/${taskId}/expand`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      task: { blocking: unknown[]; blockedBy: unknown[] };
    };
    expect(body.task.blocking).toEqual([]);
    expect(body.task.blockedBy).toEqual([]);
  });

  it('does not record Activity for an expansion dependency that already exists', async () => {
    const { orgId, teamId, humanActorId } = await seedTaskAccessOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const blockedTaskId = await createTask(
      app,
      teamId,
      'Wait for Review gateway logs before Deploy correction.',
    );
    const blockingTaskId = await createTask(app, teamId, 'Review gateway logs.');
    await db
      .update(schema.task)
      .set({ title: 'Deploy correction' })
      .where(eq(schema.task.id, blockedTaskId));
    await db
      .update(schema.task)
      .set({ title: 'Review gateway logs' })
      .where(eq(schema.task.id, blockingTaskId));
    await db.insert(schema.taskDependency).values({
      organizationId: orgId,
      blockingTaskId,
      blockedTaskId,
    });
    injectExpander({
      async expandTask(input) {
        return {
          description: input.description ?? '',
          patch: {},
          subtasks: [],
          dependencies: [
            {
              blockingTaskId,
              blockedTaskId,
              evidence: 'Wait for Review gateway logs before Deploy correction.',
            },
          ],
          relatedTaskIds: [],
          resourceUrls: [],
        };
      },
    });

    const expanded = await app.request(`/${blockedTaskId}/expand`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(expanded.status).toBe(200);
    const activity = await app.request(`/${blockedTaskId}/activity`);
    const changes = (
      (await activity.json()) as {
        items: { change: { field: string } | null }[];
      }
    ).items.map((item) => item.change?.field);
    expect(changes).not.toContain('dependency');
  });

  it('expands the existing description and returns one undo token', async () => {
    const { orgId, teamId, humanActorId } = await seedTaskAccessOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const [template] = await db
      .insert(schema.template)
      .values({
        organizationId: orgId,
        targetType: 'task',
        name: 'Incident',
        scope: 'organization',
        ownerActorId: humanActorId,
        payload: { targetType: 'task', description: '## What happened' },
        createdBy: humanActorId,
      })
      .returning({ id: schema.template.id });
    if (!template) throw new Error('task expansion test template was not created');
    const taskId = await createTask(
      app,
      teamId,
      'Customers see a 500 after entering a postal code.',
      { templateId: template.id },
    );

    const response = await app.request(`/${taskId}/expand`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      task: {
        description: string | null;
        relatedTasks: unknown[];
        blocking: unknown[];
        blockedBy: unknown[];
        subtasks: unknown[];
      };
      undoToken: string | null;
    };
    expect(body.task.description).toContain('Customers see a 500 after entering a postal code.');
    expect(body.undoToken).toEqual(expect.any(String));
    expect(body.task.relatedTasks).toEqual([]);
    expect(body.task.blocking).toEqual([]);
    expect(body.task.blockedBy).toEqual([]);
    expect(body.task.subtasks).toEqual([]);

    const undone = await app.request(`/${taskId}/expand/undo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ undoToken: body.undoToken }),
    });
    expect(undone.status).toBe(200);
    const undoBody = (await undone.json()) as { task: { description: string | null } };
    expect(undoBody.task.description).toBe('Customers see a 500 after entering a postal code.');
  });

  it('requires the task-edit capability', async () => {
    const { orgId, teamId, humanActorId } = await seedTaskAccessOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const taskId = await createTask(writer, teamId, 'Keep the original request.');
    const reader = appWithActor(tasks, orgId, ['view'], humanActorId);

    const response = await reader.request(`/${taskId}/expand`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(403);
  });
});
