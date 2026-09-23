/**
 * `@docket/api` — the provenance read endpoint: where an entity came from and who last changed it.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { ChangeOrigin, RecordedOrigin } from '@docket/work/provenance-contract';

import type * as ChangeSetModule from '../../src/mcp/change-set';
import type * as ProvenanceContext from '../../src/lib/provenance/context';
import type provenanceRouter from '../../src/routes/provenance';
import {
  appWithActor,
  getDb,
  seedInitiative,
  seedProgram,
  seedProject,
  seedTask,
  seedTaskAccessOrg,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let router!: typeof provenanceRouter;
let changeSets!: typeof ChangeSetModule;
let context!: typeof ProvenanceContext;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  router = (await import('../../src/routes/provenance')).default;
  changeSets = await import('../../src/mcp/change-set');
  context = await import('../../src/lib/provenance/context');
});

/** The seeded organization a scenario runs in. */
type Org = Awaited<ReturnType<typeof seedTaskAccessOrg>>;

/** One side of the provenance answer, as the endpoint returns it. */
interface EventBody {
  readonly at: string;
  readonly channel: string;
  readonly surface: string | null;
  readonly performerKind: string;
  readonly performerName: string | null;
  readonly authorityActorId: string | null;
  readonly authorityName: string | null;
  readonly clientName: string | null;
  readonly provider: string | null;
  readonly sessionId: string | null;
  readonly planId: string | null;
}

/** The provenance answer, as the endpoint returns it. */
interface ProvenanceBody {
  readonly created: EventBody | null;
  readonly lastChanged: EventBody | null;
  readonly changeCount: number;
}

/** A change a person made on the task detail page. */
function appOrigin(tool: string): RecordedOrigin {
  return context.originFor(tool, {}, context.appProvenance('detail'));
}

/** A change Claude Code made over MCP on a session. */
function mcpOrigin(tool: string): RecordedOrigin {
  return context.originFor(
    tool,
    { sessionId: 'mcp_session_1' },
    context.clientProvenance('mcp', { name: 'Claude Code', id: 'client_claude' }),
  );
}

/** Seconds past now for the next seeded change, so seeded changes order strictly. */
let sequence = 0;

/** Record one change to a task, strictly after the previous one, and return the change-set id. */
async function recordTaskChange(
  org: Org,
  taskId: string,
  op: 'create' | 'update',
  origin: ChangeOrigin,
): Promise<string> {
  const id = `cs_${Math.random().toString(36).slice(2, 12)}`;
  sequence += 1;
  await db.insert(schema.changeSet).values({
    id,
    organizationId: org.orgId,
    actorId: org.humanActorId,
    origin,
    summary: 'Seeded change',
    createdAt: new Date(Date.now() + sequence * 1000),
  });
  await db.insert(schema.changeSetEntry).values({
    changeSetId: id,
    entityKind: 'task',
    entityId: taskId,
    op,
    before: op === 'create' ? null : { title: 'Before' },
    after: { title: 'After' },
  });
  return id;
}

/** Seed a task in the org's team. */
async function makeTask(org: Org, visibility: 'public' | 'private' = 'public'): Promise<string> {
  const row = await seedTask(db, schema, org.statusId, {
    organizationId: org.orgId,
    teamId: org.teamId,
    title: 'Provenance subject',
    state: 'todo',
    visibility,
    createdBy: org.humanActorId,
  });
  return row.id;
}

/** Read the endpoint as the org's human actor. */
async function readProvenance(
  org: Org,
  path: string,
  actorId = org.humanActorId,
): Promise<Response> {
  return appWithActor(router, org.orgId, ['view'], actorId).request(path);
}

/** Read the endpoint and parse a 200 answer. */
async function provenanceOf(org: Org, path: string): Promise<ProvenanceBody> {
  const res = await readProvenance(org, path);
  expect(res.status).toBe(200);
  return (await res.json()) as ProvenanceBody;
}

describe('GET /provenance/:kind/:id', () => {
  it('names the app creation and the later MCP change, with the authorizing member on both', async () => {
    const org = await seedTaskAccessOrg(db, schema);
    const taskId = await makeTask(org);
    await recordTaskChange(org, taskId, 'create', appOrigin('create_task'));
    await recordTaskChange(org, taskId, 'update', mcpOrigin('update'));

    const body = await provenanceOf(org, `/task/${taskId}`);

    expect(body.changeCount).toBe(2);
    expect(body.created).toMatchObject({
      channel: 'app',
      surface: 'detail',
      performerKind: 'person',
      performerName: null,
      authorityActorId: org.humanActorId,
      clientName: null,
      provider: null,
      sessionId: null,
    });
    expect(body.created?.authorityName).toBeTruthy();
    expect(body.lastChanged).toMatchObject({
      channel: 'mcp',
      surface: null,
      performerKind: 'agent',
      performerName: 'Claude Code',
      authorityActorId: org.humanActorId,
      clientName: 'Claude Code',
      sessionId: 'mcp_session_1',
    });
    expect(body.lastChanged?.authorityName).toBe(body.created?.authorityName);
  });

  it('answers through the recorder the REST and MCP entry points share', async () => {
    const org = await seedTaskAccessOrg(db, schema);
    const taskId = await makeTask(org);
    await changeSets.recordChangeSet({
      orgId: org.orgId,
      actorId: org.humanActorId,
      origin: appOrigin('create_task'),
      summary: 'Created a task',
      changes: [{ kind: 'task', id: taskId, op: 'create', after: { title: 'After' } }],
    });

    const body = await provenanceOf(org, `/task/${taskId}`);

    expect(body.created).toMatchObject({ channel: 'app', performerKind: 'person' });
    expect(body.lastChanged).toBeNull();
    expect(body.changeCount).toBe(1);
  });

  it('leaves undone change sets out of the latest change and the count', async () => {
    const org = await seedTaskAccessOrg(db, schema);
    const taskId = await makeTask(org);
    await recordTaskChange(org, taskId, 'create', appOrigin('create_task'));
    await recordTaskChange(org, taskId, 'update', appOrigin('update_task'));
    const undone = await recordTaskChange(org, taskId, 'update', mcpOrigin('update'));
    await db
      .update(schema.changeSet)
      .set({ undoneAt: new Date() })
      .where(eq(schema.changeSet.id, undone));

    const body = await provenanceOf(org, `/task/${taskId}`);

    expect(body.changeCount).toBe(2);
    expect(body.lastChanged).toMatchObject({ channel: 'app', performerKind: 'person' });
  });

  it('normalizes first-version origins and omits a side it cannot place', async () => {
    const org = await seedTaskAccessOrg(db, schema);
    const taskId = await makeTask(org);
    await recordTaskChange(org, taskId, 'create', { tool: 'capture', client: 'Cursor' });
    await recordTaskChange(org, taskId, 'update', { tool: 'update' });

    const body = await provenanceOf(org, `/task/${taskId}`);

    expect(body.created).toMatchObject({
      channel: 'mcp',
      performerKind: 'agent',
      performerName: 'Cursor',
      clientName: 'Cursor',
    });
    expect(body.lastChanged).toBeNull();
    expect(body.changeCount).toBe(2);
  });

  it('answers with empty sides for work that predates provenance', async () => {
    const org = await seedTaskAccessOrg(db, schema);
    const taskId = await makeTask(org);

    expect(await provenanceOf(org, `/task/${taskId}`)).toEqual({
      created: null,
      lastChanged: null,
      changeCount: 0,
    });
  });

  it('answers for projects, programs, and initiatives', async () => {
    const org = await seedTaskAccessOrg(db, schema);
    const owned = { organizationId: org.orgId, createdBy: org.humanActorId };
    const project = await seedProject(db, schema, org.statusId, {
      ...owned,
      teamId: org.teamId,
      name: 'Project',
    });
    const program = await seedProgram(db, schema, org.statusId, { ...owned, name: 'Program' });
    const initiative = await seedInitiative(db, schema, org.statusId, {
      ...owned,
      name: 'Initiative',
    });
    await changeSets.recordChangeSet({
      orgId: org.orgId,
      actorId: org.humanActorId,
      origin: mcpOrigin('create_project'),
      summary: 'Created a project',
      changes: [{ kind: 'project', id: project.id, op: 'create', after: { name: 'Project' } }],
    });

    const projectBody = await provenanceOf(org, `/project/${project.id}`);
    expect(projectBody.created).toMatchObject({ channel: 'mcp', clientName: 'Claude Code' });
    expect(projectBody.changeCount).toBe(1);
    expect((await provenanceOf(org, `/program/${program.id}`)).changeCount).toBe(0);
    expect((await provenanceOf(org, `/initiative/${initiative.id}`)).changeCount).toBe(0);
  });

  it('returns 404 for an entity in another organization', async () => {
    const org = await seedTaskAccessOrg(db, schema);
    const foreign = await seedTaskAccessOrg(db, schema);
    const foreignTask = await makeTask(foreign);
    await recordTaskChange(foreign, foreignTask, 'create', appOrigin('create_task'));
    const foreignProject = await seedProject(db, schema, foreign.statusId, {
      organizationId: foreign.orgId,
      teamId: foreign.teamId,
      name: 'Foreign',
      createdBy: foreign.humanActorId,
    });

    expect((await readProvenance(org, `/task/${foreignTask}`)).status).toBe(404);
    expect((await readProvenance(org, `/project/${foreignProject.id}`)).status).toBe(404);
  });

  it('returns 404 for a private task the caller cannot see', async () => {
    const org = await seedTaskAccessOrg(db, schema);
    const taskId = await makeTask(org, 'private');
    const [outsider] = await db
      .insert(schema.actor)
      .values({ organizationId: org.orgId, kind: 'human', displayName: 'Outsider' })
      .returning({ id: schema.actor.id });
    if (!outsider) throw new Error('outsider was not seeded');

    expect((await readProvenance(org, `/task/${taskId}`, outsider.id)).status).toBe(404);
    expect((await readProvenance(org, `/task/${taskId}`)).status).toBe(200);
  });

  it('rejects an entity kind it does not answer for', async () => {
    const org = await seedTaskAccessOrg(db, schema);

    expect((await readProvenance(org, '/cycle/anything')).status).toBe(422);
  });
});
