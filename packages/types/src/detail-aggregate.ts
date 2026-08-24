/**
 * Typed, bounded detail reads for local-first entity navigation.
 *
 * @remarks
 * These contracts separate the document's first visible content from picker data. An aggregate
 * response contains one entity, the permissions that govern its visible controls, and only the
 * referenced records needed to render its default view. Organization rosters belong to editors
 * and load after a person opens the corresponding picker.
 */
import { z } from 'zod';

import {
  InitiativeNavigationSnapshot,
  ProgramNavigationSnapshot,
  ProjectNavigationSnapshot,
  TaskNavigationSnapshot,
} from './entity-navigation';
import { InitiativeDetail } from './initiative';
import { ProgramDetail, ProgramOut } from './program';
import { ProjectOut, ProjectProgress } from './project';
import { ActorId } from './primitives';
import { TaskDetail } from './task';
import { TeamOut, WorkflowState } from './team';

/** The permitted operations the initial detail view may render without loading an org roster. */
export const DetailCapabilities = z
  .object({
    comment: z.boolean(),
    contribute: z.boolean(),
    assign: z.boolean(),
    manage: z.boolean(),
  })
  .strict()
  .meta({
    id: 'DetailCapabilities',
    description: 'Permission flags for controls visible in an aggregate entity detail response.',
  });
/** Permission flags for an aggregate entity detail response. */
export type DetailCapabilities = z.infer<typeof DetailCapabilities>;

/** A single named actor referenced by a detail document without sending the member roster. */
export const DetailActorReference = z
  .object({
    actorId: ActorId,
    displayName: z.string(),
    avatar: z.string().nullable(),
  })
  .strict()
  .meta({
    id: 'DetailActorReference',
    description: 'One actor named by an aggregate detail response, without an organization roster.',
  });
/** One actor referenced by an aggregate detail response. */
export type DetailActorReference = z.infer<typeof DetailActorReference>;

/** One aggregate Task detail response. */
export const TaskDetailAggregate = z
  .object({
    target: z.literal('task'),
    snapshot: TaskNavigationSnapshot,
    capabilities: DetailCapabilities,
    references: z.object({ workflowStates: z.array(WorkflowState) }).strict(),
    defaultView: z.object({ task: TaskDetail }).strict(),
  })
  .strict()
  .meta({ id: 'TaskDetailAggregate', description: 'Bounded initial Task detail response.' });
/** Aggregate Task detail response. */
export type TaskDetailAggregate = z.infer<typeof TaskDetailAggregate>;

/** One aggregate Project detail response. */
export const ProjectDetailAggregate = z
  .object({
    target: z.literal('project'),
    snapshot: ProjectNavigationSnapshot,
    capabilities: DetailCapabilities,
    references: z
      .object({
        lead: DetailActorReference.nullable(),
        program: ProgramOut.nullable(),
        team: TeamOut.nullable(),
      })
      .strict(),
    defaultView: z.object({ project: ProjectOut, progress: ProjectProgress }).strict(),
  })
  .strict()
  .meta({ id: 'ProjectDetailAggregate', description: 'Bounded initial Project detail response.' });
/** Aggregate Project detail response. */
export type ProjectDetailAggregate = z.infer<typeof ProjectDetailAggregate>;

/** One aggregate Program detail response. */
export const ProgramDetailAggregate = z
  .object({
    target: z.literal('program'),
    snapshot: ProgramNavigationSnapshot,
    capabilities: DetailCapabilities,
    references: z.object({ owner: DetailActorReference.nullable() }).strict(),
    defaultView: z.object({ program: ProgramDetail }).strict(),
  })
  .strict()
  .meta({ id: 'ProgramDetailAggregate', description: 'Bounded initial Program detail response.' });
/** Aggregate Program detail response. */
export type ProgramDetailAggregate = z.infer<typeof ProgramDetailAggregate>;

/** One aggregate Initiative detail response. */
export const InitiativeDetailAggregate = z
  .object({
    target: z.literal('initiative'),
    snapshot: InitiativeNavigationSnapshot,
    capabilities: DetailCapabilities,
    references: z.object({ owner: DetailActorReference.nullable() }).strict(),
    defaultView: z.object({ initiative: InitiativeDetail }).strict(),
  })
  .strict()
  .meta({
    id: 'InitiativeDetailAggregate',
    description: 'Bounded initial Initiative detail response.',
  });
/** Aggregate Initiative detail response. */
export type InitiativeDetailAggregate = z.infer<typeof InitiativeDetailAggregate>;

/** Target-discriminated aggregate detail response for local-first entity routes. */
export const EntityDetailAggregate = z.discriminatedUnion('target', [
  TaskDetailAggregate,
  ProjectDetailAggregate,
  ProgramDetailAggregate,
  InitiativeDetailAggregate,
]);
/** Aggregate detail response for any locally navigable entity. */
export type EntityDetailAggregate = z.infer<typeof EntityDetailAggregate>;
