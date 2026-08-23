/**
 * Small, validated entity identities carried across local-first navigation.
 *
 * @remarks
 * A navigation snapshot is deliberately a projection of the corresponding work-view row rather
 * than a second hand-written entity shape. The list response and the first detail paint therefore
 * cannot disagree about the id, title, status, or recency fields that identify the destination.
 */
import { z } from 'zod';

import { Health } from './capability';
import { InitiativePriority } from './initiative';
import { InitiativeId, OrganizationId, TimestampString } from './primitives';
export {
  CycleSubjectRef,
  InitiativeSubjectRef,
  ProgramSubjectRef,
  ProjectSubjectRef,
  SubjectRef,
  TaskSubjectRef,
} from './subject-ref';
import {
  InitiativeStatusKey,
  ProgramViewRow,
  ProjectViewRow,
  TaskViewRow,
  type InitiativeViewRow,
} from './work-view';

/** Identity and core state needed to open a Task without waiting for the network. */
export const TaskNavigationSnapshot = TaskViewRow.pick({
  target: true,
  organizationId: true,
  id: true,
  title: true,
  status: true,
  priority: true,
  updatedAt: true,
}).strict();
/** A validated Task navigation snapshot. */
export type TaskNavigationSnapshot = z.infer<typeof TaskNavigationSnapshot>;

/** Identity and core state needed to open a Project without waiting for the network. */
export const ProjectNavigationSnapshot = ProjectViewRow.pick({
  target: true,
  organizationId: true,
  id: true,
  name: true,
  status: true,
  priority: true,
  health: true,
  updatedAt: true,
}).strict();
/** A validated Project navigation snapshot. */
export type ProjectNavigationSnapshot = z.infer<typeof ProjectNavigationSnapshot>;

/** Identity and core state needed to open a Program without waiting for the network. */
export const ProgramNavigationSnapshot = ProgramViewRow.pick({
  target: true,
  organizationId: true,
  id: true,
  name: true,
  status: true,
  health: true,
  updatedAt: true,
}).strict();
/** A validated Program navigation snapshot. */
export type ProgramNavigationSnapshot = z.infer<typeof ProgramNavigationSnapshot>;

/** Identity and core state needed to open an Initiative without waiting for the network. */
export const InitiativeNavigationSnapshot = z
  .object({
    target: z.literal('initiative'),
    organizationId: OrganizationId,
    id: InitiativeId,
    name: z.string(),
    status: InitiativeStatusKey,
    priority: InitiativePriority,
    health: Health.nullable(),
    updatedAt: TimestampString,
  })
  .strict();
/** A validated Initiative navigation snapshot. */
export type InitiativeNavigationSnapshot = z.infer<typeof InitiativeNavigationSnapshot>;

/** Target-discriminated identity used by the route, memory, and persistence layers. */
export const EntityNavigationSnapshot = z.discriminatedUnion('target', [
  TaskNavigationSnapshot,
  ProjectNavigationSnapshot,
  ProgramNavigationSnapshot,
  InitiativeNavigationSnapshot,
]);
/** A validated entity navigation snapshot. */
export type EntityNavigationSnapshot = z.infer<typeof EntityNavigationSnapshot>;

/** A work-view row that can seed entity detail navigation. */
export type NavigableWorkViewRow =
  | z.infer<typeof TaskViewRow>
  | z.infer<typeof ProjectViewRow>
  | z.infer<typeof ProgramViewRow>
  | z.infer<typeof InitiativeViewRow>;

/**
 * Project the small navigation contract from one richer work-view row.
 *
 * @param row - A validated Task, Project, Program, or Initiative work-view row.
 * @returns The exact target-correlated snapshot retained across navigation.
 */
export function entityNavigationSnapshotFromWorkViewRow(
  row: NavigableWorkViewRow,
): EntityNavigationSnapshot {
  switch (row.target) {
    case 'task':
      return TaskNavigationSnapshot.parse({
        target: row.target,
        organizationId: row.organizationId,
        id: row.id,
        title: row.title,
        status: row.status,
        priority: row.priority,
        updatedAt: row.updatedAt,
      });
    case 'project':
      return ProjectNavigationSnapshot.parse({
        target: row.target,
        organizationId: row.organizationId,
        id: row.id,
        name: row.name,
        status: row.status,
        priority: row.priority,
        health: row.health,
        updatedAt: row.updatedAt,
      });
    case 'program':
      return ProgramNavigationSnapshot.parse({
        target: row.target,
        organizationId: row.organizationId,
        id: row.id,
        name: row.name,
        status: row.status,
        health: row.health,
        updatedAt: row.updatedAt,
      });
    case 'initiative':
      return InitiativeNavigationSnapshot.parse({
        target: row.target,
        organizationId: row.organizationId,
        id: row.id,
        name: row.name,
        status: row.status,
        priority: row.priority,
        health: row.health,
        updatedAt: row.updatedAt,
      });
  }
}
