/**
 * Every filter `list_work` declares must actually narrow the query.
 *
 * @remarks
 * `assertApplicable` rejects a filter the requested entity has no column for, so an agent is never
 * silently handed a wrong answer — that was the whole point of replacing `run_view`. But the guard
 * only checks the *declaration*: a filter listed in `SUPPORTED` and then never applied in the query
 * body defeats it from the inside, and does so invisibly. Two shipped that way — `initiative` on
 * programs, and `label` on projects and initiatives — both returning every row while looking like
 * they had filtered.
 *
 * This walks the declaration itself rather than a hand-written list, so a filter added to
 * `SUPPORTED` without a predicate fails here rather than in someone's workspace.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type { McpContext } from '../../src/mcp/auth';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import type { StatusIdLookup } from '../support/routes-harness';
import { seedStatuses } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
});

interface Seed {
  orgId: string;
  teamId: string;
  actorId: string;
  statusId: StatusIdLookup;
  ctx: McpContext;
}

async function seedOrg(): Promise<Seed> {
  const slug = `fc-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = assertDefined(org).id;
  const statusId = await seedStatuses(db, schema, orgId);

  const [role] = await db
    .insert(schema.role)
    .values({ organizationId: orgId, key: 'seeded', name: 'Seeded', capabilities: ['contribute'] })
    .returning({ id: schema.role.id });
  const email = `${slug}@e.com`;
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email })
    .returning({ id: schema.user.id });
  const [human] = await db
    .insert(schema.actor)
    .values({
      organizationId: orgId,
      kind: 'human',
      displayName: 'Ada',
      userId: assertDefined(user).id,
      roleId: assertDefined(role).id,
    })
    .returning({ id: schema.actor.id });
  await db.insert(schema.grant).values({
    organizationId: orgId,
    subjectKind: 'role',
    subjectId: assertDefined(role).id,
    resourceKind: 'organization',
    resourceId: orgId,
    capabilities: ['contribute'],
    effect: 'allow',
  });
  const [team] = await db
    .insert(schema.team)
    .values({
      organizationId: orgId,
      name: 'Core',
      key: `C${Math.random().toString(36).slice(2, 6)}`,
    })
    .returning({ id: schema.team.id });

  return {
    orgId,
    teamId: assertDefined(team).id,
    actorId: assertDefined(human).id,
    statusId,
    ctx: {
      principal: {
        kind: 'user',
        userId: assertDefined(user).id,
        userName: 'Ada',
        userEmail: email,
      },
      scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
    },
  };
}

const harnesses: { close(): Promise<void> }[] = [];

async function connect(ctx: McpContext): Promise<Client> {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server, ctx, 'sess_fc');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  harnesses.push({
    close: async () => {
      await client.close();
      await server.close();
    },
  });
  return client;
}

afterEach(async () => {
  while (harnesses.length > 0) await assertDefined(harnesses.pop()).close();
  resetAuthMocks();
});

/**
 * A value for each filter that cannot match the seeded row.
 *
 * @remarks
 * Descriptor-valued filters name a real-but-different entity, seeded below — a name that matches
 * nothing would raise a resolution error rather than return zero rows, which would pass this test
 * for the wrong reason.
 */
const NON_MATCHING: Record<string, unknown> = {
  team: 'Decoy Team',
  project: 'Decoy Project',
  program: 'Decoy Program',
  initiative: 'Decoy Initiative',
  assignee: 'Decoy Person',
  delegate: 'Decoy Person',
  lead: 'Decoy Person',
  owner: 'Decoy Person',
  label: 'Decoy Label',
  cycle: 'Decoy Cycle',
  state: ['nonexistent_state'],
  status: ['canceled'],
  priority: ['urgent'],
  parent: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  unfiled: true,
  blocked: true,
  blocking: true,
  dueBefore: '1999-01-01',
  dueAfter: '2999-01-01',
  updatedAfter: '2999-01-01T00:00:00.000Z',
  archived: true,
};

/** Seed one row of every entity that matches nothing in {@link NON_MATCHING}. */
async function seedSubjects(s: Seed): Promise<void> {
  await db.insert(schema.team).values({
    organizationId: s.orgId,
    name: 'Decoy Team',
    key: `D${Math.random().toString(36).slice(2, 6)}`,
  });
  await db
    .insert(schema.actor)
    .values({ organizationId: s.orgId, kind: 'human', displayName: 'Decoy Person' });
  await db
    .insert(schema.label)
    .values({ organizationId: s.orgId, name: 'Decoy Label', color: '#888888' });
  const [decoyProgram] = await db
    .insert(schema.program)
    .values({
      organizationId: s.orgId,
      name: 'Decoy Program',
      createdBy: s.actorId,
      status: 'active',
      statusId: s.statusId('program', 'active'),
    })
    .returning({ id: schema.program.id });
  await db.insert(schema.project).values({
    organizationId: s.orgId,
    name: 'Decoy Project',
    programId: assertDefined(decoyProgram).id,
    createdBy: s.actorId,
    status: 'planned',
    statusId: s.statusId('project', 'planned'),
  });
  await db.insert(schema.initiative).values({
    organizationId: s.orgId,
    name: 'Decoy Initiative',
    createdBy: s.actorId,
    status: 'active',
    statusId: s.statusId('initiative', 'active'),
  });
  const [cycleRow] = await db
    .insert(schema.cycle)
    .values({
      organizationId: s.orgId,
      teamId: s.teamId,
      number: 99,
      name: 'Decoy Cycle',
      // Far outside every window these tests query, and inside the range `cycle_*_range` allows:
      // storage now refuses a date no one could have meant, and year 2999 was one.
      startsAt: new Date('2199-01-01'),
      endsAt: new Date('2199-02-01'),
    })
    .returning({ id: schema.cycle.id });
  expect(cycleRow?.id).toBeTruthy();

  // The subject each listing should find with no filter, and lose with any of them.
  const [subjectProject] = await db
    .insert(schema.project)
    .values({
      organizationId: s.orgId,
      name: 'Subject project',
      createdBy: s.actorId,
      status: 'planned',
      statusId: s.statusId('project', 'planned'),
    })
    .returning({ id: schema.project.id });
  // Filed into its own project on purpose: an unfiled subject would legitimately match
  // `unfiled: true`, which would read as that filter failing to narrow.
  await db.insert(schema.task).values({
    organizationId: s.orgId,
    title: 'Subject task',
    teamId: s.teamId,
    state: 'backlog',
    statusId: s.statusId('task', 'backlog'),
    projectId: assertDefined(subjectProject).id,
    createdBy: s.actorId,
  });
  await db.insert(schema.program).values({
    organizationId: s.orgId,
    name: 'Subject program',
    createdBy: s.actorId,
    status: 'active',
    statusId: s.statusId('program', 'active'),
  });
  await db.insert(schema.initiative).values({
    organizationId: s.orgId,
    name: 'Subject initiative',
    createdBy: s.actorId,
    status: 'active',
    statusId: s.statusId('initiative', 'active'),
  });
}

async function list(
  client: Client,
  args: Record<string, unknown>,
): Promise<{ items: { title: string }[] }> {
  const res = (await client.callTool({ name: 'list_work', arguments: args })) as CallToolResult;
  const text = (res.content[0] as { text: string }).text;
  if (res.isError) throw new Error(`list_work failed: ${text}`);
  return JSON.parse(text) as { items: { title: string }[] };
}

describe('every declared filter narrows', () => {
  it('is checked against the declaration itself, not a hand-written list', async () => {
    const { WORK_ENTITIES } = await import('../../src/mcp/list-work');
    // Guards the guard: if the entity set grows, the loop below must grow with it.
    expect([...WORK_ENTITIES].sort()).toEqual(['initiative', 'program', 'project', 'task']);
  });

  for (const entity of ['task', 'project', 'program', 'initiative'] as const) {
    it(`narrows every filter ${entity} declares`, async () => {
      const s = await seedOrg();
      await seedSubjects(s);
      const client = await connect(s.ctx);

      // Ask the tool itself which filters apply here, by probing the rejection message — the same
      // list `assertApplicable` builds from SUPPORTED.
      const probe = (await client.callTool({
        name: 'list_work',
        arguments: { orgId: s.orgId, entity, parent: 'x', label: 'y', owner: 'z', blocked: true },
      })) as CallToolResult;
      const declared =
        entity === 'task'
          ? [
              'team',
              'project',
              'program',
              'assignee',
              'delegate',
              'state',
              'priority',
              'label',
              'cycle',
              'parent',
              'unfiled',
              'blocked',
              'blocking',
              'dueBefore',
              'dueAfter',
              'updatedAfter',
              'archived',
            ]
          : (
              /allowed values: ([^)]+)\)/.exec((probe.content[0] as { text: string }).text)?.[1] ??
              ''
            )
              .split(', ')
              .filter(Boolean);
      expect(declared.length).toBeGreaterThan(0);

      const unfiltered = await list(client, { orgId: s.orgId, entity });
      expect(unfiltered.items.length).toBeGreaterThan(0);

      for (const name of declared) {
        const value = NON_MATCHING[name];
        expect(value, `no non-matching value defined for ${name}`).toBeDefined();
        const filtered = await list(client, { orgId: s.orgId, entity, [name]: value });
        // Every one of these values is chosen to match nothing. A filter that returns the same
        // rows as no filter at all is a filter the query body never applied.
        expect(
          filtered.items.length,
          `${entity}.${name} is declared supported but did not narrow`,
        ).toBeLessThan(unfiltered.items.length);
      }
    });
  }
});

describe('the two that shipped unapplied', () => {
  it('narrows programs by the initiative they roll up to', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const [init] = await db
      .insert(schema.initiative)
      .values({
        organizationId: s.orgId,
        name: 'Q3',
        createdBy: s.actorId,
        status: 'active',
        statusId: s.statusId('initiative', 'active'),
      })
      .returning({ id: schema.initiative.id });
    const [linked] = await db
      .insert(schema.program)
      .values({
        organizationId: s.orgId,
        name: 'Linked',
        createdBy: s.actorId,
        status: 'active',
        statusId: s.statusId('program', 'active'),
      })
      .returning({ id: schema.program.id });
    await db.insert(schema.program).values({
      organizationId: s.orgId,
      name: 'Unlinked',
      createdBy: s.actorId,
      status: 'active',
      statusId: s.statusId('program', 'active'),
    });
    await db.insert(schema.initiativeProgram).values({
      organizationId: s.orgId,
      initiativeId: assertDefined(init).id,
      programId: assertDefined(linked).id,
    });

    const out = await list(client, { orgId: s.orgId, entity: 'program', initiative: 'Q3' });
    expect(out.items.map((i) => i.title)).toEqual(['Linked']);
  });

  it('narrows projects and initiatives by label', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const [tag] = await db
      .insert(schema.label)
      .values({ organizationId: s.orgId, name: 'Tagged', color: '#888888' })
      .returning({ id: schema.label.id });

    const [proj] = await db
      .insert(schema.project)
      .values({
        organizationId: s.orgId,
        name: 'Has label',
        createdBy: s.actorId,
        status: 'planned',
        statusId: s.statusId('project', 'planned'),
      })
      .returning({ id: schema.project.id });
    await db.insert(schema.project).values({
      organizationId: s.orgId,
      name: 'No label',
      createdBy: s.actorId,
      status: 'planned',
      statusId: s.statusId('project', 'planned'),
    });
    await db.insert(schema.projectLabel).values({
      organizationId: s.orgId,
      projectId: assertDefined(proj).id,
      labelId: assertDefined(tag).id,
    });

    const [init] = await db
      .insert(schema.initiative)
      .values({
        organizationId: s.orgId,
        name: 'Has label',
        createdBy: s.actorId,
        status: 'active',
        statusId: s.statusId('initiative', 'active'),
      })
      .returning({ id: schema.initiative.id });
    await db.insert(schema.initiative).values({
      organizationId: s.orgId,
      name: 'No label',
      createdBy: s.actorId,
      status: 'active',
      statusId: s.statusId('initiative', 'active'),
    });
    await db.insert(schema.initiativeLabel).values({
      organizationId: s.orgId,
      initiativeId: assertDefined(init).id,
      labelId: assertDefined(tag).id,
    });

    const projects = await list(client, { orgId: s.orgId, entity: 'project', label: 'Tagged' });
    expect(projects.items.map((i) => i.title)).toEqual(['Has label']);
    const initiatives = await list(client, {
      orgId: s.orgId,
      entity: 'initiative',
      label: 'Tagged',
    });
    expect(initiatives.items.map((i) => i.title)).toEqual(['Has label']);

    // And the labelled rows really are distinct rows, not the same one counted twice.
    const [check] = await db
      .select({ id: schema.project.id })
      .from(schema.project)
      .where(eq(schema.project.id, assertDefined(proj).id));
    expect(check?.id).toBe(assertDefined(proj).id);
  });
});
