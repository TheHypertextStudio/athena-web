/**
 * Initiative route serializers.
 *
 * @packageDocumentation
 */

import type { InitiativeRef, InitiativeWithRelations } from '@athena/types/openapi/initiatives';
import type { UserRef } from '@athena/types/openapi/tasks';
import type { initiatives, projects, users } from '../../db/schema/index.js';
import { toInitiativeStatus } from './helpers.js';

type InitiativeRowBase = typeof initiatives.$inferSelect;
type InitiativeRow = Omit<InitiativeRowBase, 'statusCategory'> & {
  statusCategory?: InitiativeRowBase['statusCategory'] | null;
};
type ProjectRow = typeof projects.$inferSelect;
type UserRow = typeof users.$inferSelect;
type InitiativeProject = NonNullable<InitiativeWithRelations['projects']>[number];
type UserRefRow = Pick<UserRow, 'id' | 'name'>;

type InitiativeWithRelationsRow = InitiativeRow & {
  parent?: InitiativeRow | null;
  children?: InitiativeRow[];
  projects?: InitiativeProjectRow[];
  owner?: UserRefRow | null;
};

type InitiativeProjectRow = Pick<ProjectRow, 'id'> & {
  name?: ProjectRow['name'] | null;
  tasks?: unknown[] | null;
};

const toUserRef = (user: UserRefRow): UserRef => ({
  id: user.id,
  name: user.name,
});

const toInitiativeProject = (project: InitiativeProjectRow): InitiativeProject => {
  const response: InitiativeProject = { id: project.id };

  if (project.name !== undefined && project.name !== null) {
    response.name = project.name;
  }

  if (project.tasks !== undefined && project.tasks !== null) {
    response.tasks = project.tasks;
  }

  return response;
};

const resolveStatus = (initiative: InitiativeRow): InitiativeWithRelations['status'] => {
  return initiative.statusCategory
    ? toInitiativeStatus(initiative.statusCategory)
    : initiative.status;
};

export const toInitiativeRef = (initiative: InitiativeRow): InitiativeRef => ({
  id: initiative.id,
  name: initiative.name,
  status: resolveStatus(initiative),
});

export const toInitiativeWithRelations = (
  initiative: InitiativeWithRelationsRow,
): InitiativeWithRelations => {
  const response: InitiativeWithRelations = {
    id: initiative.id,
    name: initiative.name,
    description: initiative.description ?? null,
    status: resolveStatus(initiative),
    parentId: initiative.parentId ?? null,
    ownerId: initiative.ownerId,
    deletedAt: initiative.deletedAt ?? null,
    createdAt: initiative.createdAt,
    updatedAt: initiative.updatedAt,
  };

  if ('parent' in initiative) {
    response.parent = initiative.parent ? toInitiativeRef(initiative.parent) : null;
  }

  if ('children' in initiative && initiative.children) {
    response.children = initiative.children.map(toInitiativeRef);
  }

  if ('projects' in initiative && initiative.projects) {
    response.projects = initiative.projects.map(toInitiativeProject);
    response.projectCount = initiative.projects.length;
  }

  if ('owner' in initiative && initiative.owner) {
    response.owner = toUserRef(initiative.owner);
  }

  return response;
};
