/**
 * `@docket/api` — task Activity rows carry where their change came from.
 *
 * @remarks
 * The creation row reads the change set that created the task; field-change rows read the origin
 * their audit event recorded. Rows with no change behind them (comments here) carry none.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { ChangeOrigin } from '@docket/work/provenance-contract';

import type * as ProvenanceContext from '../../src/lib/provenance/context';
import type tasksRouter from '../../src/routes/tasks';
import { appWithActor, getDb, seedTask, seedTaskAccessOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let tasks!: typeof tasksRouter;
let context!: typeof ProvenanceContext;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  tasks = (await import('../../src/routes/tasks')).default;
  context = await import('../../src/lib/provenance/context');
});

/** The seeded organization a scenario runs in. */
type Org = Awaited<ReturnType<typeof seedTaskAccessOrg>>;

/** An Activity entry's origin, as the endpoint returns it. */
interface OriginBody {
  readonly channel: string;
  readonly surface: string | null;
  readonly performerKind: string;
  readonly performerName: string | null;
  readonly clientName: string | null;
  readonly provider: string | null;
}

/** The part of an Activity entry these tests read. */
interface EntryBody {
  readonly id: string;
  readonly type: string;
  readonly origin: OriginBody | null;
}

/** Seconds past now for the next seeded row, so the feed order is fixed. */
let sequence = 0;

/** The next strictly later timestamp. */
function nextAt(): Date {
  sequence += 1;
  return new Date(Date.now() + sequence * 1000);
}

/** Record a field change on the task's audit ledger with the given origin. */
async function auditChange(org: Org, taskId: string, origin: ChangeOrigin | null): Promise<string> {
  const [row] = await db
    .insert(schema.auditEvent)
    .values({
      organizationId: org.orgId,
      actorId: org.humanActorId,
      subjectType: 'task',
      subjectId: taskId,
      type: 'updated',
      metadata: { field: 'title', label: 'Title', from: 'Before', to: 'After' },
      origin,
      createdAt: nextAt(),
    })
    .returning({ id: schema.auditEvent.id });
  if (!row) throw new Error('audit event was not seeded');
  return `audit:${row.id}`;
}

/** Read the task's Activity as its org's human actor. */
async function activityOf(org: Org, taskId: string): Promise<readonly EntryBody[]> {
  const res = await appWithActor(tasks, org.orgId, ['view'], org.humanActorId).request(
    `/${taskId}/activity`,
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: EntryBody[] }).items;
}

/** The entry with `id`, failing when it is missing. */
function entry(items: readonly EntryBody[], id: string): EntryBody {
  const found = items.find((item) => item.id === id);
  if (!found) throw new Error(`missing activity entry ${id}`);
  return found;
}

describe('task Activity origin', () => {
  it('names the channel and performer of the creation and of each recorded field change', async () => {
    const org = await seedTaskAccessOrg(db, schema);
    const task = await seedTask(db, schema, org.statusId, {
      organizationId: org.orgId,
      teamId: org.teamId,
      title: 'Traced',
      state: 'todo',
      createdBy: org.humanActorId,
    });
    await db.insert(schema.changeSet).values({
      id: `cs_${task.id}`,
      organizationId: org.orgId,
      actorId: org.humanActorId,
      origin: context.originFor(
        'create_task',
        {},
        context.clientProvenance('mcp', { name: 'Claude Code' }),
      ),
      summary: 'Created a task',
    });
    await db.insert(schema.changeSetEntry).values({
      changeSetId: `cs_${task.id}`,
      entityKind: 'task',
      entityId: task.id,
      op: 'create',
      after: { title: 'Traced' },
    });
    const appChange = await auditChange(
      org,
      task.id,
      context.originFor('update_task', {}, context.appProvenance('detail')),
    );
    const legacyChange = await auditChange(org, task.id, { tool: 'update', client: 'Cursor' });
    const unrecorded = await auditChange(org, task.id, null);
    await db.insert(schema.comment).values({
      organizationId: org.orgId,
      authorId: org.humanActorId,
      subjectType: 'task',
      subjectId: task.id,
      body: 'A comment',
      createdAt: nextAt(),
    });

    const items = await activityOf(org, task.id);

    const created = items.find((item) => item.type === 'created');
    expect(created?.origin).toEqual({
      channel: 'mcp',
      surface: null,
      performerKind: 'agent',
      performerName: 'Claude Code',
      clientName: 'Claude Code',
      provider: null,
    });
    expect(entry(items, appChange).origin).toMatchObject({
      channel: 'app',
      surface: 'detail',
      performerKind: 'person',
      performerName: null,
    });
    expect(entry(items, legacyChange).origin).toMatchObject({
      channel: 'mcp',
      performerKind: 'agent',
      clientName: 'Cursor',
    });
    expect(entry(items, unrecorded).origin).toBeNull();
    expect(items.find((item) => item.type === 'comment')?.origin).toBeNull();
  });

  it('leaves the creation origin empty for a task no recorded change created', async () => {
    const org = await seedTaskAccessOrg(db, schema);
    const task = await seedTask(db, schema, org.statusId, {
      organizationId: org.orgId,
      teamId: org.teamId,
      title: 'Untraced',
      state: 'todo',
      createdBy: org.humanActorId,
    });

    const items = await activityOf(org, task.id);

    expect(items.find((item) => item.type === 'created')?.origin).toBeNull();
  });
});
