/**
 * `@docket/api` — task visibility in people and team projections.
 *
 * @remarks
 * A person's profile and a team's load report are delivery surfaces, not an organization-wide
 * task entitlement. These migrated-database regressions prove that their task-derived metadata
 * follows the same active-human visibility predicate as the primary task delivery routes.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, one, seedBaseOrg } from '../support/routes-harness';
import type membersRouter from '../../src/routes/members';
import type teamsRouter from '../../src/routes/teams';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let members!: typeof membersRouter;
let teams!: typeof teamsRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  members = (await import('../../src/routes/members')).default;
  teams = (await import('../../src/routes/teams')).default;
});

interface ProjectionFixture {
  readonly orgId: string;
  readonly teamId: string;
  readonly viewerActorId: string;
  readonly assigneeActorId: string;
  readonly privateTaskId: string;
  readonly publicTaskId: string;
}

/** Seed one viewer, one team member, and paired task rows with distinguishable report weight. */
async function seedProjectionFixture(): Promise<ProjectionFixture> {
  const { orgId, teamId, humanActorId: viewerActorId } = await seedBaseOrg(db, schema);
  const createdAt = new Date(Date.now() - 86_400_000);
  const assigneeActorId = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Private-work owner' })
      .returning({ id: schema.actor.id }),
  ).id;
  await db.insert(schema.teamMember).values({
    organizationId: orgId,
    teamId,
    actorId: assigneeActorId,
    role: 'member',
  });

  const privateTaskId = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        assigneeId: assigneeActorId,
        title: 'Private staffing plan',
        state: 'todo',
        estimate: 8,
        visibility: 'private',
        createdAt,
      })
      .returning({ id: schema.task.id }),
  ).id;
  const publicTaskId = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        assigneeId: assigneeActorId,
        title: 'Public volunteer shift',
        state: 'todo',
        estimate: 3,
        visibility: 'public',
        createdAt,
      })
      .returning({ id: schema.task.id }),
  ).id;

  return { orgId, teamId, viewerActorId, assigneeActorId, privateTaskId, publicTaskId };
}

/** Grant exact private-task access; contribute satisfies the canonical view predicate. */
async function grantTaskContribute(fixture: ProjectionFixture): Promise<void> {
  await db.insert(schema.grant).values({
    organizationId: fixture.orgId,
    subjectKind: 'actor',
    subjectId: fixture.viewerActorId,
    resourceKind: 'task',
    resourceId: fixture.privateTaskId,
    capabilities: ['contribute'],
    effect: 'allow',
    cascades: false,
  });
}

interface PersonProfile {
  readonly displayName: string;
  readonly assignedTasks: readonly { readonly id: string; readonly title: string }[];
}

interface TeamMembers {
  readonly items: readonly { readonly actorId: string; readonly openTaskCount: number }[];
}

interface TeamActivity {
  readonly capacity: readonly {
    readonly type: string;
    readonly taskCount: number;
    readonly estimate: number;
  }[];
  readonly throughput: readonly { readonly pending: number; readonly completed: number }[];
}

/** Read the task-derived portions of all three public delivery projections. */
async function readProjections(fixture: ProjectionFixture): Promise<{
  readonly profile: PersonProfile;
  readonly members: TeamMembers;
  readonly activity: TeamActivity;
}> {
  const membersApp = appWithActor(members, fixture.orgId, [], fixture.viewerActorId);
  const teamsApp = appWithActor(teams, fixture.orgId, [], fixture.viewerActorId);
  const [profileResponse, membersResponse, activityResponse] = await Promise.all([
    membersApp.request(`/${fixture.assigneeActorId}/profile`),
    teamsApp.request(`/${fixture.teamId}/members`),
    teamsApp.request(`/${fixture.teamId}/activity`),
  ]);
  expect(profileResponse.status).toBe(200);
  expect(membersResponse.status).toBe(200);
  expect(activityResponse.status).toBe(200);
  return {
    profile: (await profileResponse.json()) as PersonProfile,
    members: (await membersResponse.json()) as TeamMembers,
    activity: (await activityResponse.json()) as TeamActivity,
  };
}

function openCapacity(activity: TeamActivity): {
  readonly taskCount: number;
  readonly estimate: number;
} {
  const capacity = activity.capacity.find((bucket) => bucket.type === 'unstarted');
  if (!capacity) throw new Error('expected unstarted capacity bucket');
  return { taskCount: capacity.taskCount, estimate: capacity.estimate };
}

function latestThroughput(activity: TeamActivity): {
  readonly pending: number;
  readonly completed: number;
} {
  const point = activity.throughput.at(-1);
  if (!point) throw new Error('expected current throughput point');
  return point;
}

describe('person and team task delivery', () => {
  it('hides ungranted private task metadata while retaining public work, then restores it with a direct grant', async () => {
    const fixture = await seedProjectionFixture();

    const ungranted = await readProjections(fixture);
    expect(ungranted.profile.displayName).toBe('Private-work owner');
    expect(ungranted.profile.assignedTasks.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: fixture.publicTaskId, title: 'Public volunteer shift' },
    ]);
    expect(
      ungranted.members.items.find((member) => member.actorId === fixture.assigneeActorId)
        ?.openTaskCount,
    ).toBe(1);
    expect(openCapacity(ungranted.activity)).toEqual({ taskCount: 1, estimate: 3 });
    expect(latestThroughput(ungranted.activity)).toMatchObject({ pending: 1, completed: 0 });

    await grantTaskContribute(fixture);

    const granted = await readProjections(fixture);
    expect(granted.profile.assignedTasks.map((task) => task.id)).toEqual(
      expect.arrayContaining([fixture.privateTaskId, fixture.publicTaskId]),
    );
    expect(granted.profile.assignedTasks).toContainEqual(
      expect.objectContaining({ id: fixture.privateTaskId, title: 'Private staffing plan' }),
    );
    expect(
      granted.members.items.find((member) => member.actorId === fixture.assigneeActorId)
        ?.openTaskCount,
    ).toBe(2);
    expect(openCapacity(granted.activity)).toEqual({ taskCount: 2, estimate: 11 });
    expect(latestThroughput(granted.activity)).toMatchObject({ pending: 2, completed: 0 });
  });
});
