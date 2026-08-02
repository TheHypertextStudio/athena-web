/**
 * The account-less actor contract (ENT-44 / ENT-45 / ENT-46).
 *
 * @remarks
 * The author's requirement is that a workspace can track people who hold no Docket account —
 * "a nonprofit may have volunteers that are not given Docket accounts, but they may need to be
 * treated like staff who can be assigned work" — and that nothing downstream treats them as
 * lesser. These tests hold that line at the API boundary:
 *
 * - an Actor persists with `user_id = null` and reads back with every attribute intact;
 * - the roster returns account-less and account-backed people in ONE list, ordered by name, so
 *   no client can accidentally group them;
 * - a task, a project and an initiative each accept an account-less assignee/lead/owner through
 *   the same endpoints and bodies used for a member, and the assignment survives a re-read;
 * - the person's profile resolves and reports that work.
 *
 * The negative case matters as much: if any of these paths ever starts consulting `user_id`,
 * exactly one of these assertions fails.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, fakeSession, getDb } from '../support/routes-harness';
import type membersRouter from '../../src/routes/members';
import type tasksRouter from '../../src/routes/tasks';
import type projectsRouter from '../../src/routes/projects';
import type initiativesRouter from '../../src/routes/initiatives';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let members!: typeof membersRouter;
let tasks!: typeof tasksRouter;
let projects!: typeof projectsRouter;
let initiatives!: typeof initiativesRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  members = (await import('../../src/routes/members')).default;
  tasks = (await import('../../src/routes/tasks')).default;
  projects = (await import('../../src/routes/projects')).default;
  initiatives = (await import('../../src/routes/initiatives')).default;
});

const J = { 'content-type': 'application/json' };

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface SeededOrg {
  orgId: string;
  teamId: string;
  ownerActorId: string;
  ownerRoleId: string;
  memberRoleId: string;
}

/** Seed a shared (non-personal) org with owner + member roles, an owner actor, and a team. */
async function seedOrg(opts: { personal?: boolean } = {}): Promise<SeededOrg> {
  const slug = `ppl-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active', isPersonal: opts.personal ?? false })
    .returning({ id: schema.organization.id });
  const orgId = org!.id;
  const [ownerRole] = await db
    .insert(schema.role)
    .values({
      organizationId: orgId,
      key: 'owner',
      name: 'Owner',
      isSystem: true,
      capabilities: ['manage'],
    })
    .returning({ id: schema.role.id });
  const [memberRole] = await db
    .insert(schema.role)
    .values({
      organizationId: orgId,
      key: 'member',
      name: 'Member',
      isSystem: true,
      capabilities: ['contribute'],
    })
    .returning({ id: schema.role.id });
  const [team] = await db
    .insert(schema.team)
    .values({ organizationId: orgId, name: 'General', key: 'GEN' })
    .returning({ id: schema.team.id });
  const [owner] = await db
    .insert(schema.actor)
    .values({
      organizationId: orgId,
      kind: 'human',
      displayName: 'Mara Owner',
      roleId: ownerRole!.id,
    })
    .returning({ id: schema.actor.id });
  return {
    orgId,
    teamId: team!.id,
    ownerActorId: owner!.id,
    ownerRoleId: ownerRole!.id,
    memberRoleId: memberRole!.id,
  };
}

/** A member actor backed by a real Better Auth user — the "staff" side of the comparison. */
async function seedAccountHolder(
  orgId: string,
  roleId: string,
  displayName: string,
): Promise<{ actorId: string; userId: string }> {
  const [user] = await db
    .insert(schema.user)
    .values({ name: displayName, email: `${Math.random().toString(36).slice(2)}@e.com` })
    .returning({ id: schema.user.id });
  const [row] = await db
    .insert(schema.actor)
    .values({
      organizationId: orgId,
      kind: 'human',
      displayName,
      userId: user!.id,
      roleId,
    })
    .returning({ id: schema.actor.id });
  return { actorId: row!.id, userId: user!.id };
}

describe('people — an actor with no Docket account', () => {
  it('persists with a null account link and reads back with every attribute intact (ENT-44)', async () => {
    const seeded = await seedOrg();
    const w = appWithActor(members, seeded.orgId, ['manage'], seeded.ownerActorId);

    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        displayName: 'Priya Volunteer',
        avatar: 'https://example.test/priya.png',
        roleId: seeded.memberRoleId,
      }),
    });
    expect(created.status).toBe(200);
    const person = await body<{
      actorId: string;
      organizationId: string;
      displayName: string;
      avatar: string | null;
      status: string;
      roleId: string | null;
      userId: string | null;
      createdAt: string;
    }>(created);

    expect(person.userId).toBeNull();
    expect(person.displayName).toBe('Priya Volunteer');
    expect(person.avatar).toBe('https://example.test/priya.png');
    expect(person.status).toBe('active');
    expect(person.roleId).toBe(seeded.memberRoleId);
    expect(person.organizationId).toBe(seeded.orgId);

    // Reload from the database, not from the response we just built, so this proves persistence
    // rather than serialization.
    const [stored] = await db
      .select()
      .from(schema.actor)
      .where(eq(schema.actor.id, person.actorId));
    expect(stored).toBeDefined();
    expect(stored!.userId).toBeNull();
    expect(stored!.kind).toBe('human');
    expect(stored!.displayName).toBe('Priya Volunteer');
    expect(stored!.avatar).toBe('https://example.test/priya.png');
    expect(stored!.roleId).toBe(seeded.memberRoleId);
    expect(stored!.status).toBe('active');

    // And through the read path a client actually uses.
    const reread = await w.request(`/${person.actorId}/profile`);
    expect(reread.status).toBe(200);
    const profile = await body<{ displayName: string; roleName: string | null }>(reread);
    expect(profile.displayName).toBe('Priya Volunteer');
    expect(profile.roleName).toBe('Member');
  });

  it('defaults to the org member role so the person is not a role-less oddity', async () => {
    const seeded = await seedOrg();
    const w = appWithActor(members, seeded.orgId, ['manage'], seeded.ownerActorId);
    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ displayName: 'Sam Steward' }),
    });
    expect(created.status).toBe(200);
    expect((await body<{ roleId: string | null }>(created)).roleId).toBe(seeded.memberRoleId);
  });

  it('refuses a cross-org role, a personal workspace, and a caller without manage', async () => {
    const seeded = await seedOrg();
    const other = await seedOrg();

    // 403 — adding to the roster is the same authority as inviting.
    const viewer = appWithActor(members, seeded.orgId, ['view'], seeded.ownerActorId);
    expect(
      (
        await viewer.request('/', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ displayName: 'Nope' }),
        })
      ).status,
    ).toBe(403);

    // 404 — another tenant's role would confer that tenant's capabilities through the bare FK.
    const w = appWithActor(members, seeded.orgId, ['manage'], seeded.ownerActorId);
    expect(
      (
        await w.request('/', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ displayName: 'Nope', roleId: other.memberRoleId }),
        })
      ).status,
    ).toBe(404);

    // 409 — a personal workspace is an org-of-one, same as `POST /invitations`.
    const personal = await seedOrg({ personal: true });
    const p = appWithActor(members, personal.orgId, ['manage'], personal.ownerActorId);
    expect(
      (
        await p.request('/', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ displayName: 'Nope' }),
        })
      ).status,
    ).toBe(409);
  });

  it('lists interleaved with account-holders by name, never grouped by account (ENT-46)', async () => {
    const seeded = await seedOrg();
    const w = appWithActor(members, seeded.orgId, ['manage'], seeded.ownerActorId);

    // Account-holders are seeded FIRST and named so that a name sort must interleave them.
    await seedAccountHolder(seeded.orgId, seeded.memberRoleId, 'Bea Staffer');
    await seedAccountHolder(seeded.orgId, seeded.memberRoleId, 'Dana Staffer');
    for (const name of ['Ana Volunteer', 'Cal Volunteer']) {
      const res = await w.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ displayName: name }),
      });
      expect(res.status).toBe(200);
    }

    const listed = await w.request('/');
    expect(listed.status).toBe(200);
    const page = await body<{ items: { displayName: string; userId: string | null }[] }>(listed);
    const names = page.items.map((m) => m.displayName);
    expect(names).toEqual([
      'Ana Volunteer',
      'Bea Staffer',
      'Cal Volunteer',
      'Dana Staffer',
      'Mara Owner',
    ]);

    // The interleaving is the assertion: insertion order or an account-first sort would have put
    // both volunteers at one end of the list.
    const accountFlags = page.items.map((m) => m.userId !== null);
    expect(accountFlags).toEqual([false, true, false, true, false]);
  });

  it('keeps `GET /invitations` reachable now that `/:actorId/profile` exists', async () => {
    const seeded = await seedOrg();
    const w = appWithActor(members, seeded.orgId, ['manage'], seeded.ownerActorId);
    const res = await w.request('/invitations');
    expect(res.status).toBe(200);
    expect(await body<{ items: unknown[] }>(res)).toEqual({ items: [] });
  });

  it('is renamable and removable through the same endpoints as an account-holder', async () => {
    const seeded = await seedOrg();
    const w = appWithActor(members, seeded.orgId, ['manage'], seeded.ownerActorId);
    const staff = await seedAccountHolder(seeded.orgId, seeded.memberRoleId, 'Old Staff Name');

    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ displayName: 'Old Volunteer Name' }),
    });
    const volunteerId = (await body<{ actorId: string }>(created)).actorId;

    for (const [actorId, next] of [
      [volunteerId, 'New Volunteer Name'],
      [staff.actorId, 'New Staff Name'],
    ] as const) {
      const patched = await w.request(`/${actorId}/profile`, {
        method: 'PATCH',
        headers: J,
        body: JSON.stringify({ displayName: next }),
      });
      expect(patched.status).toBe(200);
      expect((await body<{ displayName: string }>(patched)).displayName).toBe(next);
    }

    // Removal is the shared `DELETE /:actorId`, with no account-presence branch.
    const removed = await w.request(`/${volunteerId}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(await body<{ removed: boolean }>(removed)).toEqual({ id: volunteerId, removed: true });
  });

  it('resolves a profile for a person holding no role at all', async () => {
    // The org's `member` role is the default, but a role can be cleared, and an org seeded before
    // roles existed has none. A person is still a person; their profile must still open.
    const seeded = await seedOrg();
    const w = appWithActor(members, seeded.orgId, ['manage'], seeded.ownerActorId);
    const [roleless] = await db
      .insert(schema.actor)
      .values({ organizationId: seeded.orgId, kind: 'human', displayName: 'Roleless Rae' })
      .returning({ id: schema.actor.id });

    const res = await w.request(`/${roleless!.id}/profile`);
    expect(res.status).toBe(200);
    const profile = await body<{ roleId: string | null; roleName: string | null }>(res);
    expect(profile.roleId).toBeNull();
    expect(profile.roleName).toBeNull();
  });

  it('treats an empty profile patch as a no-op that still returns the person', async () => {
    const seeded = await seedOrg();
    const w = appWithActor(members, seeded.orgId, ['manage'], seeded.ownerActorId);
    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ displayName: 'Unchanged Uma', avatar: 'https://example.test/u.png' }),
    });
    const actorId = (await body<{ actorId: string }>(created)).actorId;

    const patched = await w.request(`/${actorId}/profile`, {
      method: 'PATCH',
      headers: J,
      body: '{}',
    });
    expect(patched.status).toBe(200);
    const profile = await body<{ displayName: string; avatar: string | null }>(patched);
    expect(profile.displayName).toBe('Unchanged Uma');
    expect(profile.avatar).toBe('https://example.test/u.png');

    // …and a patch that clears the avatar actually clears it.
    const cleared = await w.request(`/${actorId}/profile`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ avatar: null }),
    });
    expect((await body<{ avatar: string | null }>(cleared)).avatar).toBeNull();

    // A patch aimed at a non-person 404s the same way the read does.
    expect(
      (
        await w.request('/01ARZ3NDEKTSV4RRFFQ69G5FAV/profile', {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ displayName: 'Nope' }),
        })
      ).status,
    ).toBe(404);
  });

  it('404s a profile for an agent actor, a team actor, and another tenant (existence-hiding)', async () => {
    const seeded = await seedOrg();
    const other = await seedOrg();
    const w = appWithActor(members, seeded.orgId, ['manage'], seeded.ownerActorId);

    const [agent] = await db
      .insert(schema.actor)
      .values({ organizationId: seeded.orgId, kind: 'agent', displayName: 'Athena' })
      .returning({ id: schema.actor.id });
    const [teamActor] = await db
      .insert(schema.actor)
      .values({ organizationId: seeded.orgId, kind: 'team', displayName: 'General' })
      .returning({ id: schema.actor.id });

    for (const id of [agent!.id, teamActor!.id, other.ownerActorId, '01ARZ3NDEKTSV4RRFFQ69G5FAV']) {
      expect((await w.request(`/${id}/profile`)).status).toBe(404);
    }
  });
});

describe('people — assigning work to someone with no account (ENT-45)', () => {
  it('accepts an account-less actor as task assignee, project lead, and initiative owner', async () => {
    const seeded = await seedOrg();
    const session = fakeSession('u_people_assign');
    const membersApp = appWithActor(members, seeded.orgId, ['manage'], seeded.ownerActorId);

    const created = await membersApp.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ displayName: 'Rae Volunteer' }),
    });
    expect(created.status).toBe(200);
    const volunteerId = (await body<{ actorId: string }>(created)).actorId;

    // A task, through the same POST /tasks body a member assignment uses.
    const tasksApp = appWithActor(
      tasks,
      seeded.orgId,
      ['contribute', 'assign'],
      seeded.ownerActorId,
      session,
    );
    const taskRes = await tasksApp.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        title: 'Staff the Saturday shift',
        teamId: seeded.teamId,
        assigneeId: volunteerId,
      }),
    });
    expect(taskRes.status).toBe(200);
    const task = await body<{ id: string; assigneeId: string | null }>(taskRes);
    expect(task.assigneeId).toBe(volunteerId);

    // A project lead, through PATCH — the reassignment path, not just create.
    const projectsApp = appWithActor(
      projects,
      seeded.orgId,
      ['contribute', 'assign'],
      seeded.ownerActorId,
      session,
    );
    const projectRes = await projectsApp.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'Food drive' }),
    });
    expect(projectRes.status).toBe(200);
    const projectId = (await body<{ id: string }>(projectRes)).id;
    const leadRes = await projectsApp.request(`/${projectId}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ leadId: volunteerId }),
    });
    expect(leadRes.status).toBe(200);
    expect((await body<{ leadId: string | null }>(leadRes)).leadId).toBe(volunteerId);

    // An initiative owner.
    const initiativesApp = appWithActor(
      initiatives,
      seeded.orgId,
      ['contribute', 'assign'],
      seeded.ownerActorId,
      session,
    );
    const initiativeRes = await initiativesApp.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'Feed the valley', ownerId: volunteerId }),
    });
    expect(initiativeRes.status).toBe(200);
    const initiative = await body<{ id: string; ownerId: string | null }>(initiativeRes);
    expect(initiative.ownerId).toBe(volunteerId);

    // Every assignment survives a re-read, and the person's own profile reports all three — so
    // their work is queryable exactly like a member's.
    const profileRes = await membersApp.request(`/${volunteerId}/profile`);
    expect(profileRes.status).toBe(200);
    const profile = await body<{
      assignedTasks: { id: string; title: string }[];
      ledProjects: { id: string; name: string }[];
      ownedInitiatives: { id: string; name: string }[];
    }>(profileRes);
    expect(profile.assignedTasks.map((t) => t.id)).toEqual([task.id]);
    expect(profile.assignedTasks[0]?.title).toBe('Staff the Saturday shift');
    expect(profile.ledProjects.map((p) => p.id)).toEqual([projectId]);
    expect(profile.ownedInitiatives.map((i) => i.id)).toEqual([initiative.id]);
  });

  it('applies the same tenant guard to an account-less actor as to a member', async () => {
    const seeded = await seedOrg();
    const other = await seedOrg();
    const foreign = appWithActor(members, other.orgId, ['manage'], other.ownerActorId);
    const created = await foreign.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ displayName: 'Wrong Tenant' }),
    });
    const foreignActorId = (await body<{ actorId: string }>(created)).actorId;

    const tasksApp = appWithActor(
      tasks,
      seeded.orgId,
      ['contribute', 'assign'],
      seeded.ownerActorId,
      fakeSession('u_people_tenant'),
    );
    const res = await tasksApp.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        title: 'Cross-tenant assignment',
        teamId: seeded.teamId,
        assigneeId: foreignActorId,
      }),
    });
    expect(res.status).toBe(404);
  });
});
