/**
 * `@docket/api` — the people (human Actor) slice: DTOs and the profile loader.
 *
 * @remarks
 * Docket tracks two kinds of person in a workspace and treats them identically: a **member**
 * whose Actor carries a `user_id` (they sign in), and an **account-less person** whose Actor
 * carries `user_id = null` (a volunteer, a contractor, a colleague who never logs in). Both are
 * `actor.kind = 'human'` rows in the same table, both appear in the same roster, and both are
 * assignable to work through the same foreign keys — `task.assignee_id`, `project.lead_id`,
 * `initiative.owner_id` all target `actor.id` with no account requirement anywhere.
 *
 * This module holds the shapes and the read that the {@link file://./members.ts} router serves.
 * It lives apart from the router because the profile read joins across the work layer (tasks,
 * projects, initiatives) and would otherwise bury the membership endpoints it sits beside.
 *
 * @see {@link file://../../../../docs/engineering/specs/people.md} for the enumeration of every
 * place a person WITH an account is deliberately treated differently from one without.
 */
import { actor, db, initiative, project, role, task } from '@docket/db';
import { ActorId, OrganizationId, RoleId } from '@docket/identity-access/ids';
import { Health } from '@docket/work/capability-contract';
import { InitiativeId, ProjectId, TaskId } from '@docket/work/ids';
import { InitiativeStatus } from '@docket/work/initiative-contract';
import { ProjectStatus } from '../contracts/project';
import { Priority } from '@docket/work/task-contract';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError } from '../error';

import { buildTaskViewFilter } from './task-helpers';

/** The maximum length of a person's workspace display name. */
export const PERSON_DISPLAY_NAME_MAX = 120;

/**
 * Body for adding a person to a workspace who does not hold a Docket account.
 *
 * @remarks
 * Deliberately has no `email` and no account link: this is how a nonprofit records a volunteer,
 * or an agency a contractor, so they can be assigned work like anyone else. A person who SHOULD
 * sign in is added through `POST /invitations` instead — that path mints the account link when
 * the invitation is redeemed. The two paths converge on the same `actor` row shape, so nothing
 * downstream can tell them apart.
 */
export const PersonCreate = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(PERSON_DISPLAY_NAME_MAX)
      .describe(
        "The person's name as the workspace should show it. This is the only required field — a person needs a name, not an account.",
      ),
    avatar: z
      .string()
      .nullable()
      .optional()
      .describe("URL of the person's avatar image; omit or null for the initials fallback."),
    roleId: RoleId.nullable()
      .optional()
      .describe(
        "The org role this person holds. MUST belong to this org (a foreign or unknown role yields 404). Omitted → the org's `member` role when it exists, otherwise no role. A role on an account-less person confers nothing at sign-in (they never sign in); it is what makes them appear and sort identically to everyone else, and it is honored the moment an account is linked.",
      ),
  })
  .meta({
    id: 'PersonCreate',
    description: 'Add a person to a workspace without a Docket account.',
  });
/** Validated person-create body. */
export type PersonCreate = z.infer<typeof PersonCreate>;

/** Body for editing a person's workspace-owned identity (name + avatar). */
export const PersonUpdate = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(PERSON_DISPLAY_NAME_MAX)
      .optional()
      .describe('Rename the person as this workspace shows them. Omit to leave unchanged.'),
    avatar: z
      .string()
      .nullable()
      .optional()
      .describe("Re-point or clear (null) the person's avatar image. Omit to leave unchanged."),
    title: z
      .string()
      .trim()
      .max(120)
      .nullable()
      .optional()
      .describe(
        "The person's job title in this organization (e.g. 'Event Coordinator'), or null to clear it. Omit to leave unchanged. Workspace-owned like the display name: for someone who never signs in, this is the only record of their standing in the organization, so it is editable on the same terms as anyone else's.",
      ),
  })
  .meta({
    id: 'PersonUpdate',
    description: "Update a person's workspace display name, avatar, or job title.",
  });
/** Validated person-update body. */
export type PersonUpdate = z.infer<typeof PersonUpdate>;

/** One task assigned to the person, as their profile lists it. */
const ProfileTask = z
  .object({
    id: TaskId.describe('The assigned task id.'),
    title: z.string().describe("The task's title."),
    state: z.string().describe("The task's workflow-state key."),
    priority: Priority.describe("The task's priority."),
    dueDate: z.string().nullable().describe('ISO-8601 due date, or null when undated.'),
    projectId: ProjectId.nullable().describe('The owning project id, or null.'),
  })
  .meta({ id: 'PersonProfileTask', description: 'A task assigned to a person.' });

/** One project the person leads, as their profile lists it. */
const ProfileProject = z
  .object({
    id: ProjectId.describe('The led project id.'),
    name: z.string().describe("The project's name."),
    status: ProjectStatus.describe("The project's lifecycle status."),
    health: Health.nullable().describe("The project's health verdict, or null when unreported."),
  })
  .meta({ id: 'PersonProfileProject', description: 'A project a person leads.' });

/** One initiative the person owns, as their profile lists it. */
const ProfileInitiative = z
  .object({
    id: InitiativeId.describe('The owned initiative id.'),
    name: z.string().describe("The initiative's name."),
    status: InitiativeStatus.describe("The initiative's lifecycle status."),
  })
  .meta({ id: 'PersonProfileInitiative', description: 'An initiative a person owns.' });

/**
 * A person's workspace profile: who they are, what they hold, and what they are on the hook for.
 *
 * @remarks
 * Identical in shape for every human Actor. Nothing here reports whether the person holds a
 * Docket account — the profile has no field a client could branch on to render them as a lesser
 * participant, which is the point (`docs/engineering/specs/people.md`).
 */
export const PersonProfileOut = z
  .object({
    actorId: ActorId.describe("The person's org-scoped Actor id."),
    organizationId: OrganizationId.describe('The workspace this profile belongs to.'),
    displayName: z.string().describe("The person's name as this workspace shows it."),
    avatar: z.string().nullable().describe("URL of the person's avatar image, or null."),
    title: z
      .string()
      .nullable()
      .describe("The person's job title in this organization, or null when unset."),
    status: z
      .enum(['active', 'suspended'])
      .describe("Participation status: 'active' or 'suspended'."),
    roleId: RoleId.nullable().describe('The id of the org role the person holds, or null.'),
    roleName: z
      .string()
      .nullable()
      .describe('The display name of the org role the person holds, or null when they hold none.'),
    createdAt: z.string().describe('ISO-8601 timestamp of when the person joined the workspace.'),
    assignedTasks: z
      .array(ProfileTask)
      .describe('Active (non-archived) tasks assigned to this person, soonest-due first.'),
    ledProjects: z.array(ProfileProject).describe('Projects this person leads, by name.'),
    ownedInitiatives: z.array(ProfileInitiative).describe('Initiatives this person owns, by name.'),
  })
  .meta({ id: 'PersonProfileOut', description: "A person's workspace profile." });
/** Person-profile representation value. */
export type PersonProfileOut = z.infer<typeof PersonProfileOut>;

/**
 * Load one person's full workspace profile.
 *
 * @remarks
 * Runs four org-scoped reads: the Actor (with its role name resolved by a left join), then the
 * work each of the three assignment foreign keys points at. Every read is scoped by
 * `organization_id`, so a cross-tenant actor id is indistinguishable from a missing one.
 *
 * The actor lookup is filtered to `kind = 'human'` for the same reason the roster is: agents and
 * team actors are not people and have no profile.
 *
 * @param orgId - The active organization id (from the verified actor context).
 * @param actorId - The person's Actor id.
 * @param viewerActorId - The current actor, whose task visibility gates assigned-work metadata.
 * @returns the assembled {@link PersonProfileOut} payload.
 * @throws {NotFoundError} when no human Actor with that id exists in this org.
 */
export async function loadPersonProfile(
  orgId: string,
  actorId: string,
  viewerActorId: string,
): Promise<z.input<typeof PersonProfileOut>> {
  const rows = await db
    .select({
      id: actor.id,
      organizationId: actor.organizationId,
      displayName: actor.displayName,
      avatar: actor.avatar,
      title: actor.title,
      status: actor.status,
      roleId: actor.roleId,
      roleName: role.name,
      createdAt: actor.createdAt,
    })
    .from(actor)
    .leftJoin(role, eq(actor.roleId, role.id))
    .where(and(eq(actor.id, actorId), eq(actor.organizationId, orgId), eq(actor.kind, 'human')))
    .limit(1);
  const person = rows[0];
  if (!person) throw new NotFoundError('Person not found');
  const taskVisibility = await buildTaskViewFilter(orgId, viewerActorId);

  const [tasks, projects, initiatives] = await Promise.all([
    db
      .select({
        id: task.id,
        teamId: task.teamId,
        title: task.title,
        state: task.state,
        priority: task.priority,
        dueDate: task.dueDate,
        projectId: task.projectId,
        programId: task.programId,
        visibility: task.visibility,
      })
      .from(task)
      .where(
        and(eq(task.organizationId, orgId), eq(task.assigneeId, actorId), isNull(task.archivedAt)),
      )
      .orderBy(asc(task.dueDate), asc(task.title)),
    db
      .select({
        id: project.id,
        name: project.name,
        status: project.status,
        health: project.health,
      })
      .from(project)
      .where(
        and(
          eq(project.organizationId, orgId),
          eq(project.leadId, actorId),
          isNull(project.archivedAt),
        ),
      )
      .orderBy(asc(project.name)),
    db
      .select({ id: initiative.id, name: initiative.name, status: initiative.status })
      .from(initiative)
      .where(
        and(
          eq(initiative.organizationId, orgId),
          eq(initiative.ownerId, actorId),
          isNull(initiative.archivedAt),
        ),
      )
      .orderBy(asc(initiative.name)),
  ]);

  return {
    actorId: person.id,
    organizationId: person.organizationId,
    displayName: person.displayName,
    avatar: person.avatar,
    title: person.title,
    status: person.status,
    roleId: person.roleId,
    roleName: person.roleName ?? null,
    createdAt: person.createdAt.toISOString(),
    assignedTasks: tasks.filter(taskVisibility).map((t) => ({
      id: t.id,
      title: t.title,
      state: t.state,
      priority: t.priority,
      dueDate: t.dueDate?.toISOString() ?? null,
      projectId: t.projectId,
    })),
    ledProjects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      health: p.health,
    })),
    ownedInitiatives: initiatives.map((i) => ({ id: i.id, name: i.name, status: i.status })),
  };
}
