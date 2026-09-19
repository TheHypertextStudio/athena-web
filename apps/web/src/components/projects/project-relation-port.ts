import type {
  RelationCommandPort,
  RelationEndpoint,
  RelationIntent,
} from '@docket/work/relation-contract';

/** Project relations owned by the Project application domain. */
export type ProjectRelationId =
  | 'project.program'
  | 'project.team'
  | 'project.initiative'
  | 'project.lead'
  | 'project.label'
  | 'project.blocks';

/** Narrow Project intent accepted by the Project command port. */
export interface ProjectRelationIntent extends Omit<RelationIntent, 'relationId' | 'subjects'> {
  readonly relationId: ProjectRelationId;
  readonly subjects: readonly (RelationEndpoint & { readonly kind: 'project' })[];
}

/** Injected Project-owned persistence operations. */
export interface ProjectRelationDependencies {
  readonly patchProject: (
    organizationId: string,
    projectId: string,
    patch: { readonly programId?: string; readonly teamId?: string; readonly leadId?: string },
  ) => Promise<void>;
  readonly linkInitiative: (
    organizationId: string,
    projectId: string,
    initiativeId: string,
  ) => Promise<'applied' | 'unchanged'>;
  readonly addLabel: (
    organizationId: string,
    projectId: string,
    labelId: string,
  ) => Promise<'applied' | 'unchanged'>;
  readonly addDependency: (
    organizationId: string,
    blockingProjectId: string,
    blockedProjectId: string,
  ) => Promise<'applied' | 'unchanged'>;
}

async function handleProgramOrTeamRelation(
  intent: ProjectRelationIntent,
  subject: RelationEndpoint & { readonly kind: 'project' },
  organizationId: string,
  dependencies: ProjectRelationDependencies,
): Promise<boolean> {
  const field = intent.relationId === 'project.program' ? 'programId' : 'teamId';
  if (subject.meta?.[field] === intent.target.id) return false;
  await dependencies.patchProject(organizationId, subject.id, {
    [field]: intent.target.id,
  });
  return true;
}

async function handleLeadRelation(
  intent: ProjectRelationIntent,
  subject: RelationEndpoint & { readonly kind: 'project' },
  organizationId: string,
  dependencies: ProjectRelationDependencies,
): Promise<boolean> {
  if (subject.meta?.leadId === intent.target.id) return false;
  await dependencies.patchProject(organizationId, subject.id, {
    leadId: intent.target.id,
  });
  return true;
}

async function handleInitiativeRelation(
  organizationId: string,
  projectId: string,
  targetId: string,
  dependencies: ProjectRelationDependencies,
): Promise<boolean> {
  return (await dependencies.linkInitiative(organizationId, projectId, targetId)) === 'applied';
}

async function handleLabelRelation(
  organizationId: string,
  projectId: string,
  targetId: string,
  dependencies: ProjectRelationDependencies,
): Promise<boolean> {
  return (await dependencies.addLabel(organizationId, projectId, targetId)) === 'applied';
}

async function handleBlockRelation(
  organizationId: string,
  projectId: string,
  targetId: string,
  dependencies: ProjectRelationDependencies,
): Promise<boolean> {
  return (await dependencies.addDependency(organizationId, projectId, targetId)) === 'applied';
}

/** Build the Project relation port from typed Project API operations. */
export function createProjectRelationCommandPort(
  dependencies: ProjectRelationDependencies,
): RelationCommandPort<ProjectRelationIntent> {
  return {
    execute: async (intent) => {
      let applied = false;
      for (const subject of intent.subjects) {
        const organizationId = subject.organizationId;
        if (
          organizationId === null ||
          intent.target.organizationId === null ||
          intent.target.organizationId !== organizationId
        )
          continue;
        if (intent.relationId === 'project.program' || intent.relationId === 'project.team') {
          applied =
            (await handleProgramOrTeamRelation(intent, subject, organizationId, dependencies)) ||
            applied;
        } else if (intent.relationId === 'project.lead') {
          applied =
            (await handleLeadRelation(intent, subject, organizationId, dependencies)) || applied;
        } else if (intent.relationId === 'project.initiative') {
          applied =
            (await handleInitiativeRelation(
              organizationId,
              subject.id,
              intent.target.id,
              dependencies,
            )) || applied;
        } else if (intent.relationId === 'project.label') {
          applied =
            (await handleLabelRelation(
              organizationId,
              subject.id,
              intent.target.id,
              dependencies,
            )) || applied;
        } else {
          applied =
            (await handleBlockRelation(
              organizationId,
              subject.id,
              intent.target.id,
              dependencies,
            )) || applied;
        }
      }
      return { status: applied ? 'applied' : 'unchanged' };
    },
  };
}
