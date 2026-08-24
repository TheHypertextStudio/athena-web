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

/** Build the Project relation port from typed Project API operations. */
export function createProjectRelationCommandPort(
  dependencies: ProjectRelationDependencies,
): RelationCommandPort<ProjectRelationIntent> {
  return {
    execute: async (intent) => {
      const organizationId = intent.target.organizationId;
      if (organizationId === null) return { status: 'unchanged' };
      let applied = false;
      for (const subject of intent.subjects) {
        if (intent.relationId === 'project.program' || intent.relationId === 'project.team') {
          const field = intent.relationId === 'project.program' ? 'programId' : 'teamId';
          if (subject.meta?.[field] === intent.target.id) continue;
          await dependencies.patchProject(organizationId, subject.id, {
            [field]: intent.target.id,
          });
          applied = true;
        } else if (intent.relationId === 'project.lead') {
          if (subject.meta?.['leadId'] === intent.target.id) continue;
          await dependencies.patchProject(organizationId, subject.id, {
            leadId: intent.target.id,
          });
          applied = true;
        } else if (intent.relationId === 'project.initiative') {
          applied =
            (await dependencies.linkInitiative(organizationId, subject.id, intent.target.id)) ===
              'applied' || applied;
        } else if (intent.relationId === 'project.label') {
          applied =
            (await dependencies.addLabel(organizationId, subject.id, intent.target.id)) ===
              'applied' || applied;
        } else {
          applied =
            (await dependencies.addDependency(organizationId, subject.id, intent.target.id)) ===
              'applied' || applied;
        }
      }
      return { status: applied ? 'applied' : 'unchanged' };
    },
  };
}
