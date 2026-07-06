import {
  actor,
  type Database,
  grant,
  organization,
  program,
  project,
  role,
  task,
  team,
} from '@docket/db';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ancestorChain, type ResourceRef } from '../src/ancestor-chain';
import { canActor } from '../src/can-actor';
import { effectiveVisibility, visibilityGrantsView } from '../src/visibility';
import {
  lastOwnerGuard,
  LastOwnerError,
  noSelfEscalation,
  SelfEscalationError,
} from '../src/write-guards';

let db!: Database;
let orgId!: string;
let ownerRoleId!: string;
let memberRoleId!: string;
let guestRoleId!: string;
let ownerActorId!: string;
let memberActorId!: string;
let guestActorId!: string;
let suspendedActorId!: string;
let teamId!: string;
let isolatedTeamId!: string;
let programId!: string;
let projectId!: string;
let projectUnderTeamOnlyId!: string;
let projectUnderProgramOnlyId!: string;
let projectExpiredId!: string;
let projectFutureId!: string;
let taskFullId!: string;
let taskBareId!: string;
let client: PGlite | undefined;

async function bootstrapAuthzSchema(client: PGlite): Promise<void> {
  await client.exec(`
    create type actor_kind as enum ('human', 'agent', 'team');
    create type actor_status as enum ('active', 'suspended');
    create type org_lifecycle_state as enum (
      'trialing',
      'active',
      'past_due',
      'export_window',
      'pending_deletion',
      'deleted'
    );
    create type program_status as enum ('active', 'paused', 'archived');
    create type project_status as enum ('planned', 'active', 'completed', 'canceled');
    create type health as enum ('on_track', 'at_risk', 'off_track');
    create type task_priority as enum ('none', 'urgent', 'high', 'medium', 'low');
    create type provenance_source as enum ('native', 'linked');
    create type sync_mode as enum ('import', 'mirror');
    create type grant_capability as enum ('view', 'comment', 'contribute', 'assign', 'manage');
    create type grant_subject_kind as enum ('actor', 'role');
    create type resource_kind as enum (
      'organization',
      'team',
      'initiative',
      'program',
      'project',
      'cycle',
      'task'
    );
    create type visibility as enum ('public', 'private');
    create type grant_effect as enum ('allow', 'deny');

    create table "organization" (
      id text primary key,
      name text not null,
      slug text not null,
      purpose text,
      avatar text,
      is_personal boolean not null default false,
      vocabulary jsonb not null default '{}'::jsonb,
      agent_guidance text,
      approval_routing jsonb,
      lifecycle_state org_lifecycle_state not null default 'trialing',
      export_ready_at timestamp,
      delete_after_at timestamp,
      created_at timestamp not null default now(),
      updated_at timestamp not null default now(),
      archived_at timestamp
    );

    create table "role" (
      id text primary key,
      organization_id text not null,
      key text not null,
      name text not null,
      is_system boolean not null default false,
      capabilities jsonb not null default '[]'::jsonb,
      base_capability grant_capability,
      default_visibility visibility not null default 'public',
      created_at timestamp not null default now(),
      updated_at timestamp not null default now()
    );

    create table "actor" (
      id text primary key,
      organization_id text not null,
      kind actor_kind not null,
      display_name text not null,
      avatar text,
      status actor_status not null default 'active',
      user_id text,
      role_id text,
      created_at timestamp not null default now(),
      updated_at timestamp not null default now(),
      archived_at timestamp
    );

    create table "team" (
      id text primary key,
      organization_id text not null,
      name text not null,
      key text not null,
      description text,
      workflow_states jsonb not null default '[]'::jsonb,
      triage_enabled boolean not null default true,
      cycle_cadence_weeks integer not null default 1,
      agent_guidance text,
      approval_routing jsonb,
      visibility visibility not null default 'public',
      ancestor_path text[] not null default '{}'::text[],
      created_at timestamp not null default now(),
      updated_at timestamp not null default now(),
      archived_at timestamp
    );

    create table "program" (
      id text primary key,
      organization_id text not null,
      created_by text,
      created_at timestamp not null default now(),
      updated_at timestamp not null default now(),
      archived_at timestamp,
      name text not null,
      description text,
      owner_id text,
      status program_status not null default 'active',
      health health,
      visibility visibility not null default 'public',
      ancestor_path text[] not null default '{}'::text[]
    );

    create table "project" (
      id text primary key,
      organization_id text not null,
      created_by text,
      created_at timestamp not null default now(),
      updated_at timestamp not null default now(),
      archived_at timestamp,
      name text not null,
      description text,
      lead_id text,
      program_id text,
      team_id text,
      status project_status not null default 'planned',
      health health,
      start_date timestamp,
      target_date timestamp,
      visibility visibility not null default 'public',
      ancestor_path text[] not null default '{}'::text[]
    );

    create table "task" (
      id text primary key,
      organization_id text not null,
      created_by text,
      created_at timestamp not null default now(),
      updated_at timestamp not null default now(),
      archived_at timestamp,
      title text not null,
      description text,
      team_id text not null,
      state text not null,
      priority task_priority not null default 'none',
      assignee_id text,
      delegate_id text,
      project_id text,
      program_id text,
      milestone_id text,
      cycle_id text,
      parent_task_id text,
      estimate integer,
      estimate_minutes integer,
      due_date timestamp,
      source provenance_source not null default 'native',
      source_integration_id text,
      external_id text,
      external_url text,
      source_sync_mode sync_mode,
      completed_at timestamp,
      canceled_at timestamp,
      visibility visibility not null default 'public',
      ancestor_path text[] not null default '{}'::text[]
    );

    create table "grant" (
      id text primary key,
      organization_id text not null,
      subject_kind grant_subject_kind not null,
      subject_id text not null,
      resource_kind resource_kind not null,
      resource_id text not null,
      capabilities jsonb not null,
      effect grant_effect not null default 'allow',
      cascades boolean not null default true,
      visibility_override visibility,
      expires_at timestamp,
      visibility visibility not null default 'public',
      created_by text,
      created_at timestamp not null default now()
    );
  `);
}

beforeAll(async () => {
  client = new PGlite('memory://');
  const d = drizzle(client);
  await bootstrapAuthzSchema(client);
  db = d as unknown as Database;

  const orgRows = await db.insert(organization).values({ name: 'Acme', slug: 'acme' }).returning();
  orgId = orgRows[0]!.id;

  const roles = await db
    .insert(role)
    .values([
      {
        organizationId: orgId,
        key: 'owner',
        name: 'Owner',
        isSystem: true,
        baseCapability: 'manage',
        capabilities: ['manage'],
      },
      {
        organizationId: orgId,
        key: 'member',
        name: 'Member',
        isSystem: true,
        baseCapability: 'contribute',
        capabilities: ['contribute'],
      },
      {
        organizationId: orgId,
        key: 'guest',
        name: 'Guest',
        isSystem: true,
        baseCapability: null,
        capabilities: [],
      },
    ])
    .returning();
  ownerRoleId = roles.find((r) => r.key === 'owner')!.id;
  memberRoleId = roles.find((r) => r.key === 'member')!.id;
  guestRoleId = roles.find((r) => r.key === 'guest')!.id;

  ownerActorId = (
    await db
      .insert(actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Owner', roleId: ownerRoleId })
      .returning()
  )[0]!.id;
  memberActorId = (
    await db
      .insert(actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Member', roleId: memberRoleId })
      .returning()
  )[0]!.id;
  guestActorId = (
    await db
      .insert(actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Guest', roleId: guestRoleId })
      .returning()
  )[0]!.id;
  suspendedActorId = (
    await db
      .insert(actor)
      .values({
        organizationId: orgId,
        kind: 'human',
        displayName: 'Suspended',
        roleId: memberRoleId,
        status: 'suspended',
      })
      .returning()
  )[0]!.id;

  teamId = (
    await db.insert(team).values({ organizationId: orgId, name: 'Core', key: 'CORE' }).returning()
  )[0]!.id;
  isolatedTeamId = (
    await db.insert(team).values({ organizationId: orgId, name: 'Iso', key: 'ISO' }).returning()
  )[0]!.id;
  programId = (
    await db.insert(program).values({ organizationId: orgId, name: 'Ops' }).returning()
  )[0]!.id;
  projectId = (
    await db
      .insert(project)
      .values({ organizationId: orgId, name: 'Proj', teamId, programId })
      .returning()
  )[0]!.id;
  projectUnderTeamOnlyId = (
    await db
      .insert(project)
      .values({ organizationId: orgId, name: 'TeamOnlyProj', teamId })
      .returning()
  )[0]!.id;
  projectUnderProgramOnlyId = (
    await db
      .insert(project)
      .values({ organizationId: orgId, name: 'ProgramOnlyProj', programId })
      .returning()
  )[0]!.id;
  projectExpiredId = (
    await db
      .insert(project)
      .values({ organizationId: orgId, name: 'ExpiredProj', teamId: isolatedTeamId })
      .returning()
  )[0]!.id;
  projectFutureId = (
    await db
      .insert(project)
      .values({ organizationId: orgId, name: 'FutureProj', teamId: isolatedTeamId })
      .returning()
  )[0]!.id;
  taskFullId = (
    await db
      .insert(task)
      .values({
        organizationId: orgId,
        title: 'Full task',
        teamId,
        state: 'todo',
        projectId,
        programId,
      })
      .returning()
  )[0]!.id;
  taskBareId = (
    await db
      .insert(task)
      .values({ organizationId: orgId, title: 'Bare task', teamId, state: 'todo' })
      .returning()
  )[0]!.id;

  await db.insert(grant).values([
    {
      organizationId: orgId,
      subjectKind: 'role',
      subjectId: ownerRoleId,
      resourceKind: 'organization',
      resourceId: orgId,
      capabilities: ['manage'],
      effect: 'allow',
    },
    {
      organizationId: orgId,
      subjectKind: 'role',
      subjectId: memberRoleId,
      resourceKind: 'organization',
      resourceId: orgId,
      capabilities: ['contribute'],
      effect: 'allow',
    },
  ]);
});

afterAll(async () => {
  await client?.close();
});

function orgTarget(): ResourceRef {
  return { kind: 'organization', id: orgId, orgId };
}

describe('canActor', () => {
  it('an Owner has manage org-wide', async () => {
    const r = await canActor(ownerActorId, 'manage', orgTarget(), db);
    expect(r.allow).toBe(true);
    expect(r.effectiveCapability).toBe('manage');
    expect(r.reason).toBe('allow');
  });

  it('a Member has contribute but not manage', async () => {
    expect((await canActor(memberActorId, 'contribute', orgTarget(), db)).allow).toBe(true);
    const r = await canActor(memberActorId, 'manage', orgTarget(), db);
    expect(r.allow).toBe(false);
    expect(r.effectiveCapability).toBe('contribute');
    expect(r.reason).toBe('insufficient');
  });

  it('a Guest is denied view without a grant (no_grant)', async () => {
    const r = await canActor(guestActorId, 'view', orgTarget(), db);
    expect(r.allow).toBe(false);
    expect(r.effectiveCapability).toBeNull();
    expect(r.reason).toBe('no_grant');
  });

  it('an unknown actor id is denied (actor_not_found)', async () => {
    const r = await canActor('00000000000000000000000000', 'view', orgTarget(), db);
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('actor_not_found');
    expect(r.effectiveCapability).toBeNull();
  });

  it('a cross-org actor is denied (cross_org → 404 path)', async () => {
    const otherOrg = '0000000000000000000000000Z';
    const r = await canActor(
      ownerActorId,
      'view',
      { kind: 'organization', id: otherOrg, orgId: otherOrg },
      db,
    );
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('cross_org');
    expect(r.effectiveCapability).toBeNull();
  });

  it('a suspended actor is denied (actor_suspended)', async () => {
    const r = await canActor(suspendedActorId, 'view', orgTarget(), db);
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('actor_suspended');
    expect(r.effectiveCapability).toBeNull();
  });

  it('resolves a direct actor-subject grant on the target', async () => {
    const teamTarget: ResourceRef = { kind: 'team', id: teamId, orgId };
    // No grant yet: guest sees nothing on the team.
    expect((await canActor(guestActorId, 'view', teamTarget, db)).allow).toBe(false);
    await db.insert(grant).values({
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: guestActorId,
      resourceKind: 'team',
      resourceId: teamId,
      capabilities: ['view'],
      effect: 'allow',
    });
    const r = await canActor(guestActorId, 'view', teamTarget, db);
    expect(r.allow).toBe(true);
    expect(r.effectiveCapability).toBe('view');
  });

  it('cascades a grant down the ancestor chain (team grant covers a task)', async () => {
    const r = await canActor(guestActorId, 'view', { kind: 'task', id: taskFullId, orgId }, db);
    expect(r.allow).toBe(true);
    expect(r.effectiveCapability).toBe('view');
  });

  it('resolves a grant attached to a project ancestor of a task, taking the highest rank', async () => {
    await db.insert(grant).values({
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: guestActorId,
      resourceKind: 'project',
      resourceId: projectId,
      capabilities: ['view', 'contribute'],
      effect: 'allow',
    });
    const r = await canActor(
      guestActorId,
      'contribute',
      { kind: 'task', id: taskFullId, orgId },
      db,
    );
    expect(r.allow).toBe(true);
    expect(r.effectiveCapability).toBe('contribute');
  });

  it('resolves a grant attached to a program ancestor of a task', async () => {
    await db.insert(grant).values({
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: memberActorId,
      resourceKind: 'program',
      resourceId: programId,
      capabilities: ['assign'],
      effect: 'allow',
    });
    const r = await canActor(memberActorId, 'assign', { kind: 'task', id: taskFullId, orgId }, db);
    expect(r.allow).toBe(true);
    expect(r.effectiveCapability).toBe('assign');
  });

  it('skips an expired grant', async () => {
    await db.insert(grant).values({
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: guestActorId,
      resourceKind: 'project',
      resourceId: projectExpiredId,
      capabilities: ['manage'],
      effect: 'allow',
      expiresAt: new Date(Date.now() - 60_000),
    });
    const r = await canActor(
      guestActorId,
      'view',
      { kind: 'project', id: projectExpiredId, orgId },
      db,
    );
    // The expired manage grant is ignored; guest falls back to no_grant.
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('no_grant');
  });

  it('honours a non-expired (future) grant', async () => {
    await db.insert(grant).values({
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: guestActorId,
      resourceKind: 'project',
      resourceId: projectFutureId,
      capabilities: ['view'],
      effect: 'allow',
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const r = await canActor(
      guestActorId,
      'view',
      { kind: 'project', id: projectFutureId, orgId },
      db,
    );
    expect(r.allow).toBe(true);
    expect(r.effectiveCapability).toBe('view');
  });

  it('ignores a deny-effect grant (DENY deferred)', async () => {
    // A deny on the org for a fresh actor must be a no-op: it never reduces the allow set.
    const lonerRoleId = (
      await db
        .insert(role)
        .values({ organizationId: orgId, key: 'loner', name: 'Loner', capabilities: ['view'] })
        .returning()
    )[0]!.id;
    const lonerId = (
      await db
        .insert(actor)
        .values({ organizationId: orgId, kind: 'human', displayName: 'Loner', roleId: lonerRoleId })
        .returning()
    )[0]!.id;
    await db.insert(grant).values([
      {
        organizationId: orgId,
        subjectKind: 'actor',
        subjectId: lonerId,
        resourceKind: 'organization',
        resourceId: orgId,
        capabilities: ['view'],
        effect: 'allow',
      },
      {
        organizationId: orgId,
        subjectKind: 'actor',
        subjectId: lonerId,
        resourceKind: 'organization',
        resourceId: orgId,
        capabilities: ['manage'],
        effect: 'deny',
      },
    ]);
    const r = await canActor(lonerId, 'view', orgTarget(), db);
    // The deny row is skipped; only the allow('view') counts.
    expect(r.allow).toBe(true);
    expect(r.effectiveCapability).toBe('view');
  });

  it('skips a grant whose resourceId is in the chain but whose kind differs', async () => {
    // A grant where resourceId == orgId but resourceKind != 'organization' passes the
    // id-only SQL filter yet fails the kind+id chain re-check (line 82 skip branch).
    const odd = (
      await db
        .insert(actor)
        .values({ organizationId: orgId, kind: 'human', displayName: 'Odd', roleId: memberRoleId })
        .returning()
    )[0]!.id;
    await db.insert(grant).values({
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: odd,
      resourceKind: 'team',
      resourceId: orgId,
      capabilities: ['manage'],
      effect: 'allow',
    });
    const r = await canActor(odd, 'view', orgTarget(), db);
    // The mismatched-kind grant is ignored; only the role's org contribute grant applies.
    expect(r.effectiveCapability).toBe('contribute');
    expect(r.allow).toBe(true);
  });
});

describe('ancestorChain', () => {
  it('short-circuits for an organization target', async () => {
    const chain = await ancestorChain(orgTarget(), db);
    expect(chain).toEqual([{ kind: 'organization', id: orgId, orgId }]);
  });

  it('builds team → organization for a task with no project/program', async () => {
    const chain = await ancestorChain({ kind: 'task', id: taskBareId, orgId }, db);
    expect(chain.map((r) => r.kind)).toEqual(['task', 'team', 'organization']);
  });

  it('builds task → team → project → program → organization for a fully nested task', async () => {
    const chain = await ancestorChain({ kind: 'task', id: taskFullId, orgId }, db);
    expect(chain.map((r) => r.kind)).toEqual([
      'task',
      'team',
      'project',
      'program',
      'organization',
    ]);
  });

  it('builds task → organization when the task row is missing', async () => {
    const chain = await ancestorChain(
      { kind: 'task', id: '00000000000000000000000000', orgId },
      db,
    );
    expect(chain.map((r) => r.kind)).toEqual(['task', 'organization']);
  });

  it('builds project → team → program → organization for a project with both FKs', async () => {
    const chain = await ancestorChain({ kind: 'project', id: projectId, orgId }, db);
    expect(chain.map((r) => r.kind)).toEqual(['project', 'team', 'program', 'organization']);
  });

  it('builds project → team → organization for a project with only a team', async () => {
    const chain = await ancestorChain({ kind: 'project', id: projectUnderTeamOnlyId, orgId }, db);
    expect(chain.map((r) => r.kind)).toEqual(['project', 'team', 'organization']);
  });

  it('builds project → program → organization for a project with only a program', async () => {
    const chain = await ancestorChain(
      { kind: 'project', id: projectUnderProgramOnlyId, orgId },
      db,
    );
    expect(chain.map((r) => r.kind)).toEqual(['project', 'program', 'organization']);
  });

  it('builds project → organization when the project row is missing', async () => {
    const chain = await ancestorChain(
      { kind: 'project', id: '00000000000000000000000000', orgId },
      db,
    );
    expect(chain.map((r) => r.kind)).toEqual(['project', 'organization']);
  });

  it('builds node → organization for a kind without FK traversal (team)', async () => {
    const chain = await ancestorChain({ kind: 'team', id: teamId, orgId }, db);
    expect(chain.map((r) => r.kind)).toEqual(['team', 'organization']);
  });
});

describe('visibilityGrantsView', () => {
  it('denies a guest regardless of visibility', () => {
    expect(visibilityGrantsView('public', true)).toBe(false);
    expect(visibilityGrantsView('private', true)).toBe(false);
  });

  it('grants a non-guest baseline view of a public resource', () => {
    expect(visibilityGrantsView('public', false)).toBe(true);
  });

  it('denies a non-guest baseline view of a private resource', () => {
    expect(visibilityGrantsView('private', false)).toBe(false);
  });
});

describe('effectiveVisibility', () => {
  it('returns the nearest defined override (precedence over later entries)', () => {
    expect(effectiveVisibility(['private', 'public'], 'public')).toBe('private');
  });

  it('skips null/undefined overrides to the next defined one', () => {
    expect(effectiveVisibility([null, undefined, 'public'], 'private')).toBe('public');
  });

  it('falls back to own visibility when no override is defined', () => {
    expect(effectiveVisibility([null, undefined], 'private')).toBe('private');
    expect(effectiveVisibility([], 'public')).toBe('public');
  });
});

describe('lastOwnerGuard', () => {
  it('is a no-op when the org has no owner role', async () => {
    const ownerlessOrg = (
      await db.insert(organization).values({ name: 'Ownerless', slug: 'ownerless' }).returning()
    )[0]!.id;
    await expect(
      lastOwnerGuard(db, ownerlessOrg, '00000000000000000000000000'),
    ).resolves.toBeUndefined();
  });

  it('allows downgrading when another active owner remains', async () => {
    const secondOwnerId = (
      await db
        .insert(actor)
        .values({
          organizationId: orgId,
          kind: 'human',
          displayName: 'Owner2',
          roleId: ownerRoleId,
        })
        .returning()
    )[0]!.id;
    // Removing the original owner is fine: secondOwnerId still holds the role.
    await expect(lastOwnerGuard(db, orgId, ownerActorId)).resolves.toBeUndefined();
    // And removing the second is fine too: the original remains.
    await expect(lastOwnerGuard(db, orgId, secondOwnerId)).resolves.toBeUndefined();
  });

  it('throws when removing/downgrading the sole active owner', async () => {
    const soloOrg = (
      await db.insert(organization).values({ name: 'Solo', slug: 'solo' }).returning()
    )[0]!.id;
    const soloOwnerRoleId = (
      await db
        .insert(role)
        .values({
          organizationId: soloOrg,
          key: 'owner',
          name: 'Owner',
          isSystem: true,
          capabilities: ['manage'],
        })
        .returning()
    )[0]!.id;
    const soloOwnerId = (
      await db
        .insert(actor)
        .values({
          organizationId: soloOrg,
          kind: 'human',
          displayName: 'Solo Owner',
          roleId: soloOwnerRoleId,
        })
        .returning()
    )[0]!.id;
    await expect(lastOwnerGuard(db, soloOrg, soloOwnerId)).rejects.toBeInstanceOf(LastOwnerError);
  });

  it('LastOwnerError carries a default message and name', () => {
    const err = new LastOwnerError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('LastOwnerError');
    expect(err.message).toMatch(/at least one active owner/);
  });
});

describe('noSelfEscalation', () => {
  it('allows granting at or below the writer’s own rank', () => {
    expect(() => {
      noSelfEscalation('manage', 'manage');
    }).not.toThrow();
    expect(() => {
      noSelfEscalation('manage', 'view');
    }).not.toThrow();
  });

  it('throws when granting above the writer’s own rank', () => {
    expect(() => {
      noSelfEscalation('contribute', 'manage');
    }).toThrow(SelfEscalationError);
  });

  it('SelfEscalationError carries a default message and name', () => {
    const err = new SelfEscalationError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SelfEscalationError');
    expect(err.message).toMatch(/above your own/);
  });
});
