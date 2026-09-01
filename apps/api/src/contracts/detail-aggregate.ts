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
import { InitiativeDetail } from '@docket/work/initiative-contract';
import { ProgramDetail, ProgramOut } from '@docket/work/program-contract';
import { ProjectOut, ProjectProgress } from './project';
import { ActorId, OrganizationId } from '@docket/identity-access/ids';
import { InitiativeId } from '@docket/work/ids';
import { TaskDetail } from '@docket/work/task-model';
import { TeamOut } from './team';
import { WorkflowState } from '@docket/work/workflow';

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

/** The authenticated actor whose template and editor visibility the detail route resolves. */
export const DetailViewer = z.object({ actorId: ActorId }).strict().meta({
  id: 'DetailViewer',
  description: 'Authenticated actor identity for a bounded aggregate detail response.',
});
/** Authenticated actor identity for an aggregate entity detail response. */
export type DetailViewer = z.infer<typeof DetailViewer>;

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

/** One Initiative linked to a Project without loading its entire detail document. */
export const ProjectInitiativeReference = z
  .object({ id: InitiativeId, name: z.string() })
  .strict()
  .meta({
    id: 'ProjectInitiativeReference',
    description: 'A linked Initiative named by a Project detail aggregate.',
  });
/** A linked Initiative named by a Project detail aggregate. */
export type ProjectInitiativeReference = z.infer<typeof ProjectInitiativeReference>;

/** The one hierarchy parent the Initiative detail masthead may name on first paint. */
export const InitiativeDirectParentReference = z
  .object({ id: InitiativeId, organizationId: OrganizationId, name: z.string() })
  .strict()
  .meta({
    id: 'InitiativeDirectParentReference',
    description: 'The visible direct parent named by an Initiative detail aggregate.',
  });
/** The visible direct parent named by an Initiative detail aggregate. */
export type InitiativeDirectParentReference = z.infer<typeof InitiativeDirectParentReference>;

/** One aggregate Task detail response. */
export const TaskDetailAggregate = z
  .object({
    target: z.literal('task'),
    snapshot: TaskNavigationSnapshot,
    viewer: DetailViewer,
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
    viewer: DetailViewer,
    capabilities: DetailCapabilities,
    references: z
      .object({
        lead: DetailActorReference.nullable(),
        program: ProgramOut.nullable(),
        team: TeamOut.nullable(),
        initiatives: z.array(ProjectInitiativeReference),
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
    viewer: DetailViewer,
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
    viewer: DetailViewer,
    capabilities: DetailCapabilities,
    references: z
      .object({
        owner: DetailActorReference.nullable(),
        parent: InitiativeDirectParentReference.nullable(),
        parentLinkId: z.string().nullable(),
      })
      .strict(),
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
