/**
 * Shared fixtures for change-set recording and undo tests: recorded and hand-written ledgers, and
 * the task, project, and label rows they point at.
 */
import { eq } from 'drizzle-orm';

import type * as DbModule from '@docket/db';

import type * as ChangeSetModule from '../../src/mcp/change-set';
import type { RecordedOrigin } from '@docket/work/provenance-contract';
import { getDb, one, seedBaseOrg, seedProject, seedTask } from '../support/routes-harness';

/** The seeded organization every scenario works in. */
export type Org = Awaited<ReturnType<typeof seedBaseOrg>>;

/** The loaded database and change-set modules. */
export interface ChangeSetModules {
  readonly schema: typeof DbModule;
  readonly db: typeof DbModule.db;
  readonly changeSets: typeof ChangeSetModule;
  readonly origin: () => RecordedOrigin;
}

/** One change-set entry written straight to the ledger, as an older or damaged writer left it. */
export interface RawEntry {
  readonly entityKind: string;
  readonly entityId: string;
  readonly op: 'create' | 'update' | 'archive' | 'link';
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
}

let loaded: Promise<ChangeSetModules> | undefined;

/** Load the migrated database and the change-set module once per test file. */
async function load(): Promise<ChangeSetModules> {
  const schema = await getDb();
  const changeSets = await import('../../src/mcp/change-set');
  const provenance = await import('../../src/lib/provenance/context');
  return {
    schema,
    db: schema.db,
    changeSets,
    origin: () => provenance.originFor('change-set-test', {}, provenance.appProvenance()),
  };
}

/** The database and change-set modules, loaded after the test database is migrated. */
export function changeSetModules(): Promise<ChangeSetModules> {
  loaded ??= load();
  return loaded;
}

/** Seed an organization with Docket Pro, a team, statuses, and a human actor. */
export async function seedWorkspace(): Promise<Org> {
  const { db, schema } = await changeSetModules();
  return seedBaseOrg(db, schema);
}

/** Write a change set and its entries directly, bypassing the recorder's normalization. */
export async function seedRawChangeSet(org: Org, entries: readonly RawEntry[]): Promise<string> {
  const { db, schema, origin } = await changeSetModules();
  const id = `cs_${Math.random().toString(36).slice(2, 12)}`;
  await db.insert(schema.changeSet).values({
    id,
    organizationId: org.orgId,
    actorId: org.humanActorId,
    origin: origin(),
    summary: 'Seeded change set',
  });
  if (entries.length > 0) {
    await db.insert(schema.changeSetEntry).values(entries.map((e) => ({ changeSetId: id, ...e })));
  }
  return id;
}

/** Record a change set through the public recorder and return its id. */
export async function record(
  org: Org,
  changes: readonly ChangeSetModule.RecordedChange[],
): Promise<string> {
  const { changeSets, origin } = await changeSetModules();
  const id = await changeSets.recordChangeSet({
    orgId: org.orgId,
    actorId: org.humanActorId,
    origin: origin(),
    summary: 'Recorded change set',
    changes,
  });
  if (!id) throw new Error('change set was not recorded');
  return id;
}

/**
 * A task label-set snapshot, in the stored shape `change-set-labels.ts` records.
 *
 * @remarks
 * Written out rather than built with `labelSetChange`, because importing that module statically
 * would load the database client before `changeSetModules` has prepared it.
 */
export function taskLabels(
  taskId: string,
  before: readonly string[],
  after: readonly string[],
): ChangeSetModule.StoredChange {
  return {
    kind: 'task_labels',
    id: taskId,
    op: 'update',
    before: { labelIds: [...before].sort() },
    after: { labelIds: [...after].sort() },
  };
}

/** Whether a change set has been marked undone. */
export async function isUndone(changeSetId: string): Promise<boolean> {
  const { db, schema } = await changeSetModules();
  const row = one(
    await db
      .select({ undoneAt: schema.changeSet.undoneAt })
      .from(schema.changeSet)
      .where(eq(schema.changeSet.id, changeSetId)),
  );
  return row.undoneAt !== null;
}

/** Seed a todo task in the org's team. */
export async function makeTask(
  org: Org,
  title = 'Task',
): Promise<typeof DbModule.task.$inferSelect> {
  const { db, schema } = await changeSetModules();
  return seedTask(db, schema, org.statusId, {
    organizationId: org.orgId,
    teamId: org.teamId,
    title,
    state: 'todo',
    createdBy: org.humanActorId,
  });
}

/** Seed a project in the org's team. */
export async function makeProject(
  org: Org,
  name = 'Project',
): Promise<typeof DbModule.project.$inferSelect> {
  const { db, schema } = await changeSetModules();
  return seedProject(db, schema, org.statusId, {
    organizationId: org.orgId,
    teamId: org.teamId,
    name,
    createdBy: org.humanActorId,
  });
}

/** Seed a workspace label and return its id. */
export async function makeLabel(org: Org, name: string): Promise<string> {
  const { db, schema } = await changeSetModules();
  return one(
    await db
      .insert(schema.label)
      .values({ organizationId: org.orgId, name, color: '#888888' })
      .returning({ id: schema.label.id }),
  ).id;
}

/** Attach an existing label to a task. */
export async function attachLabel(org: Org, taskId: string, labelId: string): Promise<void> {
  const { db, schema } = await changeSetModules();
  await db.insert(schema.taskLabel).values({ organizationId: org.orgId, taskId, labelId });
}

/** The sorted label ids on one task. */
export async function labelsOf(taskId: string): Promise<string[]> {
  const { db, schema } = await changeSetModules();
  const rows = await db
    .select({ labelId: schema.taskLabel.labelId })
    .from(schema.taskLabel)
    .where(eq(schema.taskLabel.taskId, taskId));
  return rows.map((row) => row.labelId).sort();
}
