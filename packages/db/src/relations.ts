/**
 * `@docket/db` — Drizzle `relations()` for the core entities.
 *
 * @remarks
 * Enables the relational query API (`db.query.x.findMany({ with })`) for the slice's
 * hot paths. The Phase-6 `DA-relations-01` ticket extends this to every entity; this
 * foundation set covers organization/actor/team/membership/project/task.
 */
import { relations } from 'drizzle-orm';

import { user } from './schema/auth';
import {
  calendarItem,
  calendarItemRelation,
  calendarItemTaskLink,
  calendarLayer,
  calendarLayerShare,
} from './schema/calendar';
import { role } from './schema/crosscutting';
import { actor, organization, team, teamMember } from './schema/identity';
import { project, task } from './schema/work';

/** Organization → its actors, teams, projects, tasks. */
export const organizationRelations = relations(organization, ({ many }) => ({
  actors: many(actor),
  teams: many(team),
  projects: many(project),
  tasks: many(task),
}));

/** Actor → its organization, optional global user, optional role, team memberships. */
export const actorRelations = relations(actor, ({ one, many }) => ({
  organization: one(organization, {
    fields: [actor.organizationId],
    references: [organization.id],
  }),
  user: one(user, { fields: [actor.userId], references: [user.id] }),
  role: one(role, { fields: [actor.roleId], references: [role.id] }),
  teamMemberships: many(teamMember),
}));

/** Team → its organization, members, tasks. */
export const teamRelations = relations(team, ({ one, many }) => ({
  organization: one(organization, {
    fields: [team.organizationId],
    references: [organization.id],
  }),
  members: many(teamMember),
  tasks: many(task),
}));

/** TeamMember → its team and actor (the membership join). */
export const teamMemberRelations = relations(teamMember, ({ one }) => ({
  team: one(team, { fields: [teamMember.teamId], references: [team.id] }),
  actor: one(actor, { fields: [teamMember.actorId], references: [actor.id] }),
}));

/** Project → its organization, lead actor, team, tasks. */
export const projectRelations = relations(project, ({ one, many }) => ({
  organization: one(organization, {
    fields: [project.organizationId],
    references: [organization.id],
  }),
  lead: one(actor, { fields: [project.leadId], references: [actor.id] }),
  team: one(team, { fields: [project.teamId], references: [team.id] }),
  tasks: many(task),
}));

/** Task → its organization, team, project, assignee. */
export const taskRelations = relations(task, ({ one }) => ({
  organization: one(organization, {
    fields: [task.organizationId],
    references: [organization.id],
  }),
  team: one(team, { fields: [task.teamId], references: [team.id] }),
  project: one(project, { fields: [task.projectId], references: [project.id] }),
  assignee: one(actor, { fields: [task.assigneeId], references: [actor.id] }),
}));

/** Calendar layer → its owner, items, and workspace shares. */
export const calendarLayerRelations = relations(calendarLayer, ({ one, many }) => ({
  owner: one(user, { fields: [calendarLayer.userId], references: [user.id] }),
  items: many(calendarItem),
  shares: many(calendarLayerShare),
}));

/** Calendar item → its layer, task links, and directed item relationships. */
export const calendarItemRelations = relations(calendarItem, ({ one, many }) => ({
  layer: one(calendarLayer, { fields: [calendarItem.layerId], references: [calendarLayer.id] }),
  taskLinks: many(calendarItemTaskLink),
  outgoingRelations: many(calendarItemRelation, { relationName: 'calendarRelationSource' }),
  incomingRelations: many(calendarItemRelation, { relationName: 'calendarRelationTarget' }),
}));

/** Calendar item/task link → its calendar item, task, organization, and creator. */
export const calendarItemTaskLinkRelations = relations(calendarItemTaskLink, ({ one }) => ({
  calendarItem: one(calendarItem, {
    fields: [calendarItemTaskLink.calendarItemId],
    references: [calendarItem.id],
  }),
  task: one(task, { fields: [calendarItemTaskLink.taskId], references: [task.id] }),
  organization: one(organization, {
    fields: [calendarItemTaskLink.organizationId],
    references: [organization.id],
  }),
  creator: one(actor, { fields: [calendarItemTaskLink.createdBy], references: [actor.id] }),
}));

/** Directed calendar relation → its source item, target item, and owning user. */
export const calendarItemRelationRelations = relations(calendarItemRelation, ({ one }) => ({
  sourceItem: one(calendarItem, {
    fields: [calendarItemRelation.sourceItemId],
    references: [calendarItem.id],
    relationName: 'calendarRelationSource',
  }),
  targetItem: one(calendarItem, {
    fields: [calendarItemRelation.targetItemId],
    references: [calendarItem.id],
    relationName: 'calendarRelationTarget',
  }),
  creator: one(user, {
    fields: [calendarItemRelation.createdByUserId],
    references: [user.id],
  }),
}));

/** Workspace layer share → its layer, receiving organization, and creator. */
export const calendarLayerShareRelations = relations(calendarLayerShare, ({ one }) => ({
  layer: one(calendarLayer, {
    fields: [calendarLayerShare.layerId],
    references: [calendarLayer.id],
  }),
  organization: one(organization, {
    fields: [calendarLayerShare.organizationId],
    references: [organization.id],
  }),
  creator: one(actor, { fields: [calendarLayerShare.createdBy], references: [actor.id] }),
}));
